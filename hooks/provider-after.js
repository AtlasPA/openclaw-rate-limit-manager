/**
 * Provider After Hook - Usage Recording
 *
 * Executes AFTER provider API calls to record actual usage.
 *
 * Actions:
 * - Extract token usage from response (compatible with Cost Governor format)
 * - Update sliding window token counts
 * - Process queued requests if capacity is now available
 * - Record usage events for pattern analysis
 */

import { getRateLimitManager } from '../src/index.js';

/**
 * Provider after hook
 *
 * @param {object} context - Hook context
 * @param {string} context.requestId - Unique request identifier
 * @param {string} context.provider - Provider name
 * @param {string} context.model - Model name
 * @param {string} context.agentId - Agent identifier
 * @param {string} context.sessionId - Session identifier
 * @param {object} context.request - Request data
 * @param {object} context.response - Response data
 */
export default async function providerAfter(context) {
  const { requestId, provider, model, agentId, sessionId, request, response } = context;

  // Get singleton instance
  const manager = getRateLimitManager();

  // Initialize on first use
  if (!manager.storage.db) {
    await manager.initialize();
  }

  // Record usage and update windows
  await manager.afterProvider(
    requestId,
    provider,
    model,
    agentId,
    sessionId,
    request,
    response
  );
}
