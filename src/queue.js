/**
 * RequestQueue for OpenClaw Rate Limit Manager
 *
 * Manages request queuing when rate limits are approached (Pro tier feature).
 * Implements priority-based FIFO queue with retry logic.
 */

import { randomUUID } from 'crypto';

/**
 * RequestQueue class
 * Queues and dequeues requests based on priority and timing
 */
export class RequestQueue {
  constructor(storage) {
    this.storage = storage;

    // Queue configuration
    this.defaultPriority = 5;      // 1-10 scale (10 = highest)
    this.defaultMaxRetries = 3;
    this.maxQueueAge = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Add a request to the queue
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {object} requestData - Request data to queue
   * @param {number} priority - Priority (1-10, higher = more urgent)
   * @returns {Promise<string>} Queue ID
   */
  async enqueue(agentWallet, provider, model, requestData, priority = null) {
    try {
      // Check if agent has queuing enabled
      const quota = await this.storage.checkQuotaAvailable(agentWallet);
      if (!quota.can_queue) {
        throw new Error('Request queuing not available for free tier. Upgrade to Pro.');
      }

      // Check current queue size against quota
      const currentSize = await this.getQueueSize(agentWallet);
      if (currentSize >= quota.max_queue_size) {
        throw new Error(`Queue full (${currentSize}/${quota.max_queue_size}). Upgrade queue size or wait.`);
      }

      const queueId = randomUUID();
      const actualPriority = priority !== null ? priority : this.defaultPriority;

      // Serialize request data
      const serializedData = JSON.stringify({
        requestId: requestData._rate_limit_decision?.request_id || randomUUID(),
        requestData: requestData,
        context: {
          timestamp: new Date().toISOString(),
          agent_wallet: agentWallet
        }
      });

      // Insert into queue
      const stmt = this.storage.db.prepare(`
        INSERT INTO request_queue (
          queue_id, agent_wallet, provider, model,
          request_data, priority, retry_count, max_retries, status
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending')
      `);

      stmt.run(
        queueId,
        agentWallet,
        provider,
        model,
        serializedData,
        actualPriority,
        this.defaultMaxRetries
      );

      console.log(`[RequestQueue] Queued request ${queueId} (priority: ${actualPriority}, queue size: ${currentSize + 1})`);

      return queueId;
    } catch (error) {
      console.error('[RequestQueue] Error enqueueing request:', error);
      throw error;
    }
  }

  /**
   * Get next request to process (highest priority, oldest first)
   * @param {string} agentWallet - Agent wallet (optional, for specific agent)
   * @returns {Promise<object|null>} Queued request or null if none available
   */
  async dequeue(agentWallet = null) {
    try {
      // Build query based on whether agent is specified
      let query = `
        SELECT * FROM request_queue
        WHERE status = 'pending' AND retry_count < max_retries
      `;

      const params = [];

      if (agentWallet) {
        query += ` AND agent_wallet = ?`;
        params.push(agentWallet);
      }

      query += `
        ORDER BY priority DESC, queued_at ASC
        LIMIT 1
      `;

      const stmt = this.storage.db.prepare(query);
      const queued = stmt.get(...params);

      if (!queued) {
        return null;
      }

      // Check if request is too old
      const queuedAt = new Date(queued.queued_at);
      const age = Date.now() - queuedAt.getTime();

      if (age > this.maxQueueAge) {
        // Mark as failed due to timeout
        await this.complete(queued.queue_id, false, 'Request expired in queue');
        console.log(`[RequestQueue] Expired request ${queued.queue_id} (age: ${(age / 1000 / 60).toFixed(1)} min)`);
        // Try to get next request
        return this.dequeue(agentWallet);
      }

      // Mark as processing
      const updateStmt = this.storage.db.prepare(`
        UPDATE request_queue
        SET status = 'processing', processed_at = CURRENT_TIMESTAMP
        WHERE queue_id = ?
      `);
      updateStmt.run(queued.queue_id);

      // Parse request data
      const parsedData = JSON.parse(queued.request_data);

      return {
        queue_id: queued.queue_id,
        agent_wallet: queued.agent_wallet,
        provider: queued.provider,
        model: queued.model,
        priority: queued.priority,
        retry_count: queued.retry_count,
        queued_at: queued.queued_at,
        request_data: parsedData.requestData,
        request_id: parsedData.requestId,
        context: parsedData.context
      };
    } catch (error) {
      console.error('[RequestQueue] Error dequeuing request:', error);
      return null;
    }
  }

  /**
   * Mark a queued request as completed
   * @param {string} queueId - Queue ID
   * @param {boolean} success - Whether request succeeded
   * @param {string} error - Error message (if failed)
   * @returns {Promise<void>}
   */
  async complete(queueId, success, error = null) {
    try {
      const status = success ? 'completed' : 'failed';
      const incrementRetry = success ? 0 : 1;

      const stmt = this.storage.db.prepare(`
        UPDATE request_queue
        SET status = ?,
            error = ?,
            retry_count = retry_count + ?,
            processed_at = CURRENT_TIMESTAMP
        WHERE queue_id = ?
      `);

      stmt.run(status, error, incrementRetry, queueId);

      console.log(`[RequestQueue] Completed request ${queueId}: ${status}${error ? ` (${error})` : ''}`);
    } catch (err) {
      console.error('[RequestQueue] Error completing request:', err);
      throw err;
    }
  }

  /**
   * Retry a failed request (reset to pending)
   * @param {string} queueId - Queue ID
   * @returns {Promise<boolean>} True if retried, false if max retries reached
   */
  async retry(queueId) {
    try {
      const queued = this.storage.db.prepare(`
        SELECT * FROM request_queue WHERE queue_id = ?
      `).get(queueId);

      if (!queued) {
        throw new Error(`Queue item ${queueId} not found`);
      }

      if (queued.retry_count >= queued.max_retries) {
        console.log(`[RequestQueue] Cannot retry ${queueId}: max retries (${queued.max_retries}) reached`);
        return false;
      }

      // Reset to pending
      const stmt = this.storage.db.prepare(`
        UPDATE request_queue
        SET status = 'pending',
            error = NULL
        WHERE queue_id = ?
      `);

      stmt.run(queueId);

      console.log(`[RequestQueue] Retrying request ${queueId} (attempt ${queued.retry_count + 1}/${queued.max_retries})`);
      return true;
    } catch (error) {
      console.error('[RequestQueue] Error retrying request:', error);
      return false;
    }
  }

  /**
   * Get current queue size for an agent
   * @param {string} agentWallet - Agent wallet address
   * @returns {Promise<number>} Number of pending requests
   */
  async getQueueSize(agentWallet) {
    try {
      const result = this.storage.db.prepare(`
        SELECT COUNT(*) as size FROM request_queue
        WHERE agent_wallet = ? AND status = 'pending'
      `).get(agentWallet);

      return result.size || 0;
    } catch (error) {
      console.error('[RequestQueue] Error getting queue size:', error);
      return 0;
    }
  }

  /**
   * Get queue statistics for an agent
   * @param {string} agentWallet - Agent wallet address
   * @returns {Promise<object>} Queue statistics
   */
  async getQueueStats(agentWallet) {
    try {
      const stats = this.storage.db.prepare(`
        SELECT
          status,
          COUNT(*) as count,
          AVG(retry_count) as avg_retries
        FROM request_queue
        WHERE agent_wallet = ?
        GROUP BY status
      `).all(agentWallet);

      const result = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0,
        avg_retries: 0
      };

      for (const stat of stats) {
        result[stat.status] = stat.count;
        result.total += stat.count;
        if (stat.status === 'failed') {
          result.avg_retries = parseFloat(stat.avg_retries.toFixed(2));
        }
      }

      // Get average queue time for completed requests
      const timeStats = this.storage.db.prepare(`
        SELECT
          AVG(
            (julianday(processed_at) - julianday(queued_at)) * 24 * 60 * 60 * 1000
          ) as avg_queue_time_ms
        FROM request_queue
        WHERE agent_wallet = ?
          AND status IN ('completed', 'failed')
          AND processed_at IS NOT NULL
      `).get(agentWallet);

      result.avg_queue_time_ms = timeStats?.avg_queue_time_ms
        ? Math.round(timeStats.avg_queue_time_ms)
        : null;

      return result;
    } catch (error) {
      console.error('[RequestQueue] Error getting queue stats:', error);
      return {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0,
        avg_retries: 0,
        avg_queue_time_ms: null
      };
    }
  }

