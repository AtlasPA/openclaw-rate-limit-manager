/**
 * WindowTracker for OpenClaw Rate Limit Manager
 *
 * Manages sliding time windows for rate limit tracking across multiple providers.
 * Implements sliding window algorithm to prevent rate limit violations.
 */

import { randomUUID } from 'crypto';

/**
 * WindowTracker class
 * Tracks request counts across sliding time windows (per-minute, per-hour, per-day)
 */
export class WindowTracker {
  constructor(storage) {
    this.storage = storage;

    // Window durations in milliseconds
    this.windowDurations = {
      'per_minute': 60 * 1000,           // 1 minute
      'per_hour': 60 * 60 * 1000,        // 1 hour
      'per_day': 24 * 60 * 60 * 1000     // 1 day
    };
  }

  /**
   * Check if a request would exceed the rate limit
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name (anthropic, openai, google)
   * @param {string} model - Model name (optional)
   * @param {string} windowType - Window type: 'per_minute', 'per_hour', 'per_day'
   * @param {string} tier - Tier (free or pro)
   * @returns {Promise<object>} { exceeded: boolean, current: number, limit: number, percentUsed: number }
   */
  async wouldExceedLimit(agentWallet, provider, model, windowType, tier = 'free') {
    try {
      // Get or create current window
      const window = await this.getCurrentWindow(agentWallet, provider, model, windowType);

      // Check if window has expired and needs rotation
      const now = new Date();
      if (now > new Date(window.window_end)) {
        await this.rotateWindow(window);
        // Get the newly created window
        const newWindow = await this.getCurrentWindow(agentWallet, provider, model, windowType);
        return this.checkWindowLimitDetailed(newWindow);
      }

      return this.checkWindowLimitDetailed(window);
    } catch (error) {
      console.error('[WindowTracker] Error checking limit:', error);
      // On error, be conservative and assume limit is exceeded
      return { exceeded: true, current: 0, limit: 0, percentUsed: 100 };
    }
  }

  /**
   * Check if a window has exceeded its limit (detailed response)
   * @param {object} window - Window record
   * @returns {object} { exceeded: boolean, current: number, limit: number, percentUsed: number }
   */
  checkWindowLimitDetailed(window) {
    const requestExceeded = window.limit_requests && window.request_count >= window.limit_requests;
    const tokenExceeded = window.limit_tokens && window.token_count >= window.limit_tokens;

    const exceeded = requestExceeded || tokenExceeded;
    const current = window.request_count;
    const limit = window.limit_requests || 0;
    const percentUsed = limit > 0 ? (current / limit) * 100 : 0;

    return {
      exceeded,
      current,
      limit,
      percentUsed
    };
  }

  /**
   * Check if a window has exceeded its limit
   * @param {object} window - Window record
   * @returns {boolean} True if limit exceeded
   */
  checkWindowLimit(window) {
    // Check request count limit
    if (window.limit_requests && window.request_count >= window.limit_requests) {
      return true;
    }

    // Check token count limit
    if (window.limit_tokens && window.token_count >= window.limit_tokens) {
      return true;
    }

    return false;
  }

  /**
   * Increment request count for a window
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @param {string} windowType - Window type
   * @param {number} tokens - Token count to add (default: 0)
   * @returns {Promise<void>}
   */
  async incrementWindow(agentWallet, provider, model, windowType, tokens = 0) {
    try {
      const window = await this.getCurrentWindow(agentWallet, provider, model, windowType);

      // Check if window has expired
      const now = new Date();
      if (now > new Date(window.window_end)) {
        await this.rotateWindow(window);
        // Get new window and increment it
        const newWindow = await this.getCurrentWindow(agentWallet, provider, model, windowType);
        await this.updateWindowCounts(newWindow.id, tokens);
      } else {
        await this.updateWindowCounts(window.id, tokens);
      }
    } catch (error) {
      console.error('[WindowTracker] Error incrementing window:', error);
      throw error;
    }
  }

  /**
   * Update window counts
   * @param {number} windowId - Window ID
   * @param {number} tokens - Tokens to add
   * @returns {Promise<void>}
   */
  async updateWindowCounts(windowId, tokens) {
    const stmt = this.storage.db.prepare(`
      UPDATE rate_limit_windows
      SET request_count = request_count + 1,
          token_count = token_count + ?,
          last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(tokens, windowId);
  }

  /**
   * Update token count only (without incrementing request count)
   * Used in afterProvider to update with actual token usage
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @param {string} windowType - Window type
   * @param {number} tokens - Token count to add
   * @returns {Promise<void>}
   */
  async updateTokenCount(agentWallet, provider, model, windowType, tokens) {
    try {
      const window = await this.getCurrentWindow(agentWallet, provider, model, windowType);

      if (!window) {
        console.warn(`[WindowTracker] No window found to update token count`);
        return;
      }

      const stmt = this.storage.db.prepare(`
        UPDATE rate_limit_windows
        SET token_count = token_count + ?,
            last_updated = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(tokens, window.id);
    } catch (error) {
      console.error('[WindowTracker] Error updating token count:', error);
    }
  }

