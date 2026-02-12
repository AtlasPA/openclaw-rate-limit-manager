# Awesome Claude Code Resource Submission - Security Suite

**Submission URL:** https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml

---

## Form Fields

### Display Name
```
OpenClaw Security Suite
```

### Category
```
Tooling
```

### Sub-Category
```
Tooling: Security
```

### Primary Link
```
https://github.com/AtlasPA/openclaw-security
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
Unified security orchestrator that installs, configures, and manages all 11 OpenClaw security tools in one command. Complete workspace protection: integrity monitoring (Warden), secret scanning (Sentry), credential protection (Vault), permission auditing (Arbiter), network DLP (Egress), supply chain analysis (Sentinel), signing verification (Signet), prompt injection defense (Bastion), compliance enforcement (Marshal), audit trails (Ledger), and incident response (Triage). Single dashboard for unified security status and full workspace scans.
```

### Validate Claims
```
1. Install the suite: `git clone https://github.com/AtlasPA/openclaw-security.git && cp -r openclaw-security ~/.openclaw/workspace/skills/`
2. Install all 11 tools: `python3 scripts/security.py install`
3. Initialize security: `python3 scripts/security.py setup`
4. Check security status: `python3 scripts/security.py status` (unified dashboard across all 11 tools)
5. Run full scan: `python3 scripts/security.py scan` (runs all scanners in logical order)
6. Observe comprehensive security coverage: supply chain → signing → integrity → injection → secrets → credentials → permissions → network → compliance → audit → incidents
```

### Specific Task(s)
```
Install the OpenClaw Security Suite and run a full workspace scan. Observe how it orchestrates all 11 security tools to provide comprehensive protection and presents a unified security dashboard.
```

### Specific Prompt(s)
```
"Install the OpenClaw Security Suite and show me the security status of my workspace. Run a full security scan to identify any vulnerabilities."
```

### Additional Comments
```
This security suite orchestrates 11 specialized OpenClaw security tools: Sentinel (supply chain), Signet (signing), Warden (integrity), Bastion (injection defense), Sentry (secret scanning), Vault (credential lifecycle), Arbiter (permissions), Egress (network DLP), Marshal (compliance), Ledger (audit trails), and Triage (incident response). Each tool can be used independently, but the suite provides unified installation, configuration, and monitoring.
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
