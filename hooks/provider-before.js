/**
 * Provider Before Hook - Rate Limit Check
 *
 * Executes BEFORE provider API calls to check rate limits.
 * This hook runs BEFORE Cost Governor to prevent rate-limited requests
 * from being tracked as costs.
 *
 * Checks:
 * - Agent quota/tier
 * - Sliding window limits (per_minute, per_hour, per_day)
 * - Request/token counts for provider+model
 *
 * Actions:
 * - Allow: Request proceeds to provider
 * - Queue: Request queued for later (Pro tier only)
 * - Block: Request rejected with error
 */

import { getRateLimitManager } from '../src/index.js';

/**
 * Provider before hook
 *
 * @param {object} context - Hook context
 * @param {string} context.requestId - Unique request identifier
 * @param {string} context.provider - Provider name (anthropic, openai, google)
 * @param {string} context.model - Model name
 * @param {string} context.agentId - Agent identifier
 * @param {string} context.sessionId - Session identifier
 * @param {object} context.requestData - Request data object
 * @throws {Error} If rate limit exceeded or request queued
 */
export default async function providerBefore(context) {
  const { requestId, provider, model, agentId, sessionId, requestData } = context;

  // Get singleton instance
  const manager = getRateLimitManager();

  // Initialize on first use
  if (!manager.storage.db) {
    await manager.initialize();
  }

  // Check rate limits and handle accordingly
  await manager.beforeProvider(
    requestId,
    provider,
    model,
    agentId,
    sessionId,
    requestData
  );
}
