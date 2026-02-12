# Awesome Claude Code Resource Submission

**Submission URL:** https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml

---

## Form Fields

### Display Name
```
OpenClaw API Quota Tracker
```

### Category
```
Tooling
```

### Sub-Category
```
Tooling: Usage Monitors
```

### Primary Link
```
https://github.com/AtlasPA/openclaw-api-quota-tracker
```

### Author Name
```
AtlasPA
```

### Author Link
```
https://github.com/AtlasPA
```

### License
```
MIT
```

### Description
```
ToS-compliant API quota monitoring for OpenClaw agents. Keeps you UNDER your allowed limits through proactive tracking with sliding windows (per-minute/hour/day), request queuing within quotas, and pattern learning. This tool PREVENTS rate limit violations by respecting provider limits - it does NOT help circumvent them. Free tier: 100 req/min monitoring. Pro tier (0.5 USDT/month): unlimited with queuing and pattern detection. Ensures compliance with Anthropic, OpenAI, and Google Terms of Service.
```

### Validate Claims
```
1. Install the tool: `cd ~/.openclaw && git clone https://github.com/AtlasPA/openclaw-api-quota-tracker.git && cd openclaw-api-quota-tracker && npm install && npm run setup`
2. Start the dashboard: `npm run dashboard` (runs on http://localhost:9094)
3. Check quota status: `node src/cli.js status --wallet 0xTestWallet`
4. The tool shows current quota usage UNDER your allowed limits
5. Make multiple API calls and observe quota tracking staying within provider limits
6. Observe how it BLOCKS requests that would exceed your quota (ToS-compliant)
```

### Specific Task(s)
```
Install the OpenClaw API Quota Tracker and observe how it monitors your API usage to keep you WITHIN your allowed quotas. Make API calls and see how it prevents requests that would exceed provider limits, ensuring you stay compliant with Terms of Service.
```

### Specific Prompt(s)
```
"Install the OpenClaw API Quota Tracker from ~/.openclaw/openclaw-api-quota-tracker and show me my current quota usage. Demonstrate how it keeps me under my API provider limits."
```

### Additional Comments
```
IMPORTANT: This tool helps users RESPECT and COMPLY with API provider rate limits, not circumvent them. It monitors usage to keep users UNDER their allowed quotas, preventing 429 errors by ensuring compliance with Terms of Service. It does NOT enable bypassing limits, coordinating across accounts, or violating provider policies.

This is part of the OpenClaw ecosystem (5 tools total: Cost Governor, Memory System, Context Optimizer, Smart Router, and API Quota Tracker). All tools use the same x402 payment protocol for Pro tier subscriptions. The API Quota Tracker sits in the provider-before hook to prevent quota-exceeding requests before they reach the API.
```

### Recommendation Checklist
- [x] I have checked that this resource hasn't already been submitted
- [x] My resource provides genuine value to Claude Code users, and any risks are clearly stated
- [x] All provided links are working and publicly accessible
- [x] I am submitting only ONE resource in this issue
- [x] I understand that low-quality or duplicate submissions may be rejected

---

## Instructions

1. Go to: https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml
2. Copy and paste each field from above into the corresponding form field
3. Check all the checkboxes at the bottom
4. Click "Submit new issue"
5. The automated validator will check your submission and post results as a comment

---

## Key Clarifications

**This tool is ToS-COMPLIANT:**
- ✅ Monitors quota usage to stay UNDER allowed limits
- ✅ Blocks requests that would exceed quotas
- ✅ Queues requests WITHIN your allowed limits (Pro tier)
- ✅ Respects all API provider Terms of Service
- ❌ Does NOT help circumvent or bypass rate limits
- ❌ Does NOT enable quota violations
- ❌ Does NOT coordinate across accounts to evade detection
