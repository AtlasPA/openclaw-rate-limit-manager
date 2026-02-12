import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * LimitStorage - SQLite storage for rate limit management
 * Handles rate limit configurations, sliding windows, request queues, and usage patterns
 */
export class LimitStorage {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Initialize database with migrations
   * Run this separately via setup.js
   */
  initialize() {
    // Run core rate limit schema
    const migration1 = readFileSync(
      join(__dirname, '../migrations/001-init.sql'),
      'utf-8'
    );
    this.db.exec(migration1);

    // Run x402 payment tables
    const migration2 = readFileSync(
      join(__dirname, '../migrations/002-x402-payments.sql'),
      'utf-8'
    );
    this.db.exec(migration2);
  }

  // ============================================
  // Rate Limit Configuration Management
  // ============================================

  /**
   * Get rate limit configuration for provider/model/tier
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @param {string} tier - Tier ('free' or 'pro')
   * @returns {Object} Rate limit config
   */
  getLimitConfig(provider, model = null, tier = 'free') {
    const stmt = this.db.prepare(`
      SELECT * FROM rate_limit_configs
      WHERE provider = ?
        AND (model = ? OR model IS NULL)
        AND tier = ?
      ORDER BY model DESC NULLS LAST
      LIMIT 1
    `);

    return stmt.get(provider, model, tier);
  }

  /**
   * Get all rate limit configurations
   * @param {string} tier - Optional tier filter
   */
  getAllLimitConfigs(tier = null) {
    let query = 'SELECT * FROM rate_limit_configs';
    const params = [];

    if (tier) {
      query += ' WHERE tier = ?';
      params.push(tier);
    }

    query += ' ORDER BY provider, model';

    const stmt = this.db.prepare(query);
    return tier ? stmt.all(tier) : stmt.all();
  }

  /**
   * Create or update rate limit configuration
   * @param {Object} configData - Configuration data
   */
  upsertLimitConfig(configData) {
    const stmt = this.db.prepare(`
      INSERT INTO rate_limit_configs (
        provider, model, requests_per_minute, requests_per_hour,
        requests_per_day, tokens_per_minute, tokens_per_day,
        limit_type, tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model, tier) DO UPDATE SET
        requests_per_minute = ?,
        requests_per_hour = ?,
        requests_per_day = ?,
        tokens_per_minute = ?,
        tokens_per_day = ?,
        limit_type = ?,
        updated_at = CURRENT_TIMESTAMP
    `);

    return stmt.run(
      configData.provider,
      configData.model || null,
      configData.requests_per_minute || null,
      configData.requests_per_hour || null,
      configData.requests_per_day || null,
      configData.tokens_per_minute || null,
      configData.tokens_per_day || null,
      configData.limit_type || 'soft',
      configData.tier || 'free',
      // UPDATE fields
      configData.requests_per_minute || null,
      configData.requests_per_hour || null,
      configData.requests_per_day || null,
      configData.tokens_per_minute || null,
      configData.tokens_per_day || null,
      configData.limit_type || 'soft'
    );
  }

  // ============================================
  // Sliding Window Management
  // ============================================

  /**
   * Get current active window for agent/provider/model
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {string} windowType - Window type ('per_minute', 'per_hour', 'per_day')
   * @returns {Object} Window data or null
   */
  getCurrentWindow(agentWallet, provider, model, windowType) {
    const stmt = this.db.prepare(`
      SELECT * FROM rate_limit_windows
      WHERE agent_wallet = ?
        AND provider = ?
        AND (model = ? OR model IS NULL)
        AND window_type = ?
        AND is_active = 1
        AND window_end > CURRENT_TIMESTAMP
      ORDER BY window_start DESC
      LIMIT 1
    `);

    return stmt.get(agentWallet, provider, model, windowType);
  }

