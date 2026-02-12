# PR Content for awesome-claude-code

**Repository:** https://github.com/hesreallyhim/awesome-claude-code
**Section:** Usage Monitors 📊
**Location:** Add to the Usage Monitors section

## Entry to Add:

```markdown
- [OpenClaw Rate Limit Manager](https://github.com/AtlasPA/openclaw-rate-limit-manager) by [AtlasPA](https://github.com/AtlasPA) - Proactive rate limit management for OpenClaw agents - prevents 429 errors with sliding windows (per-minute/hour/day), request queuing, and pattern learning. Free tier: 100 req/min basic limiting. Pro tier (0.5 USDT/month): unlimited with queuing, pattern detection, and custom limits. Includes CLI with 7 commands and REST API dashboard on port 9094.
```

## PR Title:
```
Add OpenClaw Rate Limit Manager to Usage Monitors
```

## PR Description:
```
### OpenClaw Rate Limit Manager

Added a new entry to the Usage Monitors section for the OpenClaw Rate Limit Manager.

**What it does:**
- Proactive rate limit management for Claude Code API calls
- Prevents 429 errors with sliding window algorithm
- Tracks per-minute, per-hour, and per-day limits across all providers (Anthropic, OpenAI, Google)
- Request queuing for Pro tier users
- Pattern detection for burst vs steady traffic

**Key Features:**
- Free tier: 100 requests/minute basic rate limiting
- Pro tier: 0.5 USDT/month for unlimited requests with queuing and pattern learning
- CLI with 7 commands (status, windows, patterns, queue, set-limit, license, subscribe)
- REST API dashboard on port 9094
- x402 payment protocol integration

**Why add this:**
Rate limiting is a critical infrastructure concern for Claude Code users making frequent API calls, especially when using multiple OpenClaw tools concurrently. This tool helps prevent workflow interruptions from rate limit violations.

**Repository:** https://github.com/AtlasPA/openclaw-rate-limit-manager
```
