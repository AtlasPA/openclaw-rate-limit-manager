import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LimitStorage } from './storage.js';

/**
 * OpenClaw Rate Limit Manager - Database Setup Script
 *
 * Initializes the SQLite database with:
 * - Core rate limiting tables (001-init.sql)
 * - x402 payment tables (002-x402-payments.sql)
 * - WAL mode for better concurrency
 */

async function setup() {
  console.log('\n⏱️  OpenClaw Rate Limit Manager - Database Setup\n');

  try {
    // 1. Determine data directory
    const dataDir = process.env.OPENCLAW_RATE_LIMIT_DIR
      || join(homedir(), '.openclaw', 'openclaw-rate-limit-manager');

    console.log(`📁 Data directory: ${dataDir}`);

    // 2. Create data directory if it doesn't exist
    if (!existsSync(dataDir)) {
      console.log('   Creating data directory...');
      mkdirSync(dataDir, { recursive: true });
      console.log('   ✅ Directory created');
    } else {
      console.log('   ✅ Directory exists');
    }

    // 3. Initialize database
    const dbPath = join(dataDir, 'rate-limit.db');
    console.log(`\n💾 Database path: ${dbPath}`);

    const storage = new LimitStorage(dbPath);

    // 4. Run migrations
    console.log('\n🔧 Running migrations...');

    console.log('   [1/2] Creating rate limit tables (001-init.sql)...');
    console.log('   [2/2] Creating x402 payment tables (002-x402-payments.sql)...');

    storage.initialize();

    console.log('   ✅ All migrations completed');

    // 5. Verify setup
    console.log('\n🔍 Verifying database setup...');

    const tables = storage.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      ORDER BY name
    `).all();

    console.log(`   ✅ Found ${tables.length} tables:`);
    tables.forEach(table => {
      console.log(`      - ${table.name}`);
    });

    // 6. Display schema info
    console.log('\n📊 Database Configuration:');
    console.log(`   Journal Mode: ${storage.db.pragma('journal_mode', { simple: true })}`);
    console.log(`   Page Size: ${storage.db.pragma('page_size', { simple: true })} bytes`);
    console.log(`   Encoding: ${storage.db.pragma('encoding', { simple: true })}`);

    // 7. Display features
    console.log('\n🎯 Rate Limit Manager Features:');
    console.log('   ✅ Proactive rate limit tracking (sliding windows)');
    console.log('   ✅ Request queuing (Pro tier - prevent 429 errors)');
    console.log('   ✅ Pattern detection (learns from usage behavior)');
    console.log('   ✅ Provider-specific limits (Anthropic, OpenAI, Google)');
    console.log('   ✅ Multi-window tracking (per_minute, per_hour, per_day)');
    console.log('   ✅ x402 payment protocol (0.5 USDT/month for Pro tier)');

    // 8. Display pricing
    console.log('\n💰 Pricing:');
    console.log('   Free Tier: 100 requests/minute (shared across all providers)');
    console.log('   Pro Tier: Provider-specific limits + request queuing + pattern learning');
    console.log('   Pro Price: 0.5 USDT/month (via x402)');

    // 9. Display integration points
    console.log('\n🔗 Integration Points:');
    console.log('   → Cost Governor: Token usage tracking & cost metrics');
    console.log('   → Smart Router: Model selection coordination');
    console.log('   → Provider Hooks: before-provider, after-provider, session-end');

    // 10. Display usage examples
    console.log('\n📚 Usage:');
    console.log('   Import: import { getRateLimitManager } from "openclaw-rate-limit-manager";');
    console.log('   Create: const manager = getRateLimitManager();');
    console.log('   Before: await manager.beforeProvider(reqId, provider, model, agentId, sessionId, data);');
    console.log('   After: await manager.afterProvider(reqId, provider, model, agentId, sessionId, req, res);');
    console.log('   Session: await manager.sessionEnd(sessionId, agentWallet);');
    console.log('   Status: await manager.getStatus(agentWallet);');

    // 11. Display supported providers
    console.log('\n🤖 Supported Providers:');
    console.log('   Anthropic: Claude models (60 RPM free tier, 4000 RPM Pro)');
    console.log('   OpenAI: GPT models (500 RPM free tier, 10000 RPM Pro)');
    console.log('   Google: Gemini models (60 RPM free tier, 1500 RPM Pro)');

    // 12. Initialize default rate limits
    console.log('\n⚙️  Configuring default rate limits...');

    // Free tier - shared limit across all providers
    storage.upsertLimitConfig({
      provider: 'shared',
      model: null,
      requests_per_minute: 100,
      requests_per_hour: null,
      requests_per_day: null,
      tokens_per_minute: null,
      tokens_per_day: null,
      limit_type: 'soft',
      tier: 'free'
    });

    // Pro tier - Anthropic
    storage.upsertLimitConfig({
      provider: 'anthropic',
      model: null,
      requests_per_minute: 4000,
      requests_per_hour: null,
      requests_per_day: null,
      tokens_per_minute: 400000,
      tokens_per_day: null,
      limit_type: 'soft',
      tier: 'pro'
    });

    // Pro tier - OpenAI
    storage.upsertLimitConfig({
      provider: 'openai',
      model: null,
      requests_per_minute: 10000,
      requests_per_hour: null,
      requests_per_day: null,
      tokens_per_minute: 2000000,
      tokens_per_day: null,
      limit_type: 'soft',
      tier: 'pro'
    });

    // Pro tier - Google
    storage.upsertLimitConfig({
      provider: 'google',
      model: null,
      requests_per_minute: 1500,
      requests_per_hour: null,
      requests_per_day: null,
      tokens_per_minute: 4000000,
      tokens_per_day: null,
      limit_type: 'soft',
      tier: 'pro'
    });

    console.log('   ✅ Default limits configured');

    // 13. Close database
    storage.close();

    console.log('\n✅ Setup complete! Rate Limit Manager is ready to use.\n');
    console.log(`📂 Database location: ${dbPath}`);
    console.log(`🌐 Data directory: ${dataDir}\n`);

    return {
      success: true,
      dbPath,
      dataDir,
      tables: tables.map(t => t.name)
    };

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run setup if called directly
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1]?.includes('setup.js')) {
  setup().catch(error => {
    console.error('Setup error:', error);
    process.exit(1);
  });
}

export { setup };
