---
name: jira-evidence
description: Upload proof screenshots to a Jira issue and post a QA summary comment using bundled REST scripts. Use after QA testers have returned their verdicts and evidence files exist on disk.
---

# Jira evidence

These scripts use the Jira Cloud REST API with an API token, so they work in
interactive sessions and in headless runs alike.

## Environment

| Variable | Meaning |
|----------|---------|
| `JIRA_BASE_URL` | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | Atlassian account email |
| `JIRA_API_TOKEN` | API token from id.atlassian.com |

Never echo these values.

## Scripts

Run from the plugin root (`${CLAUDE_PLUGIN_ROOT}`):

```bash
# Attach one or more files to an issue
scripts/jira-attach.sh PROJ-123 .aadharam/evidence/AC-1-3-dashboard.png

# Post a comment (plain text or a file containing the text)
scripts/jira-comment.sh PROJ-123 "QA summary ..."
scripts/jira-comment.sh PROJ-123 --file .aadharam/summary.txt
```

Both scripts print the HTTP status and exit non-zero on failure. If an upload
fails, do not claim the evidence was attached. Say so in the summary.

## Summary comment format

```
QA by Aadharam (automated): 2 pass, 1 fail, 0 blocked

AC-1 PASS  Dashboard loads after login (AC-1-3-dashboard.png)
AC-2 PASS  Invalid password shows error (AC-2-2-error.png)
AC-3 FAIL  Expected 403 for non-admin, got 200 (AC-3-1-response.txt)

Evidence attached to this issue. Environment: <base url>
```

Keep it short, lead with counts, one line per criterion, name the evidence file.
Do not transition the ticket unless the operator explicitly allowed it.
