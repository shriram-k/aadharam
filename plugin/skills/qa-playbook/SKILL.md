---
name: qa-playbook
description: Procedure for verifying a single Jira acceptance criterion as a manual QA tester using a browser, curl and shell checks, with evidence capture and a structured verdict. Use whenever you are asked to test, verify or QA a ticket or acceptance criterion.
---

# QA playbook

## 1. Understand the criterion

Restate the AC as one testable sentence with a clear pass condition. If it is
ambiguous, say what you assumed in `steps`. If it cannot be tested at all,
return `BLOCKED`.

## 2. Plan before acting

List the minimal steps: where to go, what to do, what to observe. Prefer the
shortest path that proves or disproves the AC. Include one negative check when
the AC implies it (for example invalid input is rejected).

## 3. Execute

- **Evidence folder**: your task tells you where evidence goes. If it does not, use
  `.aadharam/evidence/` under the project root. Screenshots saved with an explicit
  filename are written relative to your working directory, NOT to the browser tool's
  output folder, so pass the full relative path (for example
  `.aadharam/evidence/AC-1-3-dashboard.png`) unless your working directory already
  is the evidence folder. Only evidence inside that folder counts.
- **Browser** (`browser` MCP tools): navigate, snapshot, click, type. Prefer
  accessibility snapshots over guessing coordinates. Take a screenshot at
  every assertion point and name it `<AC id>-<step number>-<what>.png`.
- **API checks**: use `curl -sS -i` against staging. Save the response into the
  evidence folder as `<AC id>-<step>-response.txt`. Never print secrets.
- **Shell checks**: only read-only commands unless the AC requires otherwise.
  Allowed hosts are enforced by a hook, so a blocked command is a signal to
  stop, not to work around it.

## 4. Decide

| Verdict   | Meaning |
|-----------|---------|
| `PASS`    | Behaviour matches the AC and you hold evidence. |
| `FAIL`    | Behaviour differs from the AC. Describe the difference. |
| `BLOCKED` | You could not test it (env down, login broken, AC unclear). |

Never upgrade a doubtful result to `PASS`.

## 5. Report

Return exactly one JSON block:

```json
{
  "criterion": "AC-1: <restated criterion>",
  "verdict": "PASS | FAIL | BLOCKED",
  "steps": ["1. Opened /login", "2. Entered valid credentials", "3. Landed on /dashboard"],
  "expected": "User lands on the dashboard",
  "observed": "User landed on the dashboard, greeting shows their name",
  "evidence": [".aadharam/evidence/AC-1-3-dashboard.png"],
  "extra_findings": []
}
```

Evidence paths must be real files you saved. Do not list files that do not exist.

## 6. Jira reporting (orchestrator only)

Workers return JSON and do not write to Jira. The orchestrator uploads evidence
and posts one summary comment using the `aadharam:jira-evidence` skill.