  /**
   * Get all pending requests for an agent
   * @param {string} agentWallet - Agent wallet address
   * @param {number} limit - Maximum number of requests to return
   * @returns {Promise<Array>} Array of pending requests
   */
  async getPendingRequests(agentWallet, limit = 50) {
    try {
      const stmt = this.storage.db.prepare(`
        SELECT
          queue_id,
          provider,
          model,
          priority,
          retry_count,
          max_retries,
          queued_at
        FROM request_queue
        WHERE agent_wallet = ? AND status = 'pending'
        ORDER BY priority DESC, queued_at ASC
        LIMIT ?
      `);

      return stmt.all(agentWallet, limit);
    } catch (error) {
      console.error('[RequestQueue] Error getting pending requests:', error);
      return [];
    }
  }

  /**
   * Clear old completed/failed requests (maintenance task)
   * @param {number} maxAgeDays - Maximum age in days to keep
   * @returns {Promise<number>} Number of records deleted
   */
  async clearOldRequests(maxAgeDays = 7) {
    try {
      const stmt = this.storage.db.prepare(`
        DELETE FROM request_queue
        WHERE status IN ('completed', 'failed')
          AND queued_at < datetime('now', '-' || ? || ' days')
      `);

      const result = stmt.run(maxAgeDays);

      if (result.changes > 0) {
        console.log(`[RequestQueue] Cleared ${result.changes} old queue records (older than ${maxAgeDays} days)`);
      }

      return result.changes;
    } catch (error) {
      console.error('[RequestQueue] Error clearing old requests:', error);
      return 0;
    }
  }

