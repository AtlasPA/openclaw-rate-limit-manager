/**
 * Rate Limit Manager - Main Orchestrator
 *
 * Proactively manages API rate limits across all providers to prevent 429 errors.
 * Integrates with OpenClaw pipeline via provider-before, provider-after, and session-end hooks.
 *
 * Architecture:
 * - Before Provider: Check rate limits, queue/block if exceeded
 * - After Provider: Record actual usage, update windows, dequeue requests
 * - Session End: Analyze patterns, generate recommendations
 *
 * Tiers:
 * - Free: 100 requests/minute shared across all providers
 * - Pro (0.5 USDT/month): Provider-specific limits, request queuing, pattern learning
 */

import { join } from 'path';
import { homedir } from 'os';
import { LimitStorage } from './storage.js';
import { WindowTracker } from './tracker.js';
import { RequestQueue } from './queue.js';
import { PatternDetector } from './detector.js';
import { X402PaymentHandler } from './x402.js';

export class RateLimitManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || join(homedir(), '.openclaw', 'openclaw-rate-limit-manager');
    this.dbPath = join(this.dataDir, 'rate-limit.db');

    // Initialize components
    this.storage = new LimitStorage(this.dbPath);
    this.tracker = new WindowTracker(this.storage);
    this.queue = new RequestQueue(this.storage);
    this.detector = new PatternDetector(this.storage);
    this.x402 = new X402PaymentHandler(this.storage);

    // Session tracking
    this.sessions = new Map();
  }

  /**
   * Initialize database and load configurations
   */
  async initialize() {
    await this.storage.initialize();
    console.log('[Rate Limit Manager] Initialized successfully');
  }

  /**
   * Hook: Before Provider Call
   * Check rate limits before allowing request to proceed
   *
   * @param {string} requestId - Unique request identifier
   * @param {string} provider - Provider name (anthropic, openai, google)
   * @param {string} model - Model name
   * @param {string} agentId - Agent identifier
   * @param {string} sessionId - Session identifier
   * @param {object} requestData - Request data object
   * @throws {Error} If rate limit exceeded or request queued
   */
  async beforeProvider(requestId, provider, model, agentId, sessionId, requestData) {
    const agentWallet = requestData.agentWallet || agentId;

    try {
      // Check agent quota/tier
      const quota = await this.storage.checkQuotaAvailable(agentWallet);

      if (!quota.available) {
        throw new Error(`[Rate Limit Manager] Quota exceeded. ${quota.message || 'Upgrade to Pro for higher limits.'}`);
      }

      // Check all window types (per_minute, per_hour, per_day)
      const windows = ['per_minute', 'per_hour', 'per_day'];
      let wouldExceedWindow = null;

      for (const windowType of windows) {
        const wouldExceed = await this.tracker.wouldExceedLimit(
          agentWallet,
          provider,
          model,
          windowType,
          quota.tier
        );

        if (wouldExceed.exceeded) {
          wouldExceedWindow = { windowType, ...wouldExceed };
          break;
        }
      }

      if (wouldExceedWindow) {
        // Rate limit exceeded
        const { windowType, current, limit, percentUsed } = wouldExceedWindow;

        // Pro tier can queue requests
        if (quota.tier === 'pro' && quota.can_queue) {
          const queueSize = await this.queue.getQueueSize(agentWallet);

          if (queueSize >= quota.max_queue_size) {
            throw new Error(
              `[Rate Limit Manager] Queue full (${queueSize}/${quota.max_queue_size}). ` +
              `Current ${windowType}: ${current}/${limit} (${percentUsed.toFixed(1)}%)`
            );
          }

          const queueId = await this.queue.enqueue(
            agentWallet,
            provider,
            model,
            requestData,
            requestData.priority || 5
          );

          await this.storage.recordEvent({
            agent_wallet: agentWallet,
            provider,
            model,
            event_type: 'queued',
            window_type: windowType,
            current_count: current,
            limit_value: limit,
            percent_used: percentUsed,
            request_id: requestId,
            was_queued: true
          });

          throw new Error(
            `[Rate Limit Manager] Request queued (ID: ${queueId}). ` +
            `Rate limit for ${windowType}: ${current}/${limit} (${percentUsed.toFixed(1)}%)`
          );
        } else {
          // Free tier: hard block
          await this.storage.recordEvent({
            agent_wallet: agentWallet,
            provider,
            model,
            event_type: 'blocked',
            window_type: windowType,
            current_count: current,
            limit_value: limit,
            percent_used: percentUsed,
            request_id: requestId,
            was_queued: false
          });

          throw new Error(
            `[Rate Limit Manager] Rate limit exceeded for ${windowType}: ${current}/${limit} (${percentUsed.toFixed(1)}%). ` +
            `Upgrade to Pro for request queuing and higher limits.`
          );
        }
      }

      // Request allowed - record event
      await this.storage.recordEvent({
        agent_wallet: agentWallet,
        provider,
        model,
        event_type: 'allowed',
        request_id: requestId,
        was_queued: false
      });

      // Pre-increment windows (will be adjusted in afterProvider with actual tokens)
      for (const windowType of windows) {
        await this.tracker.incrementWindow(agentWallet, provider, model, windowType, 0);
      }

      // Store decision metadata for afterProvider
      requestData._rate_limit_decision = {
        request_id: requestId,
        agent_wallet: agentWallet,
        provider,
        model,
        timestamp: new Date().toISOString(),
        allowed: true
      };

      // Track session
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, {
          sessionId,
          agentWallet,
          requests: [],
          startTime: new Date()
        });
      }

      this.sessions.get(sessionId).requests.push({
        requestId,
        provider,
        model,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('[Rate Limit Manager] beforeProvider error:', error.message);
      throw error;  // Propagate to block request
    }
  }

  /**
   * Hook: After Provider Call
   * Record actual usage and update sliding windows
   *
   * @param {string} requestId - Unique request identifier
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {string} agentId - Agent identifier
   * @param {string} sessionId - Session identifier
   * @param {object} request - Request data
   * @param {object} response - Response data
   */
  async afterProvider(requestId, provider, model, agentId, sessionId, request, response) {
    const agentWallet = request.agentWallet || agentId;

    try {
      const decision = request._rate_limit_decision;
      if (!decision || !decision.allowed) {
        return; // Request was blocked or no decision recorded
      }

      // Extract token usage from response
      // Compatible with Cost Governor's _cost_metrics format
      const tokensUsed = response?._cost_metrics?.tokens_total ||
                        response?.usage?.total_tokens ||
                        0;

      // Update windows with actual token usage
      const windows = ['per_minute', 'per_hour', 'per_day'];
      for (const windowType of windows) {
        await this.tracker.updateTokenCount(
          agentWallet,
          provider,
          model,
          windowType,
          tokensUsed
        );
      }

      // Check for queued requests that can now be processed
      const quota = await this.storage.checkQuotaAvailable(agentWallet);
      if (quota.tier === 'pro' && quota.can_queue) {
        await this.processQueue(agentWallet);
      }

    } catch (error) {
      console.error('[Rate Limit Manager] afterProvider error:', error.message);
      // Don't throw - allow response to proceed
    }
  }

  /**
   * Hook: Session End
   * Analyze usage patterns and generate recommendations
   *
   * @param {string} sessionId - Session identifier
   * @param {string} agentWallet - Agent wallet address
   */
  async sessionEnd(sessionId, agentWallet) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        console.warn(`[Rate Limit Manager] No session data found for ${sessionId}`);
        return;
      }

      // Get quota/tier
      const quota = await this.storage.checkQuotaAvailable(agentWallet);

      // Analyze patterns (Pro tier only)
      if (quota.tier === 'pro' && quota.auto_learning) {
        const analysis = await this.detector.analyzeUsage(agentWallet);

        if (analysis.patterns && analysis.patterns.length > 0) {
          console.log(`\n[Rate Limit Manager] Session ${sessionId} - Usage Patterns Detected:`);
          for (const pattern of analysis.patterns) {
            console.log(`  - ${pattern.description} (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`);

            if (pattern.suggested_limit) {
              console.log(`    Suggested limit: ${pattern.suggested_limit} requests/minute`);
            }
            if (pattern.suggested_queue_size) {
              console.log(`    Suggested queue size: ${pattern.suggested_queue_size}`);
            }
          }
        }
      }

      // Report current usage
      const windows = await this.storage.getActiveWindows(agentWallet);

      if (windows.length > 0) {
        console.log(`\n[Rate Limit Manager] Session ${sessionId} - Current Usage:`);

        for (const window of windows) {
          const percent = window.limit_requests > 0
            ? (window.request_count / window.limit_requests * 100).toFixed(1)
            : '0.0';

          console.log(
            `  ${window.window_type}: ${window.request_count}/${window.limit_requests} requests ` +
            `(${percent}%), ${window.token_count} tokens`
          );
        }
      }

      // Report session summary
      const requestCount = session.requests.length;
      const duration = (new Date() - session.startTime) / 1000; // seconds

      console.log(`\n[Rate Limit Manager] Session Summary:`);
      console.log(`  Total requests: ${requestCount}`);
      console.log(`  Duration: ${duration.toFixed(1)}s`);
      console.log(`  Tier: ${quota.tier}`);

      if (quota.tier === 'free') {
        console.log(`\n  Upgrade to Pro (0.5 USDT/month) for:`);
        console.log(`  - Provider-specific rate limits`);
        console.log(`  - Request queuing during high traffic`);
        console.log(`  - Automatic pattern learning and optimization`);
      }

      // Cleanup session
      this.sessions.delete(sessionId);

    } catch (error) {
      console.error('[Rate Limit Manager] sessionEnd error:', error.message);
    }
  }

  /**
   * Process queued requests
   * Attempt to dequeue and process pending requests
   *
   * @param {string} agentWallet - Agent wallet address
   */
  async processQueue(agentWallet) {
    try {
      const queueSize = await this.queue.getQueueSize(agentWallet);
      if (queueSize === 0) return;

      console.log(`[Rate Limit Manager] Processing queue for ${agentWallet} (${queueSize} pending)`);

      // Try to process up to 5 queued requests
      for (let i = 0; i < Math.min(5, queueSize); i++) {
        const queued = await this.queue.dequeue();
        if (!queued) break;

        // Check if we can now process this request
        const wouldExceed = await this.tracker.wouldExceedLimit(
          queued.agent_wallet,
          queued.provider,
          queued.model,
          'per_minute',
          'pro' // Queued requests are always Pro tier
        );

        if (!wouldExceed.exceeded) {
          // Can process - mark as completed
          await this.queue.complete(queued.queue_id, true);

          // Increment windows
          const windows = ['per_minute', 'per_hour', 'per_day'];
          for (const windowType of windows) {
            await this.tracker.incrementWindow(
              queued.agent_wallet,
              queued.provider,
              queued.model,
              windowType,
              0
            );
          }

          const queueTime = Date.now() - new Date(queued.queued_at).getTime();
          console.log(`[Rate Limit Manager] Processed queued request ${queued.queue_id} (waited ${queueTime}ms)`);
        } else {
          // Still would exceed - re-queue for later
          await this.storage.db.prepare(`
            UPDATE request_queue SET status = 'pending' WHERE queue_id = ?
          `).run(queued.queue_id);

          console.log(`[Rate Limit Manager] Re-queued request ${queued.queue_id} (limit still exceeded)`);
          break; // Don't process more if we hit the limit
        }
      }
    } catch (error) {
      console.error('[Rate Limit Manager] processQueue error:', error.message);
    }
  }

  /**
   * Get status for an agent
   *
   * @param {string} agentWallet - Agent wallet address
   * @returns {object} Status information
   */
  async getStatus(agentWallet) {
    const quota = await this.storage.checkQuotaAvailable(agentWallet);
    const windows = await this.storage.getActiveWindows(agentWallet);
    const queueSize = await this.queue.getQueueSize(agentWallet);

    return {
      tier: quota.tier,
      quota,
      windows,
      queueSize,
      license: this.x402.hasValidLicense(agentWallet)
    };
  }

  /**
   * Close database connections
   */
  async close() {
    await this.storage.close();
  }
}

// Singleton pattern
let instance = null;

/**
 * Get singleton instance of RateLimitManager
 *
 * @param {object} options - Configuration options
 * @returns {RateLimitManager} Manager instance
 */
export function getRateLimitManager(options = {}) {
  if (!instance) {
    instance = new RateLimitManager(options);
  }
  return instance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetRateLimitManager() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export default RateLimitManager;
