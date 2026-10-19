#!/usr/bin/env bash
# Post a plain-text comment to a Jira Cloud issue (REST API v3, ADF body).
# Usage: jira-comment.sh ISSUE-KEY "text"
#        jira-comment.sh ISSUE-KEY --file path/to/text
# Env:   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 ISSUE-KEY \"text\" | --file path" >&2
  exit 2
fi

: "${JIRA_BASE_URL:?JIRA_BASE_URL is not set}"
: "${JIRA_EMAIL:?JIRA_EMAIL is not set}"
: "${JIRA_API_TOKEN:?JIRA_API_TOKEN is not set}"

issue="$1"
shift

if ! [[ "$issue" =~ ^[A-Z][A-Z0-9_]+-[0-9]+$ ]]; then
  echo "invalid issue key: $issue" >&2
  exit 2
fi

if [ "$1" = "--file" ]; then
  [ -f "${2:-}" ] || { echo "file not found: ${2:-}" >&2; exit 2; }
  text="$(cat "$2")"
else
  text="$1"
fi

# Build an ADF document: one paragraph per line, so line breaks survive.
body=$(TEXT="$text" python3 - <<'PY'
import json, os
lines = os.environ["TEXT"].split("\n")
content = []
for line in lines:
    if line.strip() == "":
        content.append({"type": "paragraph", "content": []})
    else:
        content.append({"type": "paragraph", "content": [{"type": "text", "text": line}]})
print(json.dumps({"body": {"type": "doc", "version": 1, "content": content}}))
PY
)

base="${JIRA_BASE_URL%/}"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -X POST --data "$body" \
  "${base}/rest/api/3/issue/${issue}/comment") || code="000"

if [ "$code" = "201" ]; then
  echo "OK $code comment posted to $issue"
else
  echo "FAILED $code posting comment to $issue" >&2
  exit 1
fi