  /**
   * Update priority for a queued request
   * @param {string} queueId - Queue ID
   * @param {number} newPriority - New priority (1-10)
   * @returns {Promise<boolean>} True if updated
   */
  async updatePriority(queueId, newPriority) {
    try {
      if (newPriority < 1 || newPriority > 10) {
        throw new Error('Priority must be between 1 and 10');
      }

      const stmt = this.storage.db.prepare(`
        UPDATE request_queue
        SET priority = ?
        WHERE queue_id = ? AND status = 'pending'
      `);

      const result = stmt.run(newPriority, queueId);

      if (result.changes > 0) {
        console.log(`[RequestQueue] Updated priority for ${queueId} to ${newPriority}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[RequestQueue] Error updating priority:', error);
      return false;
    }
  }

  /**
   * Cancel a queued request
   * @param {string} queueId - Queue ID
   * @returns {Promise<boolean>} True if cancelled
   */
  async cancel(queueId) {
    try {
      const stmt = this.storage.db.prepare(`
        UPDATE request_queue
        SET status = 'failed', error = 'Cancelled by user'
        WHERE queue_id = ? AND status = 'pending'
      `);

      const result = stmt.run(queueId);

      if (result.changes > 0) {
        console.log(`[RequestQueue] Cancelled request ${queueId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[RequestQueue] Error cancelling request:', error);
      return false;
    }
  }

  /**
   * Get queue position for a request
   * @param {string} queueId - Queue ID
   * @returns {Promise<number|null>} Position in queue (1-based) or null if not found
   */
  async getQueuePosition(queueId) {
    try {
      const queued = this.storage.db.prepare(`
        SELECT agent_wallet, priority, queued_at
        FROM request_queue
        WHERE queue_id = ? AND status = 'pending'
      `).get(queueId);

      if (!queued) {
        return null;
      }

      // Count how many requests are ahead of this one
      const position = this.storage.db.prepare(`
        SELECT COUNT(*) + 1 as position
        FROM request_queue
        WHERE agent_wallet = ?
          AND status = 'pending'
          AND (
            priority > ?
            OR (priority = ? AND queued_at < ?)
          )
      `).get(queued.agent_wallet, queued.priority, queued.priority, queued.queued_at);

      return position.position;
    } catch (error) {
      console.error('[RequestQueue] Error getting queue position:', error);
      return null;
    }
  }
}
