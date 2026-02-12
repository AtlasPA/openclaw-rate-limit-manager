# OpenClaw Rate Limit Manager

**Eliminate 429 errors and workflow interruptions with intelligent rate limit management.**

Stop wasting time on rate limit errors. Rate Limit Manager proactively tracks, manages, and optimizes API rate limits across all providers using sliding windows, request queuing, and pattern learning. It prevents 429 errors before they happen and ensures smooth operation even under high traffic.

**Agent-powered economy** - agents can autonomously pay 0.5 USDT/month for unlimited queuing and pattern learning. [Agent Payments Guide](AGENT-PAYMENTS.md)

## The Problem

OpenClaw agents frequently encounter rate limiting issues:
- 429 "Too Many Requests" errors interrupt workflows mid-task
- Wasted time waiting through retry delays and exponential backoff
- Unpredictable failures when multiple tools make concurrent requests
- Lost work when requests are rejected due to exceeded quotas
- No visibility into which providers or models are approaching limits
- Multiple OpenClaw tools competing for the same rate limit quota

## The Solution

**Proactive rate limit management that prevents 429 errors using sliding windows, intelligent queuing, and usage pattern learning.**

## Features

- Real-time sliding window tracking (per-minute, per-hour, per-day)
- Provider-specific rate limits (Anthropic, OpenAI, Google)
- Request queuing for Pro tier (handle traffic bursts gracefully)
- Pattern detection and learning (Pro tier)
- Zero 429 errors - blocks requests before they violate limits
- Multi-window enforcement (requests AND tokens)
- CLI and dashboard for monitoring
- x402 agent payments for autonomous upgrades
- Integrates seamlessly with all OpenClaw tools

## Why Rate Limit Manager?

**The ONLY OpenClaw tool that proactively manages rate limits across all providers with sliding windows and intelligent queuing.**

| Feature | Rate Limit Manager | Manual Retry Logic | Simple Throttling | No Rate Management |
|---------|-------------------|-------------------|-------------------|-------------------|
| Prevents 429 Errors | ✅ | ❌ | ⚠️ | ❌ |
| Sliding Window Tracking | ✅ | ❌ | ❌ | ❌ |
| Request Queuing | ✅ (Pro) | ❌ | ❌ | ❌ |
| Pattern Learning | ✅ (Pro) | ❌ | ❌ | ❌ |
| Multi-Window (min/hour/day) | ✅ | ❌ | ❌ | ❌ |
| Token-Based Limiting | ✅ | ❌ | ❌ | ❌ |
| x402 Payments | ✅ | ❌ | ❌ | ❌ |
| ClawHub Skill | ✅ | ❌ | ❓ | ❌ |
| Free Tier | ✅ | ✅ | ✅ | ✅ |
| Zero Workflow Interruptions | ✅ | ❌ | ⚠️ | ❌ |

**Rate Limit Manager + Smart Router + Cost Governor = Complete API Management**

Economic rationale: If preventing just one rate limit error saves 5 minutes of agent time (worth far more than $0.50), Pro tier pays for itself.

## Installation

```bash
# From within your OpenClaw directory
npm install openclaw-rate-limit-manager

# Or install as OpenClaw skill
claw skill install openclaw-rate-limit-manager

# Run setup wizard
npm run setup
```

## Quick Start

```bash
# Check current rate limit status
claw rate-limit status --wallet=0xYourWallet

# View active windows
claw rate-limit windows --wallet=0xYourWallet

# View usage patterns (Pro tier)
claw rate-limit patterns --wallet=0xYourWallet

# Check queue status
claw rate-limit queue --wallet=0xYourWallet

# Check license status
claw rate-limit license --wallet=0xYourWallet

# Open dashboard
claw rate-limit dashboard
```

## How It Works

### Sliding Window Algorithm

Rate Limit Manager uses a sliding window algorithm to track API usage in real-time:

```
Time: 0s -------- 30s -------- 60s -------- 90s -------- 120s
      |           |            |            |            |
      [---- Window 1 (60s) ----]
                  [---- Window 2 (60s) ----]
                               [---- Window 3 (60s) ----]

Requests: 20      30           40           25           15

At 60s: Window 1 complete (50 total) → Rotates to Window 2
At 90s: Window 2 active (40 total) → Under limit
At 120s: Window 3 active (25 total) → Under limit
```

**Key advantages over fixed windows:**
- No artificial reset periods
- Smooth limit enforcement
- Prevents burst abuse
- More accurate tracking