  /**
   * Get all active windows for an agent
   * @param {string} agentWallet - Agent wallet address
   * @returns {Array} Active windows
   */
  getActiveWindows(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT * FROM rate_limit_windows
      WHERE agent_wallet = ?
        AND is_active = 1
        AND window_end > CURRENT_TIMESTAMP
      ORDER BY provider, model, window_type
    `);

    return stmt.all(agentWallet);
  }

  /**
   * Create a new sliding window
   * @param {Object} windowData - Window configuration
   */
  createWindow(windowData) {
    const stmt = this.db.prepare(`
      INSERT INTO rate_limit_windows (
        agent_wallet, provider, model, window_type,
        window_start, window_end, limit_requests, limit_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      windowData.agent_wallet,
      windowData.provider,
      windowData.model || null,
      windowData.window_type,
      windowData.window_start,
      windowData.window_end,
      windowData.limit_requests || null,
      windowData.limit_tokens || null
    );
  }

  /**
   * Mark a window as inactive
   * @param {number} windowId - Window ID
   */
  deactivateWindow(windowId) {
    const stmt = this.db.prepare(`
      UPDATE rate_limit_windows
      SET is_active = 0
      WHERE id = ?
    `);

    return stmt.run(windowId);
  }

  /**
   * Increment window usage counts
   * @param {number} windowId - Window ID
   * @param {number} tokens - Token count to add (optional)
   */
  incrementWindow(windowId, tokens = 0) {
    const stmt = this.db.prepare(`
      UPDATE rate_limit_windows
      SET request_count = request_count + 1,
          token_count = token_count + ?,
          last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    return stmt.run(tokens, windowId);
  }

  /**
   * Clean up expired windows
   * @param {number} daysToKeep - Number of days to retain
   */
  cleanupExpiredWindows(daysToKeep = 7) {
    const stmt = this.db.prepare(`
      DELETE FROM rate_limit_windows
      WHERE window_end < datetime('now', '-' || ? || ' days')
    `);

    return stmt.run(daysToKeep);
  }

  // ============================================
  // Rate Limit Check & Recording
  // ============================================

  /**
   * Check if a request would exceed rate limits
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @returns {Object} { allowed: boolean, reason: string, windowType: string }
   */
  checkLimit(agentWallet, provider, model) {
    // Get agent tier
    const quota = this.checkQuotaAvailable(agentWallet);
    const tier = quota.tier || 'free';

    // Get limit config
    const config = this.getLimitConfig(provider, model, tier);
    if (!config) {
      // No limits configured - allow by default
      return { allowed: true, reason: 'no_limits_configured' };
    }

    // Check each window type
    const windowTypes = [
      { type: 'per_minute', limit: config.requests_per_minute },
      { type: 'per_hour', limit: config.requests_per_hour },
      { type: 'per_day', limit: config.requests_per_day }
    ];

    for (const { type, limit } of windowTypes) {
      if (!limit) continue; // Skip if no limit for this window

      const window = this.getCurrentWindow(agentWallet, provider, model, type);

      if (window && window.request_count >= limit) {
        return {
          allowed: false,
          reason: 'rate_limit_exceeded',
          windowType: type,
          currentCount: window.request_count,
          limit: limit,
          percentUsed: (window.request_count / limit) * 100
        };
      }
    }

    return { allowed: true, reason: 'within_limits' };
  }

  /**
   * Record usage for an agent/provider/model
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {number} tokens - Token count used
   */
  recordUsage(agentWallet, provider, model, tokens = 0) {
    // Get agent tier
    const quota = this.checkQuotaAvailable(agentWallet);
    const tier = quota.tier || 'free';

    // Get limit config
    const config = this.getLimitConfig(provider, model, tier);
    if (!config) return; // No config, no tracking

    // Update or create windows for each type
    const windowTypes = [
      { type: 'per_minute', duration: 60 * 1000, limit: config.requests_per_minute, tokenLimit: config.tokens_per_minute },
      { type: 'per_hour', duration: 60 * 60 * 1000, limit: config.requests_per_hour, tokenLimit: null },
      { type: 'per_day', duration: 24 * 60 * 60 * 1000, limit: config.requests_per_day, tokenLimit: config.tokens_per_day }
    ];

    for (const { type, duration, limit, tokenLimit } of windowTypes) {
      if (!limit) continue; // Skip if no limit configured

      let window = this.getCurrentWindow(agentWallet, provider, model, type);

      // Create new window if none exists or current one expired
      if (!window) {
        const now = new Date();
        const windowEnd = new Date(now.getTime() + duration);

        this.createWindow({
          agent_wallet: agentWallet,
          provider: provider,
          model: model,
          window_type: type,
          window_start: now.toISOString(),
          window_end: windowEnd.toISOString(),
          limit_requests: limit,
          limit_tokens: tokenLimit
        });

        // Re-fetch the newly created window
        window = this.getCurrentWindow(agentWallet, provider, model, type);
      }

      // Increment usage
      if (window) {
        this.incrementWindow(window.id, tokens);
      }
    }
  }

  // ============================================
  // Request Queue Management (Pro Tier)
  // ============================================

  /**
   * Queue a request when rate limits are exceeded
   * @param {string} queueId - Unique queue ID
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} requestData - Request data to queue
   * @param {number} priority - Queue priority (1-10)
   */
  queueRequest(queueId, agentWallet, provider, model, requestData, priority = 5) {
    const stmt = this.db.prepare(`
      INSERT INTO request_queue (
        queue_id, agent_wallet, provider, model,
        request_data, priority, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    return stmt.run(
      queueId,
      agentWallet,
      provider,
      model || null,
      JSON.stringify(requestData),
      priority
    );
  }

  /**
   * Get next request from queue (highest priority, oldest first)
   * @param {string} agentWallet - Optional agent wallet filter
   * @returns {Object} Queued request or null
   */
  dequeueNextRequest(agentWallet = null) {
    let query = `
      SELECT * FROM request_queue
      WHERE status = 'pending' AND retry_count < max_retries
    `;
    const params = [];

    if (agentWallet) {
      query += ' AND agent_wallet = ?';
      params.push(agentWallet);
    }

    query += ' ORDER BY priority DESC, queued_at ASC LIMIT 1';

    const stmt = this.db.prepare(query);
    const queued = params.length > 0 ? stmt.get(...params) : stmt.get();

    if (!queued) return null;

    // Mark as processing
    const updateStmt = this.db.prepare(`
      UPDATE request_queue
      SET status = 'processing', processed_at = CURRENT_TIMESTAMP
      WHERE queue_id = ?
    `);
    updateStmt.run(queued.queue_id);

    return {
      ...queued,
      request_data: JSON.parse(queued.request_data)
    };
  }

  /**
   * Complete a queued request
   * @param {string} queueId - Queue ID
   * @param {boolean} success - Whether request succeeded
   * @param {string} error - Error message (if failed)
   */
  completeQueuedRequest(queueId, success, error = null) {
    const status = success ? 'completed' : 'failed';

    const stmt = this.db.prepare(`
      UPDATE request_queue
      SET status = ?,
          error = ?,
          retry_count = retry_count + ?,
          processed_at = CURRENT_TIMESTAMP
      WHERE queue_id = ?
    `);

    return stmt.run(status, error, success ? 0 : 1, queueId);
  }

  /**
   * Get queue size for an agent
   * @param {string} agentWallet - Agent wallet address
   * @returns {number} Queue size
   */
  getQueueSize(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as size FROM request_queue
      WHERE agent_wallet = ? AND status = 'pending'
    `);

    const result = stmt.get(agentWallet);
    return result ? result.size : 0;
  }

  /**
   * Get all pending requests in queue for an agent
   * @param {string} agentWallet - Agent wallet address
   */
  getQueuedRequests(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT * FROM request_queue
      WHERE agent_wallet = ? AND status = 'pending'
      ORDER BY priority DESC, queued_at ASC
    `);

    return stmt.all(agentWallet).map(req => ({
      ...req,
      request_data: JSON.parse(req.request_data)
    }));
  }

  /**
   * Clean up old queue entries
   * @param {number} daysToKeep - Number of days to retain
   */
  cleanupOldQueue(daysToKeep = 7) {
    const stmt = this.db.prepare(`
      DELETE FROM request_queue
      WHERE status IN ('completed', 'failed')
        AND processed_at < datetime('now', '-' || ? || ' days')
    `);

    return stmt.run(daysToKeep);
  }

  // ============================================
  // Event Recording
  // ============================================

  /**
   * Record a rate limit event
   * @param {Object} eventData - Event data
   */
  recordEvent(eventData) {
    const stmt = this.db.prepare(`
      INSERT INTO rate_limit_events (
        agent_wallet, provider, model, event_type,
        window_type, current_count, limit_value,
        percent_used, request_id, was_queued,
        queue_time_ms, pattern_detected
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      eventData.agent_wallet,
      eventData.provider,
      eventData.model || null,
      eventData.event_type,
      eventData.window_type || null,
      eventData.current_count || null,
      eventData.limit_value || null,
      eventData.percent_used || null,
      eventData.request_id || null,
      eventData.was_queued ? 1 : 0,
      eventData.queue_time_ms || null,
      eventData.pattern_detected || null
    );
  }

  /**
   * Get events for an agent
   * @param {string} agentWallet - Agent wallet address
   * @param {string} eventType - Event type filter (optional)
   * @param {string} timeframe - Timeframe (e.g., '7 days', '30 days')
   */
  getEvents(agentWallet, eventType = null, timeframe = '30 days') {
    let query = `
      SELECT * FROM rate_limit_events
      WHERE agent_wallet = ?
        AND timestamp >= datetime('now', '-' || ?)
    `;
    const params = [agentWallet, timeframe];

    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }

    query += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get event statistics
   * @param {string} agentWallet - Agent wallet address
   * @param {string} timeframe - Timeframe
   */
  getEventStats(agentWallet, timeframe = '7 days') {
    const stmt = this.db.prepare(`
      SELECT
        event_type,
        COUNT(*) as count,
        AVG(percent_used) as avg_percent_used,
        COUNT(CASE WHEN was_queued = 1 THEN 1 END) as queued_count
      FROM rate_limit_events
      WHERE agent_wallet = ?
        AND timestamp >= datetime('now', '-' || ?)
      GROUP BY event_type
    `);

    return stmt.all(agentWallet, timeframe);
  }

  /**
   * Clean up old events
   * @param {number} daysToKeep - Number of days to retain
   */
  cleanupOldEvents(daysToKeep = 30) {
    const stmt = this.db.prepare(`
      DELETE FROM rate_limit_events
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `);

    return stmt.run(daysToKeep);
  }

  // ============================================
  // Usage Pattern Management
  // ============================================

  /**
   * Create or update a usage pattern
   * @param {Object} patternData - Pattern data
   */
  upsertPattern(patternData) {
    const stmt = this.db.prepare(`
      INSERT INTO usage_patterns (
        pattern_id, agent_wallet, pattern_type, provider, model,
        avg_requests_per_minute, peak_requests_per_minute,
        typical_window, confidence, suggested_limit,
        suggested_queue_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        avg_requests_per_minute = ?,
        peak_requests_per_minute = ?,
        typical_window = ?,
        confidence = ?,
        suggested_limit = ?,
        suggested_queue_size = ?,
        last_observed = CURRENT_TIMESTAMP,
        observation_count = observation_count + 1,
        last_updated = CURRENT_TIMESTAMP
    `);

    return stmt.run(
      patternData.pattern_id,
      patternData.agent_wallet || null,
      patternData.pattern_type,
      patternData.provider || null,
      patternData.model || null,
      patternData.avg_requests_per_minute || null,
      patternData.peak_requests_per_minute || null,
      patternData.typical_window || null,
      patternData.confidence || 0.5,
      patternData.suggested_limit || null,
      patternData.suggested_queue_size || null,
      // UPDATE fields
      patternData.avg_requests_per_minute || null,
      patternData.peak_requests_per_minute || null,
      patternData.typical_window || null,
      patternData.confidence || 0.5,
      patternData.suggested_limit || null,
      patternData.suggested_queue_size || null
    );
  }

  /**
   * Get usage patterns for an agent
   * @param {string} agentWallet - Agent wallet address
   * @param {string} patternType - Pattern type filter (optional)
   */
  getPatterns(agentWallet, patternType = null) {
    let query = 'SELECT * FROM usage_patterns WHERE agent_wallet = ?';
    const params = [agentWallet];

    if (patternType) {
      query += ' AND pattern_type = ?';
      params.push(patternType);
    }

    query += ' ORDER BY confidence DESC, observation_count DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get a specific pattern by ID
   * @param {string} patternId - Pattern ID
   */
  getPattern(patternId) {
    const stmt = this.db.prepare(`
      SELECT * FROM usage_patterns WHERE pattern_id = ?
    `);

    return stmt.get(patternId);
  }

  /**
   * Clean up old patterns with low confidence
   * @param {number} minConfidence - Minimum confidence threshold
   */
  cleanupLowConfidencePatterns(minConfidence = 0.3) {
    const stmt = this.db.prepare(`
      DELETE FROM usage_patterns
      WHERE confidence < ?
        AND last_observed < datetime('now', '-30 days')
    `);

    return stmt.run(minConfidence);
  }

  // ============================================
  // Agent Quota Management
  // ============================================

  /**
   * Get agent's rate limit quota
   * @param {string} agentWallet - Agent wallet address
   */
  getQuota(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT * FROM agent_limit_quotas WHERE agent_wallet = ?
    `);
    let quota = stmt.get(agentWallet);

    // Initialize quota if doesn't exist
    if (!quota) {
      quota = this.initializeQuota(agentWallet);
    }

    return quota;
  }

  /**
   * Initialize default quota for new agent
   * @param {string} agentWallet - Agent wallet address
   */
  initializeQuota(agentWallet) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_limit_quotas (
        agent_wallet, tier, requests_per_minute, can_queue,
        max_queue_size, auto_learning, custom_limits, priority_queuing
      ) VALUES (?, 'free', 100, 0, 0, 0, 0, 0)
    `);
    stmt.run(agentWallet);

    return this.getQuota(agentWallet);
  }

  /**
   * Check if agent has quota/features available
   * @param {string} agentWallet - Agent wallet address
   * @returns {Object} Quota availability info
   */
  checkQuotaAvailable(agentWallet) {
    const quota = this.getQuota(agentWallet);

    // Check if Pro tier is still valid
    const isPro = quota.tier === 'pro' &&
                  quota.paid_until &&
                  new Date(quota.paid_until) > new Date();

    return {
      available: true, // Always available, limits enforced differently
      tier: isPro ? 'pro' : 'free',
      can_queue: isPro && quota.can_queue,
      max_queue_size: isPro ? quota.max_queue_size : 0,
      auto_learning: isPro && quota.auto_learning,
      custom_limits: isPro && quota.custom_limits,
      priority_queuing: isPro && quota.priority_queuing,
      requests_per_minute: quota.requests_per_minute,
      paid_until: quota.paid_until
    };
  }

  /**
   * Update agent tier and paid_until date
   * @param {string} agentWallet - Agent wallet address
   * @param {string} tier - 'free' or 'pro'
   * @param {string} paidUntil - ISO date string
   */
  updateAgentTier(agentWallet, tier, paidUntil) {
    const proFeatures = tier === 'pro' ? {
      can_queue: 1,
      max_queue_size: 100,
      auto_learning: 1,
      custom_limits: 1,
      priority_queuing: 1,
      requests_per_minute: -1 // Unlimited for Pro
    } : {
      can_queue: 0,
      max_queue_size: 0,
      auto_learning: 0,
      custom_limits: 0,
      priority_queuing: 0,
      requests_per_minute: 100
    };

    const stmt = this.db.prepare(`
      UPDATE agent_limit_quotas
      SET tier = ?,
          paid_until = ?,
          requests_per_minute = ?,
          can_queue = ?,
          max_queue_size = ?,
          auto_learning = ?,
          custom_limits = ?,
          priority_queuing = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_wallet = ?
    `);

    return stmt.run(
      tier,
      paidUntil,
      proFeatures.requests_per_minute,
      proFeatures.can_queue,
      proFeatures.max_queue_size,
      proFeatures.auto_learning,
      proFeatures.custom_limits,
      proFeatures.priority_queuing,
      agentWallet
    );
  }

  // ============================================
  // x402 Payment Methods
  // ============================================

  /**
   * Record a payment request
   * @param {string} requestId - Unique request ID
   * @param {string} agentWallet - Agent wallet address
   * @param {number} amount - Payment amount
   * @param {string} token - Token type (USDT, USDC, SOL)
   */
  recordPaymentRequest(requestId, agentWallet, amount, token) {
    const stmt = this.db.prepare(`
      INSERT INTO payment_requests (request_id, agent_wallet, amount_requested, token, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    return stmt.run(requestId, agentWallet, amount, token);
  }

  /**
   * Get payment request
   * @param {string} requestId - Request ID
   */
  getPaymentRequest(requestId) {
    const stmt = this.db.prepare(`
      SELECT * FROM payment_requests WHERE request_id = ?
    `);

    return stmt.get(requestId);
  }

  /**
   * Update payment request status
   * @param {string} requestId - Request ID
   * @param {string} status - New status
   * @param {string} txHash - Transaction hash (optional)
   */
  updatePaymentRequest(requestId, status, txHash = null) {
    const stmt = this.db.prepare(`
      UPDATE payment_requests
      SET status = ?,
          completed_at = CURRENT_TIMESTAMP,
          tx_hash = ?
      WHERE request_id = ?
    `);

    return stmt.run(status, txHash, requestId);
  }

  /**
   * Record a completed payment transaction
   * @param {Object} data - Transaction data
   */
  recordPaymentTransaction(data) {
    const stmt = this.db.prepare(`
      INSERT INTO payment_transactions (
        agent_wallet, tx_hash, amount, token, chain,
        verified, tier_granted, duration_months
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      data.agent_wallet,
      data.tx_hash,
      data.amount,
      data.token,
      data.chain,
      data.verified ? 1 : 0,
      data.tier_granted,
      data.duration_months || 1
    );
  }

  /**
   * Get payment transactions for an agent
   * @param {string} agentWallet - Agent wallet address
   */
  getPaymentTransactions(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT * FROM payment_transactions
      WHERE agent_wallet = ?
      ORDER BY timestamp DESC
    `);

    return stmt.all(agentWallet);
  }

  /**
   * Get latest payment transaction
   * @param {string} agentWallet - Agent wallet address
   */
  getLatestPayment(agentWallet) {
    const stmt = this.db.prepare(`
      SELECT * FROM payment_transactions
      WHERE agent_wallet = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    return stmt.get(agentWallet);
  }

  /**
   * Verify if transaction hash exists
   * @param {string} txHash - Transaction hash
   */
  hasTransaction(txHash) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM payment_transactions WHERE tx_hash = ?
    `);

    return stmt.get(txHash).count > 0;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get comprehensive statistics for an agent
   * @param {string} agentWallet - Agent wallet address
   * @param {string} timeframe - Timeframe (e.g., '7 days', '30 days')
   */
  getStats(agentWallet, timeframe = '7 days') {
    // Get event stats
    const eventStats = this.getEventStats(agentWallet, timeframe);

    // Get active windows
    const activeWindows = this.getActiveWindows(agentWallet);

    // Get quota
    const quota = this.checkQuotaAvailable(agentWallet);

    // Get queue size
    const queueSize = this.getQueueSize(agentWallet);

    return {
      quota,
      eventStats,
      activeWindows,
      queueSize,
      timeframe
    };
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum() {
    this.db.exec('VACUUM');
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}
