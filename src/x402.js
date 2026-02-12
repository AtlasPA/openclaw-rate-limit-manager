/**
 * x402 Payment Protocol Integration for OpenClaw Rate Limit Manager
 *
 * Enables AI agents to autonomously pay for Pro tier (advanced rate limiting)
 * via the x402 HTTP payment protocol
 *
 * Pricing: 0.5 USDT/month on Base chain
 *
 * Tiers:
 * - Free: 100 requests/minute shared across all providers, no queuing
 * - Pro: Provider-specific limits, request queuing, pattern learning, custom limits
 */

import { randomUUID } from 'crypto';

export class X402PaymentHandler {
  constructor(storage) {
    this.storage = storage;

    // Pricing configuration
    this.pricing = {
      pro_monthly: {
        amount: 0.5,
        token: 'USDT',
        chain: 'base',
        duration_months: 1
      }
    };

    // Supported tokens and chains
    this.supportedTokens = ['USDT', 'USDC', 'SOL'];
    this.supportedChains = ['base', 'solana', 'ethereum'];

    // Quota limits
    this.quotaLimits = {
      free: {
        requests_per_minute: 100,
        can_queue: false,
        max_queue_size: 0,
        auto_learning: false,
        custom_limits: false,
        priority_queuing: false
      },
      pro: {
        requests_per_minute: -1,  // Use provider-specific limits
        can_queue: true,
        max_queue_size: 100,
        auto_learning: true,
        custom_limits: true,
        priority_queuing: true
      }
    };
  }

  /**
   * Generate x402 payment request
   * For agents to pay for Pro tier (advanced rate limiting)
   */
  async createPaymentRequest(agentWallet, tier = 'pro_monthly') {
    const pricing = this.pricing[tier];

    if (!pricing) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    const requestId = randomUUID();

    // Store payment request
    const stmt = this.storage.db.prepare(`
      INSERT INTO payment_requests (request_id, agent_wallet, amount_requested, token, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    stmt.run(requestId, agentWallet, pricing.amount, pricing.token);

    // x402 payment request format
    return {
      protocol: 'x402',
      version: '1.0',
      request_id: requestId,
      recipient: process.env.PAYMENT_WALLET || 'YOUR_WALLET_ADDRESS',
      amount: pricing.amount,
      token: pricing.token,
      chain: pricing.chain,
      description: `OpenClaw Rate Limit Manager - Pro tier (request queuing + pattern learning)`,
      callback_url: process.env.PAYMENT_CALLBACK_URL || 'http://localhost:9094/api/x402/verify',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };
  }

  /**
   * Verify x402 payment and grant Pro tier
   * Called when agent reports payment completion
   */
  async verifyPayment(requestId, txHash, agentWallet) {
    // Get payment request
    const request = this.storage.db.prepare(`
      SELECT * FROM payment_requests WHERE request_id = ?
    `).get(requestId);

    if (!request) {
      throw new Error('Payment request not found');
    }

    if (request.status === 'completed') {
      throw new Error('Payment already processed');
    }

    // In production, verify transaction on-chain
    // For MVP, we'll trust the agent (could add on-chain verification via RPC)
    const verified = await this.verifyTransactionOnChain(txHash);

    if (!verified) {
      throw new Error('Transaction verification failed');
    }

    // Update payment request
    this.storage.db.prepare(`
      UPDATE payment_requests
      SET status = 'completed', completed_at = datetime('now'), tx_hash = ?
      WHERE request_id = ?
    `).run(txHash, requestId);

    // Record transaction
    this.storage.db.prepare(`
      INSERT INTO payment_transactions
      (agent_wallet, tx_hash, amount, token, chain, verified, tier_granted, duration_months)
      VALUES (?, ?, ?, ?, ?, 1, 'pro', 1)
    `).run(agentWallet, txHash, request.amount_requested, request.token, 'base');

    // Grant or extend license
    await this.grantLicense(agentWallet, 'pro', 1);

    return {
      success: true,
      tier: 'pro',
      valid_until: this.getLicenseExpiry(agentWallet),
      message: 'Pro tier activated - request queuing + pattern learning enabled'
    };
  }

  /**
   * Grant or extend Pro license
   */
  async grantLicense(agentWallet, tier, durationMonths) {
    const existing = this.storage.db.prepare(`
      SELECT * FROM agent_limit_quotas WHERE agent_wallet = ?
    `).get(agentWallet);

    const now = new Date();
    let paidUntil;

    if (existing && existing.paid_until && new Date(existing.paid_until) > now) {
      // Extend existing license
      paidUntil = new Date(existing.paid_until);
      paidUntil.setMonth(paidUntil.getMonth() + durationMonths);
    } else {
      // New license
      paidUntil = new Date(now);
      paidUntil.setMonth(paidUntil.getMonth() + durationMonths);
    }

    const proQuota = this.quotaLimits.pro;

    if (existing) {
      this.storage.db.prepare(`
        UPDATE agent_limit_quotas
        SET tier = ?,
            requests_per_minute = ?,
            can_queue = ?,
            max_queue_size = ?,
            auto_learning = ?,
            custom_limits = ?,
            priority_queuing = ?,
            paid_until = ?,
            updated_at = datetime('now')
        WHERE agent_wallet = ?
      `).run(
        tier,
        proQuota.requests_per_minute,
        proQuota.can_queue ? 1 : 0,
        proQuota.max_queue_size,
        proQuota.auto_learning ? 1 : 0,
        proQuota.custom_limits ? 1 : 0,
        proQuota.priority_queuing ? 1 : 0,
        paidUntil.toISOString(),
        agentWallet
      );
    } else {
      this.storage.db.prepare(`
        INSERT INTO agent_limit_quotas
        (agent_wallet, tier, requests_per_minute, can_queue, max_queue_size,
         auto_learning, custom_limits, priority_queuing, paid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        agentWallet,
        tier,
        proQuota.requests_per_minute,
        proQuota.can_queue ? 1 : 0,
        proQuota.max_queue_size,
        proQuota.auto_learning ? 1 : 0,
        proQuota.custom_limits ? 1 : 0,
        proQuota.priority_queuing ? 1 : 0,
        paidUntil.toISOString()
      );
    }

    console.log(`[x402] Granted Pro license to ${agentWallet} until ${paidUntil.toISOString()}`);
    return paidUntil;
  }

