/**
 * OpenClaw Rate Limit Manager - REST API Dashboard
 *
 * Provides HTTP endpoints for rate limit operations and x402 payment integration.
 * Port: 9094 (to avoid conflicts with other OpenClaw services)
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getRateLimitManager } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.argv.includes('--port') ?
  parseInt(process.argv[process.argv.indexOf('--port') + 1]) : 9094;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Serve static files (if web interface exists)
app.use(express.static(join(__dirname, '../web')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'openclaw-rate-limit-manager',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// Rate Limit Operations
// ============================================================================

/**
 * GET /api/status
 * Get rate limit status for an agent
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 */
app.get('/api/status', async (req, res) => {
  try {
    const { agent_wallet } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const status = await manager.getStatus(agent_wallet);

    res.json({
      success: true,
      agent_wallet,
      ...status
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching status:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/windows
 * Get active sliding windows for an agent
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 */
app.get('/api/windows', async (req, res) => {
  try {
    const { agent_wallet } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const windows = await manager.storage.getActiveWindows(agent_wallet);

    res.json({
      success: true,
      agent_wallet,
      count: windows.length,
      windows: windows.map(w => ({
        provider: w.provider,
        model: w.model,
        window_type: w.window_type,
        request_count: w.request_count,
        token_count: w.token_count,
        limit_requests: w.limit_requests,
        limit_tokens: w.limit_tokens,
        window_start: w.window_start,
        window_end: w.window_end,
        is_active: w.is_active === 1,
        percent_used: w.limit_requests > 0
          ? (w.request_count / w.limit_requests * 100).toFixed(1)
          : '0.0'
      }))
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching windows:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/patterns
 * Get detected usage patterns
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 * - limit: Number of results (default: 20)
 */
app.get('/api/patterns', async (req, res) => {
  try {
    const { agent_wallet, limit } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const maxResults = limit ? parseInt(limit) : 20;
    const patterns = await manager.detector.getStoredPatterns(agent_wallet, maxResults);

    res.json({
      success: true,
      agent_wallet,
      count: patterns.length,
      patterns: patterns.map(p => ({
        pattern_id: p.pattern_id,
        pattern_type: p.pattern_type,
        avg_requests_per_minute: p.avg_requests_per_minute,
        peak_requests_per_minute: p.peak_requests_per_minute,
        typical_window: p.typical_window,
        confidence: p.confidence,
        suggested_limit: p.suggested_limit,
        suggested_queue_size: p.suggested_queue_size,
        observation_count: p.observation_count,
        detected_at: p.detected_at,
        last_observed: p.last_observed
      }))
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching patterns:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/queue
 * Get request queue status
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 * - limit: Number of pending requests to return (default: 50)
 */
app.get('/api/queue', async (req, res) => {
  try {
    const { agent_wallet, limit } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const maxResults = limit ? parseInt(limit) : 50;
    const stats = await manager.queue.getQueueStats(agent_wallet);
    const pending = await manager.queue.getPendingRequests(agent_wallet, maxResults);

    res.json({
      success: true,
      agent_wallet,
      stats,
      pending_requests: pending.map(req => ({
        queue_id: req.queue_id,
        provider: req.provider,
        model: req.model,
        priority: req.priority,
        retry_count: req.retry_count,
        max_retries: req.max_retries,
        queued_at: req.queued_at,
        age_ms: Date.now() - new Date(req.queued_at).getTime()
      }))
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching queue:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/queue/cancel
 * Cancel a queued request
 *
 * Body:
 * {
 *   "queue_id": "..."
 * }
 */
app.post('/api/queue/cancel', async (req, res) => {
  try {
    const { queue_id } = req.body;

    if (!queue_id) {
      return res.status(400).json({ error: 'queue_id is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const cancelled = await manager.queue.cancel(queue_id);

    if (cancelled) {
      res.json({
        success: true,
        message: `Request ${queue_id} cancelled`
      });
    } else {
      res.status(404).json({
        error: 'Request not found or already processed'
      });
    }
  } catch (error) {
    console.error('[Dashboard] Error cancelling request:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/queue/priority
 * Update priority of a queued request
 *
 * Body:
 * {
 *   "queue_id": "...",
 *   "priority": 1-10
 * }
 */
app.post('/api/queue/priority', async (req, res) => {
  try {
    const { queue_id, priority } = req.body;

    if (!queue_id || priority === undefined) {
      return res.status(400).json({ error: 'queue_id and priority are required' });
    }

    if (priority < 1 || priority > 10) {
      return res.status(400).json({ error: 'priority must be between 1 and 10' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const updated = await manager.queue.updatePriority(queue_id, priority);

    if (updated) {
      res.json({
        success: true,
        message: `Request ${queue_id} priority updated to ${priority}`
      });
    } else {
      res.status(404).json({
        error: 'Request not found or already processed'
      });
    }
  } catch (error) {
    console.error('[Dashboard] Error updating priority:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/insights
 * Get pattern insights for an agent
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 */
app.get('/api/insights', async (req, res) => {
  try {
    const { agent_wallet } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const insights = await manager.detector.getInsights(agent_wallet);

    res.json({
      success: true,
      agent_wallet,
      ...insights
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching insights:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/events
 * Get rate limit events for an agent
 *
 * Query params:
 * - agent_wallet: Agent wallet address (required)
 * - event_type: Event type filter (optional: allowed, blocked, queued)
 * - timeframe: Timeframe (default: "7 days")
 */
app.get('/api/events', async (req, res) => {
  try {
    const { agent_wallet, event_type, timeframe } = req.query;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const events = await manager.storage.getEvents(
      agent_wallet,
      event_type || null,
      timeframe || '7 days'
    );

    res.json({
      success: true,
      agent_wallet,
      count: events.length,
      events
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching events:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// x402 Payment Endpoints
// ============================================================================

/**
 * POST /api/x402/subscribe
 * Create a payment request for Pro tier subscription
 *
 * Body:
 * {
 *   "agent_wallet": "0x..."
 * }
 */
app.post('/api/x402/subscribe', async (req, res) => {
  try {
    const { agent_wallet } = req.body;

    if (!agent_wallet) {
      return res.status(400).json({ error: 'agent_wallet is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const paymentRequest = await manager.x402.createPaymentRequest(agent_wallet);

    res.json({
      success: true,
      payment_request: paymentRequest,
      instructions: 'Send 0.5 USDT via x402 protocol, then call /api/x402/verify with tx_hash',
      pricing: {
        amount: '0.5 USDT/month',
        features: [
          'Provider-specific rate limits (4000+ RPM)',
          'Request queuing (prevent 429 errors)',
          'Automatic pattern learning',
          'Custom limit configuration',
          'Priority request processing'
        ]
      }
    });
  } catch (error) {
    console.error('[Dashboard] Error creating payment request:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/x402/verify
 * Verify payment and activate Pro tier
 *
 * Body:
 * {
 *   "request_id": "...",
 *   "tx_hash": "0x...",
 *   "agent_wallet": "0x..."
 * }
 */
app.post('/api/x402/verify', async (req, res) => {
  try {
    const { request_id, tx_hash, agent_wallet } = req.body;

    if (!request_id || !tx_hash || !agent_wallet) {
      return res.status(400).json({
        error: 'request_id, tx_hash, and agent_wallet are required'
      });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const result = await manager.x402.verifyPayment(request_id, tx_hash, agent_wallet);

    res.json({
      success: true,
      ...result,
      message: 'Payment verified! Pro tier activated - request queuing & pattern learning enabled.'
    });
  } catch (error) {
    console.error('[Dashboard] Error verifying payment:', error);
    res.status(400).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/x402/license/:wallet
 * Check license status for an agent wallet
 */
app.get('/api/x402/license/:wallet', async (req, res) => {
  try {
    const agentWallet = req.params.wallet;

    if (!agentWallet) {
      return res.status(400).json({ error: 'wallet address is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const license = manager.x402.hasValidLicense(agentWallet);

    res.json({
      agent_wallet: agentWallet,
      ...license,
      pricing: {
        pro_monthly: '0.5 USDT/month',
        features: [
          'Provider-specific rate limits (4000+ RPM)',
          'Request queuing (prevent 429 errors)',
          'Automatic pattern learning',
          'Custom limit configuration',
          'Priority request processing'
        ]
      }
    });
  } catch (error) {
    console.error('[Dashboard] Error checking license:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/x402/quota/:wallet
 * Check quota status for an agent wallet
 */
app.get('/api/x402/quota/:wallet', async (req, res) => {
  try {
    const agentWallet = req.params.wallet;

    if (!agentWallet) {
      return res.status(400).json({ error: 'wallet address is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const quota = await manager.storage.checkQuotaAvailable(agentWallet);

    res.json({
      agent_wallet: agentWallet,
      ...quota
    });
  } catch (error) {
    console.error('[Dashboard] Error checking quota:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/x402/stats
 * Get payment statistics (admin endpoint)
 */
app.get('/api/x402/stats', async (req, res) => {
  try {
    const manager = getRateLimitManager();
    await manager.initialize();

    const stats = manager.x402.getPaymentStats();

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching payment stats:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/x402/history/:wallet
 * Get payment history for an agent
 */
app.get('/api/x402/history/:wallet', async (req, res) => {
  try {
    const agentWallet = req.params.wallet;

    if (!agentWallet) {
      return res.status(400).json({ error: 'wallet address is required' });
    }

    const manager = getRateLimitManager();
    await manager.initialize();

    const history = manager.x402.getPaymentHistory(agentWallet);

    res.json({
      success: true,
      agent_wallet: agentWallet,
      count: history.length,
      payments: history
    });
  } catch (error) {
    console.error('[Dashboard] Error fetching payment history:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Dashboard] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================================================
// Server Start
// ============================================================================

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  OpenClaw Rate Limit Manager - REST API Dashboard`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Status: Running`);
  console.log(`  URL: http://localhost:${port}`);
  console.log(`  Version: 1.0.0`);
  console.log(`${'='.repeat(70)}\n`);
  console.log(`  API Endpoints:`);
  console.log(`    GET    /api/status                 Get rate limit status`);
  console.log(`    GET    /api/windows                Get active sliding windows`);
  console.log(`    GET    /api/patterns               Get detected patterns`);
  console.log(`    GET    /api/queue                  Get queue status`);
  console.log(`    POST   /api/queue/cancel           Cancel queued request`);
  console.log(`    POST   /api/queue/priority         Update request priority`);
  console.log(`    GET    /api/insights               Get pattern insights`);
  console.log(`    GET    /api/events                 Get rate limit events`);
  console.log(`    POST   /api/x402/subscribe         Create payment request`);
  console.log(`    POST   /api/x402/verify            Verify payment`);
  console.log(`    GET    /api/x402/license/:wallet   Check license status`);
  console.log(`    GET    /api/x402/quota/:wallet     Check quota status`);
  console.log(`    GET    /api/x402/stats             Get payment statistics`);
  console.log(`    GET    /api/x402/history/:wallet   Get payment history`);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Press Ctrl+C to stop\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down Rate Limit Manager dashboard...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down Rate Limit Manager dashboard...');
  process.exit(0);
});