  /**
   * Get or create current window for agent/provider/model/type
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @param {string} windowType - Window type
   * @returns {Promise<object>} Window record
   */
  async getCurrentWindow(agentWallet, provider, model, windowType) {
    try {
      // Try to find active window
      const stmt = this.storage.db.prepare(`
        SELECT * FROM rate_limit_windows
        WHERE agent_wallet = ?
          AND provider = ?
          AND (model = ? OR (model IS NULL AND ? IS NULL))
          AND window_type = ?
          AND is_active = 1
        ORDER BY window_start DESC
        LIMIT 1
      `);

      let window = stmt.get(agentWallet, provider, model, model, windowType);

      // If no active window exists, create one
      if (!window) {
        window = await this.createWindow(agentWallet, provider, model, windowType);
      }

      return window;
    } catch (error) {
      console.error('[WindowTracker] Error getting current window:', error);
      throw error;
    }
  }

  /**
   * Create a new window
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @param {string} windowType - Window type
   * @returns {Promise<object>} Created window record
   */
  async createWindow(agentWallet, provider, model, windowType) {
    try {
      // Get limits for this provider/model/tier
      const limits = await this.getLimits(agentWallet, provider, model);
      const limitRequests = this.getLimitForWindowType(limits, windowType, 'requests');
      const limitTokens = this.getLimitForWindowType(limits, windowType, 'tokens');

      // Calculate window boundaries
      const windowStart = new Date();
      const windowEnd = this.calculateWindowEnd(windowStart, windowType);

      // Insert new window
      const stmt = this.storage.db.prepare(`
        INSERT INTO rate_limit_windows (
          agent_wallet, provider, model, window_type,
          window_start, window_end,
          request_count, token_count,
          limit_requests, limit_tokens,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1)
      `);

      const result = stmt.run(
        agentWallet,
        provider,
        model,
        windowType,
        windowStart.toISOString(),
        windowEnd.toISOString(),
        limitRequests,
        limitTokens
      );

      // Retrieve the created window
      const newWindow = this.storage.db.prepare(`
        SELECT * FROM rate_limit_windows WHERE id = ?
      `).get(result.lastInsertRowid);

      return newWindow;
    } catch (error) {
      console.error('[WindowTracker] Error creating window:', error);
      throw error;
    }
  }

  /**
   * Rotate a window (mark as inactive and create new one)
   * @param {object} oldWindow - Window to rotate
   * @returns {Promise<object>} New window
   */
  async rotateWindow(oldWindow) {
    try {
      // Mark old window as inactive
      const deactivateStmt = this.storage.db.prepare(`
        UPDATE rate_limit_windows
        SET is_active = 0
        WHERE id = ?
      `);
      deactivateStmt.run(oldWindow.id);

      // Create new window
      const newWindow = await this.createWindow(
        oldWindow.agent_wallet,
        oldWindow.provider,
        oldWindow.model,
        oldWindow.window_type
      );

      console.log(`[WindowTracker] Rotated ${oldWindow.window_type} window for ${oldWindow.provider}`);

      return newWindow;
    } catch (error) {
      console.error('[WindowTracker] Error rotating window:', error);
      throw error;
    }
  }

  /**
   * Calculate window end time based on type
   * @param {Date} start - Window start time
   * @param {string} windowType - Window type
   * @returns {Date} Window end time
   */
  calculateWindowEnd(start, windowType) {
    const duration = this.windowDurations[windowType];
    if (!duration) {
      throw new Error(`Unknown window type: ${windowType}`);
    }

    const startTime = new Date(start);
    return new Date(startTime.getTime() + duration);
  }

  /**
   * Get limits for provider/model/tier
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @param {string} model - Model name (optional)
   * @returns {Promise<object>} Limit configuration
   */
  async getLimits(agentWallet, provider, model) {
    try {
      // Get agent tier
      const quota = await this.storage.checkQuotaAvailable(agentWallet);
      const tier = quota.tier || 'free';

      // Try to get model-specific limits first
      let limits = null;
      if (model) {
        limits = this.storage.db.prepare(`
          SELECT * FROM rate_limit_configs
          WHERE provider = ? AND model = ? AND tier = ?
          LIMIT 1
        `).get(provider, model, tier);
      }

      // Fall back to provider-wide limits
      if (!limits) {
        limits = this.storage.db.prepare(`
          SELECT * FROM rate_limit_configs
          WHERE provider = ? AND model IS NULL AND tier = ?
          LIMIT 1
        `).get(provider, tier);
      }

      // Fall back to default limits if nothing configured
      if (!limits) {
        return this.getDefaultLimits(provider, tier);
      }

      return limits;
    } catch (error) {
      console.error('[WindowTracker] Error getting limits:', error);
      return this.getDefaultLimits(provider, 'free');
    }
  }

