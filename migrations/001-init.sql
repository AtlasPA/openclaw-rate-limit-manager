-- Rate Limit Manager - Core Database Schema
-- Initialization migration for rate limiting and sliding window tracking

-- Provider rate limit configurations
CREATE TABLE IF NOT EXISTS rate_limit_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,          -- 'anthropic', 'openai', 'google'
  model TEXT,                      -- Specific model or NULL for provider-wide

  -- Limit definitions
  requests_per_minute INTEGER,
  requests_per_hour INTEGER,
  requests_per_day INTEGER,
  tokens_per_minute INTEGER,
  tokens_per_day INTEGER,

  -- Limit types
  limit_type TEXT DEFAULT 'soft',  -- 'soft' (warn) or 'hard' (block)
  tier TEXT DEFAULT 'free',        -- 'free' or 'pro'

  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(provider, model, tier)
);

-- Sliding window tracking
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_wallet TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,

  -- Window type and boundaries
  window_type TEXT NOT NULL,       -- 'per_minute', 'per_hour', 'per_day'
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,

  -- Usage tracking
  request_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  limit_requests INTEGER,
  limit_tokens INTEGER,

  -- Status
  is_active BOOLEAN DEFAULT 1,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(agent_wallet, provider, model, window_type, window_start)
);

-- Rate limit events (violations, warnings, blocks)
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_wallet TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Event details
  event_type TEXT NOT NULL,        -- 'allowed', 'warned', 'blocked', 'queued'
  window_type TEXT,
  current_count INTEGER,
  limit_value INTEGER,
  percent_used REAL,

  -- Request details
  request_id TEXT,
  was_queued BOOLEAN DEFAULT 0,
  queue_time_ms INTEGER,

  -- Pattern detection
  pattern_detected TEXT            -- 'spike', 'burst', 'steady', NULL
);

-- Request queue (for Pro tier)
CREATE TABLE IF NOT EXISTS request_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id TEXT UNIQUE NOT NULL,
  agent_wallet TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,

  -- Queue details
  queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  priority INTEGER DEFAULT 5,      -- 1-10, higher = more urgent
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Request data (JSON serialized)
  request_data TEXT,               -- JSON: { requestId, requestData, context }

  -- Status
  status TEXT DEFAULT 'pending',   -- 'pending', 'processing', 'completed', 'failed'
  processed_at DATETIME,
  error TEXT
);

-- Usage patterns (learned from history)
CREATE TABLE IF NOT EXISTS usage_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT UNIQUE NOT NULL,
  agent_wallet TEXT,

  -- Pattern characteristics
  pattern_type TEXT NOT NULL,      -- 'time_of_day', 'day_of_week', 'burst', 'steady'
  provider TEXT,
  model TEXT,

  -- Pattern metrics
  avg_requests_per_minute REAL,
  peak_requests_per_minute INTEGER,
  typical_window TEXT,             -- 'morning', 'afternoon', 'evening'
  confidence REAL DEFAULT 0.5,     -- 0.0-1.0

  -- Recommendations
  suggested_limit INTEGER,
  suggested_queue_size INTEGER,

  -- Metadata
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_observed DATETIME,
  observation_count INTEGER DEFAULT 1
);

-- Agent rate limit quotas (licensing)
CREATE TABLE IF NOT EXISTS agent_limit_quotas (
  agent_wallet TEXT PRIMARY KEY,
  tier TEXT DEFAULT 'free' NOT NULL,

  -- Free tier limits
  requests_per_minute INTEGER DEFAULT 100,
  can_queue BOOLEAN DEFAULT 0,
  max_queue_size INTEGER DEFAULT 0,

  -- Pro tier features
  auto_learning BOOLEAN DEFAULT 0,
  custom_limits BOOLEAN DEFAULT 0,
  priority_queuing BOOLEAN DEFAULT 0,

  -- License tracking
  paid_until DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for query optimization
CREATE INDEX IF NOT EXISTS idx_windows_agent ON rate_limit_windows(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_windows_provider ON rate_limit_windows(provider, model);
CREATE INDEX IF NOT EXISTS idx_windows_active ON rate_limit_windows(is_active, window_end);

CREATE INDEX IF NOT EXISTS idx_events_agent ON rate_limit_events(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON rate_limit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON rate_limit_events(event_type);

CREATE INDEX IF NOT EXISTS idx_queue_agent ON request_queue(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_queue_status ON request_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON request_queue(priority DESC, queued_at ASC);

CREATE INDEX IF NOT EXISTS idx_patterns_agent ON usage_patterns(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON usage_patterns(pattern_type);