### Pipeline Integration

```
User Request
    ↓
┌──────────────────────────────────────────┐
│   Smart Router (request-before)          │
│   - Select optimal model                 │
└──────────────┬───────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│   Context Optimizer (request-before)     │
│   - Compress context                     │
└──────────────┬───────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│  RATE LIMIT MANAGER (provider-before)    │
│  1. Check rate limits for provider/model │
│  2. Check sliding windows (min/hour/day) │
│  3. Allow request OR queue/block         │
│  4. Update request counts                │
└──────────────┬───────────────────────────┘
               │
               ↓
┌──────────────────────────────────────────┐
│   Cost Governor (provider-before)        │
│   - Validate budget, track request       │
└──────────────┬───────────────────────────┘
               ↓
         Model API Call
               ↓
┌──────────────────────────────────────────┐
│   Cost Governor (provider-after)         │
│   - Track tokens, calculate cost         │
└──────────────┬───────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│  RATE LIMIT MANAGER (provider-after)     │
│  - Record actual usage                   │
│  - Update sliding windows                │
│  - Learn usage patterns                  │
│  - Dequeue waiting requests if available │
└──────────────┬───────────────────────────┘
               ↓
         Response to User
```

## Free vs Pro Tier

### Free Tier
- ✅ 100 requests/minute shared across all providers
- ✅ Basic sliding window tracking
- ✅ Per-minute, per-hour, per-day windows
- ✅ Hard blocks when limits exceeded
- ✅ CLI interface
- ✅ Web dashboard
- ❌ No request queuing
- ❌ No pattern learning

### Pro Tier (0.5 USDT/month)
- ✅ **Provider-specific rate limits** - Anthropic, OpenAI, Google each have separate limits
- ✅ **Request queuing** - Gracefully handle traffic bursts (queue size: 50-100)
- ✅ **Pattern learning** - Detect time-of-day, day-of-week, burst patterns
- ✅ **Usage predictions** - Forecast peak periods
- ✅ **Custom limits** - Configure your own rate limits
- ✅ **Priority queuing** - High-priority requests processed first
- ✅ **Detailed analytics** - Pattern insights, queue performance
- ✅ **Export capabilities** - Download usage history

**[Upgrade to Pro via x402](AGENT-PAYMENTS.md)**

## Provider Rate Limits

Default rate limits for common providers:

### Anthropic (Claude)

**Free Tier:**
- 50 requests/minute
- 1,000 requests/day
- 40,000 tokens/minute
- 300,000 tokens/day

**Pro Tier:**
- 1,000 requests/minute
- 10,000 requests/day
- 80,000 tokens/minute
- 2,500,000 tokens/day

### OpenAI (GPT)

**Free Tier:**
- 60 requests/minute
- 200 requests/day
- 40,000 tokens/minute

**Pro Tier:**
- 500 requests/minute
- 10,000 requests/day
- 150,000 tokens/minute

### Google (Gemini)

**Free Tier:**
- 60 requests/minute
- 1,500 requests/day

**Pro Tier:**
- 1,000 requests/minute
- 15,000 requests/day

**Note:** These are OpenClaw Rate Limit Manager limits. Actual provider limits may vary based on your API tier.

## Rate Limit Enforcement

### Multi-Window Tracking

Rate Limit Manager tracks THREE types of windows simultaneously:

1. **Per-Minute Window** - Prevents short-term bursts
2. **Per-Hour Window** - Prevents sustained high traffic
3. **Per-Day Window** - Prevents daily quota exhaustion

A request is blocked if ANY window would be exceeded.

### Token-Based Limiting

Some providers limit by tokens, not just requests:

```javascript
Request #1: 1,000 tokens → Allowed (1,000/40,000 tokens used)
Request #2: 5,000 tokens → Allowed (6,000/40,000 tokens used)
Request #3: 35,000 tokens → Blocked (would exceed 40,000 token limit)
```

### Request Queuing (Pro Tier)

When limits are approached, Pro tier queues requests instead of blocking:

```bash
# Free tier (hard block)
[Rate Limit Manager] Rate limit exceeded for per_minute: 100/100 (100.0%).
Upgrade to Pro for request queuing and higher limits.

# Pro tier (graceful queuing)
[Rate Limit Manager] Request queued (ID: abc123-def456).
Rate limit for per_minute: 100/100 (100.0%)
[Rate Limit Manager] Processed queued request abc123-def456 (waited 15000ms)
```

## Pattern Learning (Pro Tier)