  /**
   * Check if agent has valid Pro license
   */
  hasValidLicense(agentWallet) {
    const quota = this.storage.db.prepare(`
      SELECT * FROM agent_limit_quotas WHERE agent_wallet = ?
    `).get(agentWallet);

    if (!quota) {
      return { valid: false, tier: 'free' };
    }

    if (quota.tier === 'free' || !quota.paid_until) {
      return { valid: false, tier: 'free' };
    }

    const now = new Date();
    const expiry = new Date(quota.paid_until);

    if (expiry > now) {
      return {
        valid: true,
        tier: quota.tier,
        expires: expiry.toISOString(),
        days_remaining: Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))
      };
    }

    return { valid: false, tier: 'expired', expired: true };
  }

  /**
   * Get license expiry date
   */
  getLicenseExpiry(agentWallet) {
    const quota = this.storage.db.prepare(`
      SELECT paid_until FROM agent_limit_quotas WHERE agent_wallet = ?
    `).get(agentWallet);

    return quota?.paid_until || null;
  }

  /**
   * Verify transaction on-chain
   * In production, this would check the actual blockchain
   */
  async verifyTransactionOnChain(txHash) {
    // TODO: Implement actual on-chain verification via RPC
    // For MVP, we'll accept any transaction hash
    //
    // In production:
    // 1. Connect to Base RPC
    // 2. Query transaction by hash
    // 3. Verify recipient, amount, token
    // 4. Check confirmation status

    console.log(`[x402] Verifying transaction: ${txHash}`);
    console.log('[x402] Note: On-chain verification not implemented in MVP');

    // For MVP, trust any valid-looking transaction hash
    return txHash && txHash.length > 32;
  }

  /**
   * Get payment statistics
   */
  getPaymentStats() {
    const totalRevenue = this.storage.db.prepare(`
      SELECT
        COUNT(*) as transaction_count,
        SUM(amount) as total_revenue,
        COUNT(DISTINCT agent_wallet) as unique_payers
      FROM payment_transactions
      WHERE verified = 1
    `).get();

    const activeSubscriptions = this.storage.db.prepare(`
      SELECT COUNT(*) as count
      FROM agent_limit_quotas
      WHERE tier = 'pro' AND paid_until > datetime('now')
    `).get();

    return {
      ...totalRevenue,
      active_subscriptions: activeSubscriptions.count
    };
  }

  /**
   * Get payment history for an agent
   */
  getPaymentHistory(agentWallet) {
    return this.storage.db.prepare(`
      SELECT * FROM payment_transactions
      WHERE agent_wallet = ?
      ORDER BY timestamp DESC
    `).all(agentWallet);
  }
}
