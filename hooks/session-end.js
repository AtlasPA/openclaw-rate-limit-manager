/**
 * Session End Hook - Pattern Analysis
 *
 * Executes at the end of an agent session to analyze usage patterns
 * and provide recommendations.
 *
 * Actions:
 * - Analyze usage patterns (Pro tier only)
 * - Detect burst vs steady traffic patterns
 * - Identify time-of-day usage patterns
 * - Generate recommendations for optimal limits
 * - Report current window usage
 * - Display session summary
 */

import { getRateLimitManager } from '../src/index.js';

/**
 * Session end hook
 *
 * @param {object} context - Hook context
 * @param {string} context.sessionId - Session identifier
 * @param {string} context.agentWallet - Agent wallet address
 */
export default async function sessionEnd(context) {
  const { sessionId, agentWallet } = context;

  // Get singleton instance
  const manager = getRateLimitManager();

  // Initialize on first use
  if (!manager.storage.db) {
    await manager.initialize();
  }

  // Analyze patterns and report usage
  await manager.sessionEnd(sessionId, agentWallet);
}
