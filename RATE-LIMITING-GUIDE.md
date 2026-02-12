# Rate Limiting Guide - OpenClaw Rate Limit Manager

**A technical deep dive into sliding window algorithms, provider configurations, and pattern detection.**

## Table of Contents

1. [Introduction to Rate Limiting](#introduction-to-rate-limiting)
2. [Sliding Window Algorithm](#sliding-window-algorithm)
3. [Provider Rate Limit Configurations](#provider-rate-limit-configurations)
4. [Pattern Detection Algorithms](#pattern-detection-algorithms)
5. [Queue Management](#queue-management)
6. [Integration with OpenClaw Tools](#integration-with-openclaw-tools)
7. [Advanced Topics](#advanced-topics)

---

## Introduction to Rate Limiting

### Why Rate Limiting Matters

API providers enforce rate limits to:
- Prevent abuse and ensure fair usage
- Maintain service quality for all users
- Control infrastructure costs
- Prevent DDoS attacks

When you exceed rate limits, you receive:
- **429 "Too Many Requests"** HTTP status code
- Forced wait periods (exponential backoff)
- Potential account suspension for repeated violations
- Workflow interruptions and lost productivity

### Types of Rate Limits

**1. Request-Based Limits**
```
Example: 50 requests per minute
- Request #1-50 → Allowed
- Request #51 → 429 Error
```

**2. Token-Based Limits**
```
Example: 40,000 tokens per minute
- Request #1: 5,000 tokens → Allowed (5,000/40,000 used)
- Request #2: 10,000 tokens → Allowed (15,000/40,000 used)
- Request #3: 30,000 tokens → Blocked (would exceed 40,000)
```

**3. Concurrent Request Limits**
```
Example: 5 concurrent requests
- Currently processing: 5 requests
- New request → Queued or blocked
```

**4. Time-Based Windows**
- Per-second (rare, mostly for real-time systems)
- Per-minute (most common for API calls)
- Per-hour (for sustained usage)
- Per-day (daily quotas)

### Rate Limit Manager's Approach

Rate Limit Manager uses **sliding windows** to track usage across multiple time periods simultaneously:

- **Per-Minute Window** - Prevents short bursts
- **Per-Hour Window** - Prevents sustained high traffic
- **Per-Day Window** - Prevents daily quota exhaustion

A request is allowed only if ALL windows have capacity.

---

## Sliding Window Algorithm

### Fixed Window vs Sliding Window

**Fixed Window (Traditional Approach)**

```
Fixed 1-minute windows:

Window 1: 00:00-01:00
Window 2: 01:00-02:00
Window 3: 02:00-03:00

Time:    00:00    00:30    01:00    01:30    02:00
         |        |        |        |        |
Window:  [-- Window 1 --]  [-- Window 2 --]
Requests: 50      0        50       0

Total at 01:00: 50 (Window 1) → Reset
Total at 01:30: 50 (Window 2) → Under limit
```

**Problem with Fixed Windows:**
- Artificial reset points create burst opportunities
- At 00:59, make 50 requests (OK)
- At 01:00, window resets
- At 01:01, make 50 more requests (OK)
- Result: 100 requests in 2 minutes (should be blocked!)

**Sliding Window (Rate Limit Manager's Approach)**

```
Sliding 1-minute windows:

Window starts at request time:

Time:    00:00    00:30    01:00    01:30    02:00
         |        |        |        |        |
         [-- Window (60s) --]
                  [-- Window (60s) --]
                           [-- Window (60s) --]

At 00:30: Count requests from 23:30-00:30
At 01:00: Count requests from 00:00-01:00
At 01:30: Count requests from 00:30-01:30
```

**Advantages:**
- No artificial reset points
- Accurate enforcement regardless of timing
- Prevents burst abuse
- More fair to all users

### Implementation Details

**Window Lifecycle**

```javascript
1. Request arrives at 14:32:45

2. Check current window:
   - Window type: per_minute
   - Window start: 14:31:45 (60 seconds ago)
   - Window end: 14:32:45 (now)
   - Current count: 42 requests
   - Limit: 50 requests

3. Decision:
   - Would 43rd request exceed limit? No (43 < 50)
   - Allow request
   - Increment count to 43

4. After request completes:
   - Update token count (if applicable)
   - Check if queued requests can now proceed
```

**Window Rotation**

```javascript
1. Request arrives at 14:33:00

2. Check current window:
   - Window start: 14:32:00
   - Window end: 14:33:00
   - Has expired? Yes (current time > window_end)

3. Rotate window:
   - Mark old window as inactive
   - Create new window:
     - Window start: 14:33:00
     - Window end: 14:34:00
     - Request count: 0
     - Token count: 0

4. Process request in new window
```

**Multi-Window Enforcement**

```javascript
function wouldExceedLimit(provider, model) {
  // Check all window types
  const windows = ['per_minute', 'per_hour', 'per_day'];

  for (const windowType of windows) {
    const window = getCurrentWindow(provider, model, windowType);

    // Rotate if expired
    if (now > window.window_end) {
      rotateWindow(window);
      window = getCurrentWindow(provider, model, windowType);
    }

    // Check limit
    const requestLimit = window.limit_requests;
    const tokenLimit = window.limit_tokens;

    if (window.request_count >= requestLimit) {
      return { exceeded: true, reason: `${windowType} request limit` };
    }

    if (tokenLimit && estimatedTokens > 0) {
      if (window.token_count + estimatedTokens > tokenLimit) {
        return { exceeded: true, reason: `${windowType} token limit` };
      }
    }
  }

  // All windows have capacity
  return { exceeded: false };
}
```

### Database Schema for Sliding Windows

```sql
CREATE TABLE rate_limit_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_wallet TEXT NOT NULL,
  provider TEXT NOT NULL,           -- 'anthropic', 'openai', 'google'
  model TEXT,                       -- Specific model or NULL for provider-wide

  -- Window boundaries
  window_type TEXT NOT NULL,        -- 'per_minute', 'per_hour', 'per_day'
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,

  -- Usage tracking
  request_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,

  -- Limits
  limit_requests INTEGER,
  limit_tokens INTEGER,

  -- Status
  is_active BOOLEAN DEFAULT 1,      -- Active window or rotated
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(agent_wallet, provider, model, window_type, window_start)
);
```

**Example Data**

```
| id | agent_wallet | provider   | window_type | window_start        | window_end          | request_count | limit_requests | is_active |
|----|-------------|-----------|-------------|---------------------|---------------------|---------------|----------------|-----------|
| 1  | 0xABC...    | anthropic | per_minute  | 2026-02-12 14:32:00 | 2026-02-12 14:33:00 | 42            | 50             | 1         |
| 2  | 0xABC...    | anthropic | per_hour    | 2026-02-12 14:00:00 | 2026-02-12 15:00:00 | 234           | 1000           | 1         |
| 3  | 0xABC...    | anthropic | per_day     | 2026-02-12 00:00:00 | 2026-02-13 00:00:00 | 1247          | 10000          | 1         |
| 4  | 0xABC...    | openai    | per_minute  | 2026-02-12 14:32:00 | 2026-02-12 14:33:00 | 18            | 60             | 1         |
```

---

## Provider Rate Limit Configurations

### Default Configurations

Rate Limit Manager includes default rate limits for major providers, based on typical API tier limits.

### Anthropic (Claude) Rate Limits

**Free Tier (API Tier 1)**

```javascript
{
  provider: 'anthropic',
  tier: 'free',
  requests_per_minute: 50,
  requests_per_hour: null,        // Not enforced
  requests_per_day: 1000,
  tokens_per_minute: 40000,
  tokens_per_day: 300000
}
```

**Pro Tier (API Tier 3+)**

```javascript
{
  provider: 'anthropic',
  tier: 'pro',
  requests_per_minute: 1000,
  requests_per_hour: null,        // Not enforced
  requests_per_day: 10000,
  tokens_per_minute: 80000,
  tokens_per_day: 2500000
}
```

**Model-Specific Limits**

```javascript
// Claude Opus (higher cost, stricter limits)
{
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  tier: 'free',
  requests_per_minute: 40,        // Lower than provider default
  tokens_per_minute: 30000
}

// Claude Haiku (lower cost, more lenient)
{
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  tier: 'free',
  requests_per_minute: 60,        // Higher than provider default
  tokens_per_minute: 50000
}
```

### OpenAI (GPT) Rate Limits

**Free Tier (Tier 1)**

```javascript
{
  provider: 'openai',
  tier: 'free',
  requests_per_minute: 60,
  requests_per_hour: null,
  requests_per_day: 200,
  tokens_per_minute: 40000,
  tokens_per_day: null
}
```

**Pro Tier (Tier 4+)**

```javascript
{
  provider: 'openai',
  tier: 'pro',
  requests_per_minute: 500,
  requests_per_hour: null,
  requests_per_day: 10000,
  tokens_per_minute: 150000,
  tokens_per_day: null
}
```

### Google (Gemini) Rate Limits

**Free Tier**

```javascript
{
  provider: 'google',
  tier: 'free',
  requests_per_minute: 60,
  requests_per_hour: null,
  requests_per_day: 1500,
  tokens_per_minute: null,        // Not token-limited
  tokens_per_day: null
}
```

**Pro Tier (Pay-as-you-go)**

```javascript
{
  provider: 'google',
  tier: 'pro',
  requests_per_minute: 1000,
  requests_per_hour: null,
  requests_per_day: 15000,
  tokens_per_minute: null,
  tokens_per_day: null
}
```

### Custom Provider Configuration

**Adding Custom Limits**

```bash
# Via CLI
claw rate-limit set-limit \
  --provider=anthropic \
  --model=claude-opus-4-5 \
  --rpm=100 \
  --rpd=2000 \
  --tpm=50000 \
  --wallet=0xYourWallet
```

**Via Configuration File**

```json
{
  "custom_limits": [
    {
      "provider": "anthropic",
      "model": "claude-opus-4-5",
      "tier": "pro",
      "requests_per_minute": 100,
      "requests_per_day": 2000,
      "tokens_per_minute": 50000,
      "tokens_per_day": 500000
    }
  ]
}
```

**Database Storage**

```sql
INSERT INTO rate_limit_configs (
  provider, model, tier,
  requests_per_minute, requests_per_day,
  tokens_per_minute, tokens_per_day
) VALUES (
  'anthropic', 'claude-opus-4-5', 'pro',
  100, 2000,
  50000, 500000
);
```

---

## Pattern Detection Algorithms

### Overview

Pattern learning (Pro tier feature) analyzes usage history to:
- Detect time-of-day patterns (peak hours)
- Detect day-of-week patterns (weekday vs weekend)
- Detect burst vs steady traffic patterns
- Recommend optimal rate limits
- Predict future usage

### Time-of-Day Pattern Detection

**Algorithm**

```javascript
function analyzeHourlyDistribution(events) {
  // 1. Count events per hour (0-23)
  const hourCounts = new Array(24).fill(0);

  for (const event of events) {
    const hour = new Date(event.timestamp).getHours();
    hourCounts[hour]++;
  }

  // 2. Calculate average
  const avgCount = sum(hourCounts) / 24;

  // 3. Find peak hours (1.5x average threshold)
  const peakHours = [];
  for (let hour = 0; hour < 24; hour++) {
    if (hourCounts[hour] > avgCount * 1.5) {
      peakHours.push(hour);
    }
  }

  // 4. Calculate peak requests per minute
  const maxHourlyCount = max(hourCounts);
  const peakRPM = ceil(maxHourlyCount / 60);

  // 5. Categorize into time windows
  const timeWindows = [];
  if (peakHours.some(h => h >= 6 && h < 12)) {
    timeWindows.push('morning');
  }
  if (peakHours.some(h => h >= 12 && h < 18)) {
    timeWindows.push('afternoon');
  }
  if (peakHours.some(h => h >= 18 && h < 24)) {
    timeWindows.push('evening');
  }

  // 6. Calculate confidence
  const variance = calculateVariance(hourCounts, avgCount);
  const confidence = peakHours.length > 0
    ? min(1.0, variance / avgCount * 0.5 + 0.3)
    : 0.3;

  // 7. Generate recommendation
  const suggestedLimit = ceil(peakRPM * 1.2);  // 20% buffer

  return {
    pattern_type: 'time_of_day',
    peak_hours: peakHours,
    typical_windows: timeWindows,
    peak_requests_per_minute: peakRPM,
    suggested_limit: suggestedLimit,
    confidence: confidence
  };
}
```

**Example Output**

```javascript
{
  pattern_type: 'time_of_day',
  description: 'Peak usage during hours: 9, 10, 11, 14, 15',
  peak_hours: [9, 10, 11, 14, 15],
  typical_windows: ['morning', 'afternoon'],
  avg_requests_per_minute: 35,
  peak_requests_per_minute: 65,
  suggested_limit: 78,    // 65 * 1.2
  confidence: 0.85,
  data: {
    hourly_distribution: [12, 8, 5, 3, 2, 5, 15, 25, 45, 60, 55, 50, 40, 35, 55, 48, 30, 20, 15, 10, 8, 10, 12, 10],
    avg_hourly: 26.5,
    max_hourly: 60
  }
}
```

### Day-of-Week Pattern Detection

**Algorithm**

```javascript
function analyzeWeeklyPattern(events) {
  // 1. Count events per day of week (0=Sunday, 6=Saturday)
  const dayCounts = new Array(7).fill(0);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const event of events) {
    const day = new Date(event.timestamp).getDay();
    dayCounts[day]++;
  }

  // 2. Calculate average
  const avgCount = sum(dayCounts) / 7;

  // 3. Find peak days
  const peakDays = [];
  for (let day = 0; day < 7; day++) {
    if (dayCounts[day] > avgCount * 1.5) {
      peakDays.push(dayNames[day]);
    }
  }

  // 4. Categorize weekday vs weekend
  const weekdayTotal = sum(dayCounts.slice(1, 6));  // Mon-Fri
  const weekendTotal = dayCounts[0] + dayCounts[6]; // Sun + Sat

  const isWeekdayHeavy = weekdayTotal > weekendTotal * 1.5;
  const isWeekendHeavy = weekendTotal > weekdayTotal * 1.5;

  // 5. Calculate confidence
  const variance = calculateVariance(dayCounts, avgCount);
  const confidence = peakDays.length > 0
    ? min(1.0, variance / avgCount * 0.4 + 0.4)
    : 0.3;

  // 6. Generate description
  let description = 'Uniform usage across week';
  if (isWeekdayHeavy) {
    description = 'Weekday-heavy usage pattern';
  } else if (isWeekendHeavy) {
    description = 'Weekend-heavy usage pattern';
  } else if (peakDays.length > 0) {
    description = `Peak usage on: ${peakDays.join(', ')}`;
  }

  return {
    pattern_type: 'day_of_week',
    description: description,
    peak_days: peakDays,
    is_weekday_heavy: isWeekdayHeavy,
    is_weekend_heavy: isWeekendHeavy,
    confidence: confidence
  };
}
```

**Example Output**

```javascript
{
  pattern_type: 'day_of_week',
  description: 'Weekday-heavy usage pattern',
  peak_days: ['Monday', 'Wednesday', 'Friday'],
  is_weekday_heavy: true,
  is_weekend_heavy: false,
  confidence: 0.78,
  data: {
    daily_distribution: [
      { day: 'Sunday', count: 45 },
      { day: 'Monday', count: 180 },
      { day: 'Tuesday', count: 150 },
      { day: 'Wednesday', count: 195 },
      { day: 'Thursday', count: 145 },
      { day: 'Friday', count: 175 },
      { day: 'Saturday', count: 50 }
    ],
    avg_daily: 134.3
  }
}
```

### Burst vs Steady Pattern Detection

**Algorithm**

```javascript
function detectBurstPattern(events) {
  // 1. Calculate inter-arrival times
  const sortedEvents = events.sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  const intervals = [];
  for (let i = 1; i < sortedEvents.length; i++) {
    const interval = new Date(sortedEvents[i].timestamp) -
                     new Date(sortedEvents[i-1].timestamp);
    intervals.push(interval);
  }

  // 2. Calculate mean and standard deviation
  const avgInterval = mean(intervals);
  const variance = calculateVariance(intervals, avgInterval);
  const stdDev = sqrt(variance);

  // 3. Calculate Coefficient of Variation (CV)
  const coefficientOfVariation = stdDev / avgInterval;

  // 4. Classify pattern
  const isBursty = coefficientOfVariation > 1.0;
  const isSteady = coefficientOfVariation < 0.5;

  // 5. Recommend queue size
  let recommendedQueueSize = 10;  // Default
  if (coefficientOfVariation > 2.0) {
    recommendedQueueSize = 100;   // High burst
  } else if (coefficientOfVariation > 1.5) {
    recommendedQueueSize = 50;    // Moderate burst
  } else if (coefficientOfVariation > 1.0) {
    recommendedQueueSize = 25;    // Low burst
  }

  // 6. Calculate confidence
  const confidence = min(1.0, abs(coefficientOfVariation - 1.0) * 0.5 + 0.4);

  // 7. Generate description
  let description = 'Unknown traffic pattern';
  if (isBursty) {
    description = 'Bursty traffic pattern - requests in bursts with quiet periods';
  } else if (isSteady) {
    description = 'Steady traffic pattern - consistent request rate';
  } else {
    description = 'Mixed traffic pattern - bursts and steady flow';
  }

  return {
    pattern_type: 'burst',
    description: description,
    is_bursty: isBursty,
    is_steady: isSteady,
    coefficient_of_variation: coefficientOfVariation.toFixed(2),
    avg_interval_ms: round(avgInterval),
    suggested_queue_size: recommendedQueueSize,
    confidence: confidence
  };
}
```

**Coefficient of Variation Interpretation**

```
CV < 0.5:  Very steady traffic
           - Requests arrive at regular intervals
           - Small queue sufficient (10 requests)

CV 0.5-1.0: Moderately variable
            - Some bursts, mostly steady
            - Medium queue recommended (25 requests)

CV 1.0-1.5: Bursty traffic
            - Clear burst patterns
            - Larger queue needed (50 requests)

CV > 1.5:   Highly bursty
            - Very uneven arrival times
            - Large queue essential (100 requests)
```

**Example Output**

```javascript
{
  pattern_type: 'burst',
  description: 'Bursty traffic pattern - requests in bursts with quiet periods',
  is_bursty: true,
  is_steady: false,
  coefficient_of_variation: 2.3,
  avg_interval_ms: 45000,    // 45 seconds average between requests
  suggested_queue_size: 100,
  confidence: 0.82,
  data: {
    interval_stats: {
      mean: 45000,
      std_dev: 103500,
      min: 500,              // Shortest gap: 0.5 seconds
      max: 300000            // Longest gap: 5 minutes
    }
  }
}
```

### Pattern Storage and Retrieval

**Database Schema**

```sql
CREATE TABLE usage_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT UNIQUE NOT NULL,
  agent_wallet TEXT,

  -- Pattern characteristics
  pattern_type TEXT NOT NULL,        -- 'time_of_day', 'day_of_week', 'burst'
  provider TEXT,
  model TEXT,

  -- Pattern metrics
  avg_requests_per_minute REAL,
  peak_requests_per_minute INTEGER,
  typical_window TEXT,               -- 'morning', 'afternoon', etc.
  confidence REAL DEFAULT 0.5,       -- 0.0-1.0

  -- Recommendations
  suggested_limit INTEGER,
  suggested_queue_size INTEGER,

  -- Metadata
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_observed DATETIME,
  observation_count INTEGER DEFAULT 1
);
```

**Pattern Application**

```javascript
async function applyPatterns(agentWallet, provider, model) {
  // 1. Get stored patterns
  const patterns = await getStoredPatterns(agentWallet);

  // 2. Find applicable patterns
  const applicablePatterns = patterns.filter(p =>
    p.provider === provider &&
    (p.model === model || p.model === null) &&
    p.confidence >= 0.6
  );

  // 3. Apply highest-confidence pattern
  if (applicablePatterns.length > 0) {
    const bestPattern = applicablePatterns.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    // 4. Adjust limits based on pattern
    if (bestPattern.suggested_limit) {
      await updateRateLimit(provider, model, {
        requests_per_minute: bestPattern.suggested_limit
      });
    }

    if (bestPattern.suggested_queue_size) {
      await updateQueueSize(agentWallet, bestPattern.suggested_queue_size);
    }
  }
}
```

---

## Queue Management

### Queue Architecture

**FIFO with Priority**

```javascript
class RequestQueue {
  // Queue structure
  {
    queue_id: 'abc123-def456',
    agent_wallet: '0xABC...',
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    priority: 5,                 // 1-10, higher = more urgent
    queued_at: '2026-02-12T14:32:45Z',
    retry_count: 0,
    max_retries: 3,
    status: 'pending',           // 'pending', 'processing', 'completed', 'failed'
    request_data: { ... }        // Serialized request
  }
}
```

**Queue Operations**

```javascript
// Enqueue request
async function enqueue(agentWallet, provider, model, requestData, priority = 5) {
  const queueId = randomUUID();

  // Check queue size limit
  const currentSize = await getQueueSize(agentWallet);
  const quota = await checkQuotaAvailable(agentWallet);

  if (currentSize >= quota.max_queue_size) {
    throw new Error(`Queue full (${currentSize}/${quota.max_queue_size})`);
  }

  // Insert into queue
  await db.run(`
    INSERT INTO request_queue (
      queue_id, agent_wallet, provider, model,
      request_data, priority, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, queueId, agentWallet, provider, model,
     JSON.stringify(requestData), priority);

  return queueId;
}

// Dequeue next request
async function dequeue() {
  // Get highest priority pending request
  const queued = await db.get(`
    SELECT * FROM request_queue
    WHERE status = 'pending' AND retry_count < max_retries
    ORDER BY priority DESC, queued_at ASC
    LIMIT 1
  `);

  if (!queued) return null;

  // Mark as processing
  await db.run(`
    UPDATE request_queue
    SET status = 'processing', processed_at = CURRENT_TIMESTAMP
    WHERE queue_id = ?
  `, queued.queue_id);

  return queued;
}

// Complete queued request
async function complete(queueId, success, error = null) {
  const status = success ? 'completed' : 'failed';

  await db.run(`
    UPDATE request_queue
    SET status = ?, error = ?, retry_count = retry_count + ?
    WHERE queue_id = ?
  `, status, error, success ? 0 : 1, queueId);
}
```

### Queue Processing

**Dequeue Trigger**

```javascript
// Triggered after every successful request (in provider-after hook)
async function afterProvider(requestId, provider, model, agentId, sessionId, request, response) {
  // 1. Update windows with actual token usage
  await updateWindowCounts(...);

  // 2. Check if agent has Pro tier and queuing enabled
  const quota = await checkQuotaAvailable(agentWallet);
  if (quota.tier === 'pro' && quota.can_queue) {
    // 3. Process queue
    await processQueue(agentWallet);
  }
}

async function processQueue(agentWallet) {
  const queueSize = await getQueueSize(agentWallet);
  if (queueSize === 0) return;

  // Try to process up to 5 queued requests
  for (let i = 0; i < min(5, queueSize); i++) {
    const queued = await dequeue();
    if (!queued) break;

    // Check if we can now process this request
    const wouldExceed = await wouldExceedLimit(
      queued.agent_wallet,
      queued.provider,
      queued.model,
      'per_minute'
    );

    if (!wouldExceed.exceeded) {
      // Can process - increment windows and complete
      await incrementWindow(...);
      await complete(queued.queue_id, true);

      const queueTime = Date.now() - new Date(queued.queued_at).getTime();
      console.log(`Processed queued request ${queued.queue_id} (waited ${queueTime}ms)`);
    } else {
      // Still would exceed - re-queue for later
      await db.run(`
        UPDATE request_queue SET status = 'pending' WHERE queue_id = ?
      `, queued.queue_id);
      break;  // Don't process more
    }
  }
}
```

### Priority Queuing

**Priority Levels**

```
Priority 1-2:  Low priority (batch processing, background tasks)
Priority 3-4:  Below normal
Priority 5:    Normal (default)
Priority 6-7:  Above normal
Priority 8-9:  High priority (user-facing, time-sensitive)
Priority 10:   Critical (emergency, system tasks)
```

**Priority Assignment**

```javascript
// User-facing request
await enqueue(agentWallet, provider, model, requestData, priority: 8);

// Background analytics
await enqueue(agentWallet, provider, model, requestData, priority: 2);

// Normal request
await enqueue(agentWallet, provider, model, requestData, priority: 5);
```

**Dequeue Order**

```sql
-- Highest priority first, then oldest
SELECT * FROM request_queue
WHERE status = 'pending'
ORDER BY priority DESC, queued_at ASC
LIMIT 1;
```

### Queue Metrics

```javascript
async function getQueueMetrics(agentWallet) {
  // Queue size
  const size = await db.get(`
    SELECT COUNT(*) as size FROM request_queue
    WHERE agent_wallet = ? AND status = 'pending'
  `, agentWallet);

  // Average wait time
  const avgWait = await db.get(`
    SELECT AVG(
      (julianday(processed_at) - julianday(queued_at)) * 24 * 60 * 60 * 1000
    ) as avg_wait_ms
    FROM request_queue
    WHERE agent_wallet = ? AND status = 'completed'
      AND processed_at > datetime('now', '-1 day')
  `, agentWallet);

  // Processing rate
  const processRate = await db.get(`
    SELECT COUNT(*) * 1.0 / 60 as per_minute
    FROM request_queue
    WHERE agent_wallet = ? AND status = 'completed'
      AND processed_at > datetime('now', '-1 hour')
  `, agentWallet);

  return {
    queue_size: size.size,
    avg_wait_time_ms: avgWait.avg_wait_ms || 0,
    processing_rate_per_minute: processRate.per_minute || 0
  };
}
```

---

## Integration with OpenClaw Tools

### Hook Execution Order

```
Request Flow:

1. request:before hooks (preprocessing)
   - Memory System: Load relevant memories
   - Context Optimizer: Compress context

2. provider:before hooks (pre-API-call)
   - Smart Router: Select optimal model
   - RATE LIMIT MANAGER: Check rate limits ← RUNS BEFORE COST GOVERNOR
   - Cost Governor: Check budget

3. API Call to Provider

4. provider:after hooks (post-API-call)
   - Cost Governor: Track tokens and cost
   - RATE LIMIT MANAGER: Update windows, process queue
   - Smart Router: Record routing outcome
   - Memory System: Store important information

5. session:end hooks (cleanup)
   - RATE LIMIT MANAGER: Analyze patterns, report usage
   - Cost Governor: Report session costs
   - Memory System: Persist memories
```

### Smart Router Integration

**Scenario: Model selection impacts rate limits**

```javascript
// Smart Router selects model (provider:before, priority 1)
async function smartRouterBefore(context) {
  const complexity = analyzeComplexity(context.requestData);

  if (complexity > 0.8) {
    context.model = 'claude-opus-4-5';
  } else if (complexity > 0.5) {
    context.model = 'claude-sonnet-4-5';
  } else {
    context.model = 'claude-haiku-4-5';
  }

  // Pass to next hook
  return context;
}

// Rate Limit Manager checks limits for selected model (provider:before, priority 2)
async function rateLimitBefore(context) {
  const { provider, model, agentId } = context;

  const wouldExceed = await wouldExceedLimit(agentId, provider, model);

  if (wouldExceed.exceeded) {
    // Try to queue (Pro tier) or block (Free tier)
    if (canQueue(agentId)) {
      await enqueue(agentId, provider, model, context.requestData);
      throw new Error('Request queued - rate limit approached');
    } else {
      throw new Error('Rate limit exceeded');
    }
  }

  // Allowed - proceed
  return context;
}
```

### Cost Governor Integration

**Scenario: Rate Limit Manager runs BEFORE Cost Governor**

```javascript
// Rate Limit Manager blocks rate-limited requests (provider:before, priority 1)
async function rateLimitBefore(context) {
  if (wouldExceedLimit(...)) {
    throw new Error('Rate limit exceeded');
    // Request never reaches Cost Governor
  }
  return context;
}

// Cost Governor only tracks requests that passed rate limit check (provider:before, priority 2)
async function costGovernorBefore(context) {
  // This only runs if Rate Limit Manager allowed the request
  if (wouldExceedBudget(...)) {
    throw new Error('Budget exceeded');
  }
  return context;
}

// Result: Rate-limited requests are NOT tracked as costs
```

### Memory System Integration

**Scenario: Persist patterns as memories**

```javascript
// Rate Limit Manager analyzes patterns (session:end)
async function rateLimitSessionEnd(sessionId, agentWallet) {
  const patterns = await detector.analyzeUsage(agentWallet);

  for (const pattern of patterns.patterns) {
    // Store pattern as memory
    await memorySystem.store({
      type: 'rate_limit_pattern',
      content: pattern.description,
      metadata: {
        pattern_type: pattern.pattern_type,
        confidence: pattern.confidence,
        suggested_limit: pattern.suggested_limit,
        detected_at: new Date().toISOString()
      },
      relevance: pattern.confidence
    });
  }
}

// Next session: Recall patterns
async function rateLimitSessionStart(sessionId, agentWallet) {
  const memories = await memorySystem.recall({
    type: 'rate_limit_pattern',
    limit: 5
  });

  // Apply highest-confidence pattern
  if (memories.length > 0) {
    const bestPattern = memories.reduce((best, m) =>
      m.metadata.confidence > best.metadata.confidence ? m : best
    );

    await applyPattern(agentWallet, bestPattern.metadata);
  }
}
```

### Context Optimizer Integration

**Scenario: Reduced tokens = less rate limit pressure**

```javascript
// Context Optimizer compresses context (request:before)
async function contextOptimizerBefore(context) {
  const original = context.requestData.messages;
  const compressed = await compressor.compress(original);

  context.requestData.messages = compressed;
  context._context_metrics = {
    original_tokens: estimateTokens(original),
    compressed_tokens: estimateTokens(compressed),
    reduction: 1 - estimateTokens(compressed) / estimateTokens(original)
  };

  return context;
}

// Rate Limit Manager uses reduced token count (provider:before)
async function rateLimitBefore(context) {
  const estimatedTokens = context._context_metrics?.compressed_tokens || 0;

  // Check token limit with compressed estimate
  const wouldExceed = await wouldExceedTokenLimit(
    agentWallet, provider, model, estimatedTokens
  );

  // Compression may allow request that would otherwise be blocked
  if (!wouldExceed) {
    return context;  // Allowed thanks to compression
  }
}
```

---

## Advanced Topics

### Adaptive Rate Limiting

**Dynamic Limit Adjustment**

```javascript
// Adjust limits based on provider feedback
async function handleProviderResponse(response, agentWallet, provider) {
  if (response.status === 429) {
    // Provider returned rate limit error despite our tracking
    // → Provider limits are stricter than we thought

    const headers = response.headers;
    const resetTime = headers['x-ratelimit-reset'];
    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];

    // Adjust our limits downward
    const currentLimit = await getCurrentLimit(provider);
    const newLimit = Math.floor(currentLimit * 0.8);  // Reduce by 20%

    await updateRateLimit(provider, {
      requests_per_minute: newLimit
    });

    console.warn(`[Adaptive Limiting] Reduced ${provider} limit to ${newLimit} (was ${currentLimit})`);
  } else if (response.headers['x-ratelimit-remaining']) {
    // Provider is giving us rate limit feedback
    // → Use it to fine-tune our limits

    const remaining = parseInt(response.headers['x-ratelimit-remaining']);
    const limit = parseInt(response.headers['x-ratelimit-limit']);

    // If provider limit is higher than ours, we can increase
    if (limit > currentLimit) {
      await updateRateLimit(provider, {
        requests_per_minute: limit
      });
    }
  }
}
```

### Distributed Rate Limiting

**Multi-Agent Coordination**

```javascript
// Problem: Multiple agents sharing the same API key
// → Need to coordinate rate limits across agents

// Solution: Shared rate limit pool
class DistributedRateLimiter {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async checkLimit(apiKey, provider, limit, windowSeconds) {
    const key = `rate_limit:${apiKey}:${provider}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    // Remove old entries outside window
    await this.redis.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    const count = await this.redis.zcard(key);

    if (count >= limit) {
      return { exceeded: true, current: count, limit };
    }

    // Add current request
    await this.redis.zadd(key, now, randomUUID());

    // Set expiration
    await this.redis.expire(key, windowSeconds);

    return { exceeded: false, current: count + 1, limit };
  }
}
```

### Token Bucket Algorithm (Alternative)

**Token Bucket vs Sliding Window**

```javascript
// Token Bucket: Tokens are added at constant rate
class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;          // Maximum tokens
    this.tokens = capacity;             // Current tokens
    this.refillRate = refillRate;       // Tokens per second
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;  // seconds
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  consume(tokens = 1) {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;   // Allowed
    } else {
      return false;  // Blocked
    }
  }

  getAvailableTokens() {
    this.refill();
    return this.tokens;
  }
}

// Usage
const bucket = new TokenBucket(100, 10);  // 100 capacity, 10/second refill

if (bucket.consume(5)) {
  // Make request (consumed 5 tokens)
} else {
  // Rate limited
}
```

**Comparison**

| Feature | Sliding Window | Token Bucket |
|---------|---------------|--------------|
| Accuracy | High | Medium |
| Burst handling | Limited | Excellent |
| Implementation complexity | Medium | Low |
| Memory usage | Higher | Lower |
| Multi-window support | Native | Requires multiple buckets |

Rate Limit Manager uses **sliding windows** for accuracy and multi-window support.

### Predictive Rate Limiting

**Forecast future usage to prevent limit violations**

```javascript
async function predictNextHourUsage(agentWallet) {
  // 1. Get historical usage for same hour/day-of-week
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  const historicalEvents = await db.all(`
    SELECT COUNT(*) as count
    FROM rate_limit_events
    WHERE agent_wallet = ?
      AND strftime('%H', timestamp) = ?
      AND strftime('%w', timestamp) = ?
      AND timestamp > datetime('now', '-30 days')
    GROUP BY date(timestamp)
  `, agentWallet, currentHour.toString().padStart(2, '0'), currentDay.toString());

  // 2. Calculate average and variance
  const counts = historicalEvents.map(e => e.count);
  const avgCount = mean(counts);
  const stdDev = sqrt(calculateVariance(counts, avgCount));

  // 3. Predict with confidence interval
  const prediction = {
    expected: Math.round(avgCount),
    low: Math.round(avgCount - stdDev),      // 68% confidence interval
    high: Math.round(avgCount + stdDev),
    confidence: counts.length >= 10 ? 0.8 : 0.4
  };

  // 4. Recommend pre-emptive action
  const currentLimit = await getCurrentLimit(agentWallet);

  if (prediction.high > currentLimit * 0.9) {
    console.warn(`[Predictive Limiting] Usage likely to approach limit in next hour`);
    console.warn(`Expected: ${prediction.expected}, Limit: ${currentLimit}`);
    console.warn(`Recommendation: Increase limit or prepare for queuing`);
  }

  return prediction;
}
```

---

## Conclusion

OpenClaw Rate Limit Manager provides comprehensive, proactive rate limit management using:

1. **Sliding Window Algorithm** - Accurate, fair enforcement across multiple time periods
2. **Provider-Specific Configurations** - Tailored limits for Anthropic, OpenAI, Google
3. **Pattern Detection** - Machine learning for time-of-day, day-of-week, burst patterns
4. **Intelligent Queuing** - Graceful handling of traffic bursts (Pro tier)
5. **Seamless Integration** - Works with Smart Router, Cost Governor, Memory System, Context Optimizer

For more information:
- [README.md](README.md) - User guide and getting started
- [SKILL.md](SKILL.md) - ClawHub skill description
- [AGENT-PAYMENTS.md](AGENT-PAYMENTS.md) - x402 payment guide

**Built by the OpenClaw community** | Part of the [OpenClaw Ecosystem](https://clawhub.ai)