  /**
   * Get default limits for provider/tier
   * @param {string} provider - Provider name
   * @param {string} tier - Tier (free or pro)
   * @returns {object} Default limits
   */
  getDefaultLimits(provider, tier) {
    const defaults = {
      anthropic: {
        free: {
          requests_per_minute: 50,
          requests_per_hour: null,
          requests_per_day: 1000,
          tokens_per_minute: 40000,
          tokens_per_day: 300000
        },
        pro: {
          requests_per_minute: 1000,
          requests_per_hour: null,
          requests_per_day: 10000,
          tokens_per_minute: 80000,
          tokens_per_day: 2500000
        }
      },
      openai: {
        free: {
          requests_per_minute: 60,
          requests_per_hour: null,
          requests_per_day: 200,
          tokens_per_minute: 40000,
          tokens_per_day: null
        },
        pro: {
          requests_per_minute: 500,
          requests_per_hour: null,
          requests_per_day: 10000,
          tokens_per_minute: 150000,
          tokens_per_day: null
        }
      },
      google: {
        free: {
          requests_per_minute: 60,
          requests_per_hour: null,
          requests_per_day: 1500,
          tokens_per_minute: null,
          tokens_per_day: null
        },
        pro: {
          requests_per_minute: 1000,
          requests_per_hour: null,
          requests_per_day: 15000,
          tokens_per_minute: null,
          tokens_per_day: null
        }
      }
    };

    return defaults[provider]?.[tier] || defaults.anthropic.free;
  }

  /**
   * Get limit value for specific window type
   * @param {object} limits - Limit configuration
   * @param {string} windowType - Window type
   * @param {string} limitType - 'requests' or 'tokens'
   * @returns {number|null} Limit value or null if not set
   */
  getLimitForWindowType(limits, windowType, limitType = 'requests') {
    const fieldMap = {
      'per_minute': limitType === 'requests' ? 'requests_per_minute' : 'tokens_per_minute',
      'per_hour': limitType === 'requests' ? 'requests_per_hour' : 'tokens_per_hour',
      'per_day': limitType === 'requests' ? 'requests_per_day' : 'tokens_per_day'
    };

    const field = fieldMap[windowType];
    return limits[field] || null;
  }

  /**
   * Get current usage for all windows
   * @param {string} agentWallet - Agent wallet address
   * @returns {Promise<Array>} Array of active windows with usage
   */
  async getActiveWindows(agentWallet) {
    try {
      const stmt = this.storage.db.prepare(`
        SELECT * FROM rate_limit_windows
        WHERE agent_wallet = ? AND is_active = 1
        ORDER BY provider, window_type
      `);

      const windows = stmt.all(agentWallet);

      return windows.map(w => ({
        provider: w.provider,
        model: w.model,
        window_type: w.window_type,
        request_count: w.request_count,
        token_count: w.token_count,
        limit_requests: w.limit_requests,
        limit_tokens: w.limit_tokens,
        percent_used_requests: w.limit_requests
          ? (w.request_count / w.limit_requests * 100).toFixed(1)
          : 'N/A',
        percent_used_tokens: w.limit_tokens
          ? (w.token_count / w.limit_tokens * 100).toFixed(1)
          : 'N/A',
        window_start: w.window_start,
        window_end: w.window_end
      }));
    } catch (error) {
      console.error('[WindowTracker] Error getting active windows:', error);
      return [];
    }
  }

  /**
   * Clean up expired windows (maintenance task)
   * @returns {Promise<number>} Number of windows cleaned
   */
  async cleanupExpiredWindows() {
    try {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const stmt = this.storage.db.prepare(`
        DELETE FROM rate_limit_windows
        WHERE is_active = 0 AND window_end < ?
      `);

      const result = stmt.run(cutoffDate.toISOString());

      if (result.changes > 0) {
        console.log(`[WindowTracker] Cleaned up ${result.changes} expired windows`);
      }

      return result.changes;
    } catch (error) {
      console.error('[WindowTracker] Error cleaning up windows:', error);
      return 0;
    }
  }

  /**
   * Get usage statistics for a provider
   * @param {string} agentWallet - Agent wallet address
   * @param {string} provider - Provider name
   * @returns {Promise<object>} Usage statistics
   */
  async getProviderStats(agentWallet, provider) {
    try {
      const windows = this.storage.db.prepare(`
        SELECT
          window_type,
          request_count,
          token_count,
          limit_requests,
          limit_tokens
        FROM rate_limit_windows
        WHERE agent_wallet = ? AND provider = ? AND is_active = 1
      `).all(agentWallet, provider);

      const stats = {};
      for (const w of windows) {
        stats[w.window_type] = {
          requests: {
            current: w.request_count,
            limit: w.limit_requests,
            percent: w.limit_requests
              ? (w.request_count / w.limit_requests * 100).toFixed(1)
              : 'N/A'
          },
          tokens: {
            current: w.token_count,
            limit: w.limit_tokens,
            percent: w.limit_tokens
              ? (w.token_count / w.limit_tokens * 100).toFixed(1)
              : 'N/A'
          }
        };
      }

      return stats;
    } catch (error) {
      console.error('[WindowTracker] Error getting provider stats:', error);
      return {};
    }
  }
}