Rate Limit Manager learns your usage patterns to optimize limits:

### Time-of-Day Patterns

```bash
Pattern detected: Peak usage during hours: 9, 10, 11, 14, 15
Suggested limit: 120 requests/minute (20% buffer over peak)
Confidence: 85%

Action: Increase limits during 9-11am and 2-3pm
```

### Day-of-Week Patterns

```bash
Pattern detected: Weekday-heavy usage pattern
Peak days: Monday, Wednesday, Friday
Confidence: 78%

Action: Consider higher limits on weekdays
```

### Burst vs Steady Patterns

```bash
Pattern detected: Bursty traffic pattern - requests come in bursts with quiet periods
Coefficient of Variation: 2.3
Suggested queue size: 100
Confidence: 82%

Action: Increase queue size to handle bursts
```

## CLI Commands

```bash
# Show current rate limit status
claw rate-limit status --wallet=0xYourWallet

# View active windows
claw rate-limit windows --wallet=0xYourWallet

# Show usage patterns (Pro tier)
claw rate-limit patterns --wallet=0xYourWallet

# View request queue
claw rate-limit queue --wallet=0xYourWallet

# Configure limits (Pro tier)
claw rate-limit set-limit --provider=anthropic --rpm=150 --wallet=0xYourWallet

# Check license status
claw rate-limit license --wallet=0xYourWallet

# Subscribe to Pro tier
claw rate-limit subscribe --wallet=0xYourWallet

# Start dashboard
claw rate-limit dashboard --port=9094

# View usage predictions (Pro tier)
claw rate-limit predict --wallet=0xYourWallet

# Export usage history
claw rate-limit export --format=csv --output=rate-limits.csv
```

## Dashboard

Open `http://localhost:9094` to see:

- **Real-time windows** - Live view of all sliding windows
- **Request queue** - Pending requests and queue size
- **Usage charts** - Visual timeline of API usage
- **Pattern insights** - Detected patterns and recommendations
- **Provider breakdown** - Usage by provider (Anthropic, OpenAI, Google)
- **License status** - Free vs Pro tier, upgrade options
- **Event history** - Timeline of allowed, blocked, queued requests

## API Endpoints

Rate Limit Manager provides a REST API for programmatic access:

```bash
# Check if request would be allowed
POST /api/check
{
  "agent_wallet": "0x...",
  "provider": "anthropic",
  "model": "claude-opus-4-5"
}

# Response:
{
  "allowed": true,
  "windows": {
    "per_minute": { "current": 45, "limit": 50, "percent": 90 },
    "per_hour": { "current": 230, "limit": 1000, "percent": 23 },
    "per_day": { "current": 1200, "limit": 10000, "percent": 12 }
  }
}

# Get current status
GET /api/status?agent_wallet=0x...

# Get active windows
GET /api/windows?agent_wallet=0x...

# Get queue status
GET /api/queue?agent_wallet=0x...

# Get usage patterns (Pro tier)
GET /api/patterns?agent_wallet=0x...

# Get usage predictions (Pro tier)
GET /api/predict?agent_wallet=0x...

# x402 payment endpoints
POST /api/x402/subscribe
POST /api/x402/verify
GET /api/x402/license/:wallet
```

## Configuration

During setup, you'll configure:
- Agent wallet address (for quota tracking)
- Provider-specific limits (optional)
- Queue size for Pro tier (default: 50)
- Pattern learning preferences
- Dashboard port (default: 9094)

Configuration is stored in `~/.openclaw/openclaw-rate-limit-manager/config.json`

### Configuration Example

```json
{
  "agent_wallet": "0x1234...5678",
  "tier": "pro",
  "providers": {
    "anthropic": {
      "requests_per_minute": 1000,
      "requests_per_day": 10000,
      "tokens_per_minute": 80000,
      "tokens_per_day": 2500000
    },
    "openai": {
      "requests_per_minute": 500,
      "requests_per_day": 10000,
      "tokens_per_minute": 150000
    }
  },
  "queue": {
    "enabled": true,
    "max_size": 100,
    "priority_enabled": true
  },
  "pattern_learning": {
    "enabled": true,
    "min_events": 10,
    "min_confidence": 0.6
  },
  "dashboard": {
    "port": 9094,
    "enabled": true
  }
}
```

## Integration with Other Tools

### Smart Router Integration

Smart Router runs BEFORE Rate Limit Manager to select the model, then Rate Limit Manager checks limits:

```javascript
// 1. Smart Router selects model
selectedModel = "claude-opus-4-5"

// 2. Rate Limit Manager checks limits for that model
rateLimitOK = checkLimit("anthropic", "claude-opus-4-5")

// 3. If OK, proceed; if not, queue or block
```

### Cost Governor Integration

Rate Limit Manager runs BEFORE Cost Governor to prevent rate-limited requests from being tracked as costs:

```javascript
// 1. Rate Limit Manager checks limits
if (rateLimitExceeded) {
  throw Error("Rate limit exceeded")
  // Request never reaches Cost Governor
}

// 2. Cost Governor tracks cost
recordCost(...)
```

### Memory System Integration

Pattern learning data can be stored as memories:

```bash
claw skill install openclaw-memory
claw skill install openclaw-rate-limit-manager
```

Patterns are persisted across sessions for better learning.

### Context Optimizer Integration

Combine to reduce both tokens and rate limit pressure:

- **Context Optimizer** - Reduces token usage (40-60% reduction)
- **Rate Limit Manager** - Prevents rate limit violations
- **Together** - Maximum efficiency with minimal 429 errors

## Examples

### Example 1: Normal Usage (Free Tier)

```bash
Request #1 → Allowed (1/100 requests per minute)
Request #2 → Allowed (2/100 requests per minute)
...
Request #100 → Allowed (100/100 requests per minute)
Request #101 → Blocked (rate limit exceeded)

[Rate Limit Manager] Rate limit exceeded for per_minute: 100/100 (100.0%)
```

### Example 2: Queuing (Pro Tier)

```bash
Request #1-100 → Allowed (100/1000 requests per minute)
Request #101-150 → Queued (queue size: 50/100)

[Rate Limit Manager] Request queued (ID: abc123)
[After 30s, window rotates]
[Rate Limit Manager] Processed queued request abc123 (waited 30000ms)
```

### Example 3: Pattern Learning (Pro Tier)

```bash
Week 1: Heavy usage Mon-Fri 9am-5pm
Week 2: Same pattern detected
Week 3: Pattern confirmed

[Pattern Learning] Weekday-heavy usage detected (confidence: 88%)
Suggested limit: 150 requests/minute during 9am-5pm weekdays
```

### Example 4: Multi-Provider Usage

```bash
# Anthropic requests (separate limit)
Anthropic Request #1 → Allowed (1/50 per minute)
Anthropic Request #50 → Allowed (50/50 per minute)
Anthropic Request #51 → Blocked

# OpenAI requests (separate limit)
OpenAI Request #1 → Allowed (1/60 per minute)
OpenAI Request #60 → Allowed (60/60 per minute)
OpenAI Request #61 → Blocked
```

### Example 5: Token-Based Limiting

```bash
Request #1: 5,000 tokens → Allowed (5,000/40,000 tokens per minute)
Request #2: 10,000 tokens → Allowed (15,000/40,000 tokens per minute)
Request #3: 30,000 tokens → Blocked (would exceed 40,000 token limit)

[Rate Limit Manager] Token limit exceeded: 45,000/40,000 (112.5%)
```

## Statistics Dashboard

```bash
$ claw rate-limit status --wallet=0xYourWallet

Rate Limit Manager Status
─────────────────────────────────────────
Tier: Pro (unlimited)
Queue: 3 pending, 12 completed today

Active Windows:
Provider: anthropic
  per_minute: 42/1000 requests (4.2%), 15,230/80,000 tokens (19.0%)
  per_hour: 234/10000 requests (2.3%), 89,450/2500000 tokens (3.6%)
  per_day: 1,247/10000 requests (12.5%), 458,920/2500000 tokens (18.4%)

Provider: openai
  per_minute: 18/500 requests (3.6%), 8,450/150,000 tokens (5.6%)
  per_day: 89/10000 requests (0.9%)

Pattern Learning:
- 3 patterns detected (avg confidence: 82%)
- Time-of-day: Peak usage 9-11am, 2-4pm
- Day-of-week: Weekday-heavy pattern
- Burst: Moderate burst traffic (CV: 1.3)

Recommendations:
- Consider queue size of 50 for burst handling
- Increase limits during peak hours (9-11am)

Events (Last Hour):
- Allowed: 234
- Blocked: 0
- Queued: 3
- 429 Errors: 0 (prevented)
```

## Troubleshooting

### Rate limits too restrictive

```bash
# Check current limits
claw rate-limit status --wallet=0xYourWallet

# Upgrade to Pro for higher limits
claw rate-limit subscribe --wallet=0xYourWallet

# Or configure custom limits (Pro tier)
claw rate-limit set-limit --provider=anthropic --rpm=200
```

