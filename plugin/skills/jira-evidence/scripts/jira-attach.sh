#!/usr/bin/env bash
# Attach one or more files to a Jira Cloud issue via the REST API.
# Usage: jira-attach.sh ISSUE-KEY file [file...]
# Env:   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 ISSUE-KEY file [file...]" >&2
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

base="${JIRA_BASE_URL%/}"
status=0

for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "MISSING $f" >&2
    status=1
    continue
  fi
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
    -H 'X-Atlassian-Token: no-check' \
    -F "file=@${f}" \
    "${base}/rest/api/3/issue/${issue}/attachments") || code="000"
  if [ "$code" = "200" ]; then
    echo "OK $code $f"
  else
    echo "FAILED $code $f" >&2
    status=1
  fi
done

exit "$status"
