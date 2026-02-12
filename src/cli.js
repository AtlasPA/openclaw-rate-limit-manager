#!/usr/bin/env node
/**
 * OpenClaw Rate Limit Manager - CLI Interface
 *
 * Commands:
 * - status: Show rate limit status and current usage
 * - windows: List active sliding windows
 * - patterns: Show detected usage patterns
 * - queue: View queued requests (Pro tier)
 * - set-limit: Configure custom rate limits (Pro tier)
 * - license: Check license status
 * - subscribe: Subscribe to Pro tier
 */

import { Command } from 'commander';
import { getRateLimitManager } from './index.js';

const program = new Command();

program
  .name('openclaw-rate-limit-manager')
  .description('Proactive rate limit management for OpenClaw agents')
  .version('1.0.0');

// Status command
program
  .command('status')
  .description('Show rate limit status and current usage')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const status = await manager.getStatus(options.wallet);

      console.log('\nRate Limit Manager Status:\n');
      console.log(`${'='.repeat(70)}`);
      console.log(`  Agent: ${options.wallet.substring(0, 10)}...`);
      console.log(`  Tier: ${status.tier.toUpperCase()}`);
      console.log(`${'='.repeat(70)}`);

      console.log(`\n  Quota Status:`);
      if (status.quota.requests_per_minute === -1) {
        console.log(`    Limit: Provider-specific (Pro tier)`);
      } else {
        console.log(`    Limit: ${status.quota.requests_per_minute} requests/minute`);
      }
      console.log(`    Can Queue: ${status.quota.can_queue ? 'Yes' : 'No'}`);
      console.log(`    Max Queue Size: ${status.quota.max_queue_size}`);
      console.log(`    Auto Learning: ${status.quota.auto_learning ? 'Enabled' : 'Disabled'}`);

      if (status.windows.length > 0) {
        console.log(`\n  Active Windows (${status.windows.length}):`);
        for (const window of status.windows) {
          const percent = window.limit_requests > 0
            ? (window.request_count / window.limit_requests * 100).toFixed(1)
            : '0.0';

          console.log(`    ${window.provider}/${window.model || 'default'} (${window.window_type}):`);
          console.log(`      Requests: ${window.request_count}/${window.limit_requests} (${percent}%)`);
          console.log(`      Tokens: ${window.token_count}`);
          console.log(`      Window: ${new Date(window.window_start).toLocaleString()} - ${new Date(window.window_end).toLocaleString()}`);
        }
      } else {
        console.log(`\n  No active windows (no recent usage)`);
      }

      if (status.queueSize > 0) {
        console.log(`\n  Queue Status:`);
        console.log(`    Pending Requests: ${status.queueSize}`);
      }

      if (status.license.valid) {
        console.log(`\n  License:`);
        console.log(`    Status: Active`);
        console.log(`    Expires: ${new Date(status.license.expires).toLocaleDateString()}`);
        console.log(`    Days Remaining: ${status.license.days_remaining}`);
      }

      console.log(`\n${'='.repeat(70)}\n`);

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Windows command
program
  .command('windows')
  .description('List active sliding windows')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const windows = await manager.storage.getActiveWindows(options.wallet);

      if (!windows || windows.length === 0) {
        console.log(`\nNo active windows found\n`);
        await manager.close();
        return;
      }

      console.log(`\nActive Sliding Windows (${windows.length}):\n`);
      console.log(`${'='.repeat(70)}`);

      for (const window of windows) {
        const percent = window.limit_requests > 0
          ? (window.request_count / window.limit_requests * 100).toFixed(1)
          : '0.0';

        console.log(`\n  [${'─'.repeat(66)}]`);
        console.log(`  Provider: ${window.provider}`);
        console.log(`  Model: ${window.model || 'default'}`);
        console.log(`  Window Type: ${window.window_type}`);
        console.log(`  Requests: ${window.request_count} / ${window.limit_requests} (${percent}%)`);
        console.log(`  Tokens: ${window.token_count}`);
        console.log(`  Window Start: ${new Date(window.window_start).toLocaleString()}`);
        console.log(`  Window End: ${new Date(window.window_end).toLocaleString()}`);
        console.log(`  Active: ${window.is_active ? 'Yes' : 'No'}`);
      }

      console.log(`\n${'='.repeat(70)}\n`);

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Patterns command
program
  .command('patterns')
  .description('Show detected usage patterns')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .option('--limit <n>', 'Number of patterns to show', '10')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const patterns = await manager.detector.getStoredPatterns(
        options.wallet,
        parseInt(options.limit)
      );

      if (!patterns || patterns.length === 0) {
        console.log(`\nNo usage patterns detected yet\n`);
        console.log('Pro tier required for pattern learning. Upgrade to enable.');
        await manager.close();
        return;
      }

      console.log(`\nDetected Usage Patterns (${patterns.length}):\n`);
      console.log(`${'='.repeat(70)}`);

      for (const pattern of patterns) {
        console.log(`\n  [${'─'.repeat(66)}]`);
        console.log(`  Type: ${pattern.pattern_type.toUpperCase()}`);
        console.log(`  Description: ${pattern.typical_window || 'N/A'}`);
        console.log(`  Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
        console.log(`  Avg Requests/Min: ${pattern.avg_requests_per_minute || 'N/A'}`);
        console.log(`  Peak Requests/Min: ${pattern.peak_requests_per_minute || 'N/A'}`);
        if (pattern.suggested_limit) {
          console.log(`  Suggested Limit: ${pattern.suggested_limit} requests/minute`);
        }
        if (pattern.suggested_queue_size) {
          console.log(`  Suggested Queue Size: ${pattern.suggested_queue_size}`);
        }
        console.log(`  Observations: ${pattern.observation_count}`);
        console.log(`  Last Observed: ${new Date(pattern.last_observed).toLocaleString()}`);
      }

      console.log(`\n${'='.repeat(70)}\n`);

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Queue command
program
  .command('queue')
  .description('View queued requests (Pro tier)')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .option('--limit <n>', 'Number of requests to show', '20')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const queueStats = await manager.queue.getQueueStats(options.wallet);
      const pendingRequests = await manager.queue.getPendingRequests(
        options.wallet,
        parseInt(options.limit)
      );

      console.log('\nRequest Queue Status:\n');
      console.log(`${'='.repeat(70)}`);
      console.log(`  Agent: ${options.wallet.substring(0, 10)}...`);
      console.log(`${'='.repeat(70)}`);

      console.log(`\n  Queue Statistics:`);
      console.log(`    Pending: ${queueStats.pending}`);
      console.log(`    Processing: ${queueStats.processing}`);
      console.log(`    Completed: ${queueStats.completed}`);
      console.log(`    Failed: ${queueStats.failed}`);
      console.log(`    Total: ${queueStats.total}`);

      if (queueStats.avg_queue_time_ms) {
        console.log(`    Avg Queue Time: ${(queueStats.avg_queue_time_ms / 1000).toFixed(2)}s`);
      }

      if (pendingRequests.length > 0) {
        console.log(`\n  Pending Requests (${pendingRequests.length}):`);
        for (const req of pendingRequests) {
          const age = Date.now() - new Date(req.queued_at).getTime();
          console.log(`\n    Queue ID: ${req.queue_id}`);
          console.log(`    Provider: ${req.provider}`);
          console.log(`    Model: ${req.model || 'default'}`);
          console.log(`    Priority: ${req.priority}/10`);
          console.log(`    Retries: ${req.retry_count}/${req.max_retries}`);
          console.log(`    Queued: ${(age / 1000).toFixed(1)}s ago`);
        }
      }

      console.log(`\n${'='.repeat(70)}\n`);

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Set-limit command
program
  .command('set-limit')
  .description('Configure custom rate limits (Pro tier)')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .option('--provider <provider>', 'Provider name (anthropic, openai, google)')
  .option('--model <model>', 'Model name (optional)')
  .option('--rpm <n>', 'Requests per minute')
  .option('--tpm <n>', 'Tokens per minute')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      if (!options.provider) {
        console.error('Error: --provider is required');
        process.exit(1);
      }

      if (!options.rpm && !options.tpm) {
        console.error('Error: At least one of --rpm or --tpm is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      // Check if user has Pro tier
      const quota = await manager.storage.checkQuotaAvailable(options.wallet);
      if (!quota.custom_limits) {
        console.error('\nError: Custom limits require Pro tier');
        console.log('Upgrade to Pro tier to configure custom rate limits.\n');
        await manager.close();
        process.exit(1);
      }

      // Update limit config
      manager.storage.upsertLimitConfig({
        provider: options.provider,
        model: options.model || null,
        requests_per_minute: options.rpm ? parseInt(options.rpm) : null,
        tokens_per_minute: options.tpm ? parseInt(options.tpm) : null,
        tier: 'pro'
      });

      console.log('\n✅ Custom rate limit configured:\n');
      console.log(`   Provider: ${options.provider}`);
      if (options.model) {
        console.log(`   Model: ${options.model}`);
      }
      if (options.rpm) {
        console.log(`   Requests/Minute: ${options.rpm}`);
      }
      if (options.tpm) {
        console.log(`   Tokens/Minute: ${options.tpm}`);
      }
      console.log('');

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// License command
program
  .command('license')
  .description('Check license status')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const license = manager.x402.hasValidLicense(options.wallet);

      console.log('\nLicense Status:\n');
      console.log(`${'='.repeat(70)}`);
      console.log(`  Agent: ${options.wallet.substring(0, 10)}...`);
      console.log(`  Tier: ${license.tier.toUpperCase()}`);

      if (license.valid) {
        console.log(`  Status: Active`);
        console.log(`  Expires: ${new Date(license.expires).toLocaleDateString()}`);
        console.log(`  Days Remaining: ${license.days_remaining}`);
        console.log('\n  Pro Features:');
        console.log('    - Provider-specific rate limits (Anthropic, OpenAI, Google)');
        console.log('    - Request queuing (prevent 429 errors)');
        console.log('    - Automatic pattern learning');
        console.log('    - Custom limit configuration');
        console.log('    - Priority request processing');
      } else if (license.expired) {
        console.log(`  Status: EXPIRED`);
        console.log('\n  Your Pro license has expired.');
        console.log('  Run "openclaw rate-limit-manager subscribe --wallet <wallet>" to renew.');
      } else {
        console.log(`  Status: FREE TIER`);
        console.log('\n  Free Tier Features:');
        console.log('    - 100 requests/minute (shared across all providers)');
        console.log('    - Basic rate limit tracking');
        console.log('\n  Upgrade to Pro for:');
        console.log('    - Provider-specific rate limits (4000+ RPM)');
        console.log('    - Request queuing (prevent 429 errors)');
        console.log('    - Automatic pattern learning');
        console.log('    - Custom limit configuration');
        console.log('    - Priority request processing');
        console.log('\n  Price: 0.5 USDT/month on Base');
        console.log('  Run "openclaw rate-limit-manager subscribe --wallet <wallet>" to upgrade.');
      }

      console.log(`${'='.repeat(70)}\n`);

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Subscribe command
program
  .command('subscribe')
  .description('Subscribe to Pro tier')
  .option('--wallet <wallet>', 'Agent wallet address (required)')
  .action(async (options) => {
    try {
      if (!options.wallet) {
        console.error('Error: --wallet is required');
        process.exit(1);
      }

      const manager = getRateLimitManager();
      await manager.initialize();

      const paymentRequest = await manager.x402.createPaymentRequest(options.wallet);

      console.log('\nSubscribe to Rate Limit Manager Pro\n');
      console.log(`${'='.repeat(70)}`);
      console.log('  Price: 0.5 USDT/month');
      console.log('  Chain: Base');
      console.log('  Protocol: x402');
      console.log(`${'='.repeat(70)}\n`);

      console.log('Payment Request Details:\n');
      console.log(`  Request ID: ${paymentRequest.request_id}`);
      console.log(`  Recipient: ${paymentRequest.recipient}`);
      console.log(`  Amount: ${paymentRequest.amount} ${paymentRequest.token}`);
      console.log(`  Chain: ${paymentRequest.chain}`);
      console.log(`  Expires: ${new Date(paymentRequest.expires_at).toLocaleString()}\n`);

      console.log('Instructions:\n');
      console.log('  1. Send 0.5 USDT to the recipient address via x402 protocol');
      console.log('  2. After payment, verify with your transaction hash:\n');
      console.log(`     curl -X POST http://localhost:9094/api/x402/verify \\`);
      console.log(`       -H "Content-Type: application/json" \\`);
      console.log(`       -d '{`);
      console.log(`         "request_id": "${paymentRequest.request_id}",`);
      console.log(`         "tx_hash": "YOUR_TX_HASH",`);
      console.log(`         "agent_wallet": "${options.wallet}"`);
      console.log(`       }'\n`);

      console.log('  Or use the dashboard at: http://localhost:9094\n');

      await manager.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