### Requests getting queued too often

```bash
# Check queue status
claw rate-limit queue --wallet=0xYourWallet

# Increase queue size (Pro tier)
claw rate-limit config --queue-size=100

# Or increase rate limits
claw rate-limit set-limit --provider=anthropic --rpm=1500
```

### Pattern learning not working

```bash
# Verify Pro tier
claw rate-limit license --wallet=0xYourWallet

# Check if enough data
claw rate-limit patterns --wallet=0xYourWallet

# Patterns require 10+ events over 7 days
```

### Dashboard won't open

```bash
# Check if port 9094 is in use
netstat -an | grep 9094

# Use custom port
claw rate-limit dashboard --port=9095
```

### Still getting 429 errors

```bash
# Check logs
tail -f ~/.openclaw/logs/rate-limit.log

# Verify hooks are installed
ls ~/.openclaw/hooks/

# Test manually
claw rate-limit check --provider=anthropic --model=claude-opus-4-5
```

## Architecture

### Components

1. **LimitStorage** - SQLite database for windows, events, patterns, queue
2. **WindowTracker** - Sliding window implementation (per-minute, per-hour, per-day)
3. **RequestQueue** - Priority queue for Pro tier (FIFO with priority)
4. **PatternDetector** - Machine learning for usage patterns (Pro tier)
5. **X402PaymentHandler** - Autonomous agent payment processing

### Data Storage

All data is stored locally in SQLite:
- `~/.openclaw/openclaw-rate-limit-manager/rate-limit.db`
- Sliding window states
- Rate limit events (allowed, blocked, queued)
- Usage patterns (Pro tier)
- Request queue (Pro tier)
- Payment records

## Privacy

- ✅ All data stored locally (no external servers)
- ✅ No tracking or telemetry
- ✅ Open source (audit the code yourself)
- ✅ Rate limiting happens locally (no API calls for checks)
- ✅ Pattern learning is local-only (Pro tier)

## Performance

- **Rate Limit Check:** <5ms per request
- **Window Update:** <3ms per request
- **Queue Operations:** <10ms
- **Pattern Analysis:** Asynchronous, no blocking
- **Total Overhead:** <10ms per request (negligible)

## Supported Providers

- **Anthropic** (Claude) - Haiku, Sonnet, Opus
- **OpenAI** (GPT) - GPT-3.5, GPT-4, GPT-4-Turbo
- **Google** (Gemini) - Flash, Pro
- **Custom Providers** - Easily add your own

## Compatibility

- OpenClaw v2026.1.30+
- Node.js 18+
- Works with all OpenClaw providers
- OS: Windows, macOS, Linux
- Optional: OpenClaw Memory System (recommended for pattern persistence)
- Optional: OpenClaw Smart Router (recommended for model selection)
- Optional: OpenClaw Cost Governor (recommended for cost control)

## Pro Tier (x402 Payments)

**For AI Agents:** Upgrade to Pro tier by paying 0.5 USDT/month via x402 protocol.

**Pro Features:**
- Provider-specific rate limits (vs shared limits)
- Request queuing (50-100 requests)
- Pattern learning and predictions
- Custom rate limits
- Priority queuing
- Detailed analytics

**[Agent Payment Instructions](AGENT-PAYMENTS.md)**

**For Humans:** Free tier is sufficient for most use cases. Pro tier is valuable for high-traffic agents or those needing zero interruptions.

## Support This Project

If Rate Limit Manager prevented 429 errors and saved you time, consider sponsoring development:

☕ **[Sponsor on GitHub](https://github.com/sponsors/AtlasPA)**
**[Pay via x402](AGENT-PAYMENTS.md)** (for AI agents)

Your sponsorship helps maintain this and other OpenClaw tools.

## What's Next

Rate Limit Manager is part of the growing OpenClaw infrastructure suite:

1. **Cost Governor** - Enforce spending limits and budget controls
2. **Memory System** - Persistent memory across sessions
3. **Context Optimizer** - Intelligent compression (40-60% token savings)
4. **Smart Router** - Intelligent model routing (30-50% cost savings)
5. **Rate Limit Manager** - Proactive rate limit management (you are here)

Install the full suite for maximum efficiency, cost control, and reliability.

---

**Built by the OpenClaw community** | Part of the [OpenClaw Ecosystem](https://clawhub.ai)

Made with care for AI agents everywhere
