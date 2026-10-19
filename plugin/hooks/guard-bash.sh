#!/usr/bin/env bash
# PreToolUse guard for Bash. Reads the hook event JSON on stdin.
# Exit 0 = allow. Exit 2 = block (stderr is shown to the model).
#
# Config (environment):
#   AADHARAM_ALLOWED_HOSTS  comma-separated hostnames curl/wget may reach
#                             (e.g. "staging.example.com,localhost,127.0.0.1").
#                             Jira scripts talk to JIRA_BASE_URL, which is
#                             allowed automatically.
#   AADHARAM_GUARD=off      disable the guard (not recommended)
#
# This is a safety net against a confused agent, not a security sandbox.
# Run the agents in a container or VM for real isolation.
set -uo pipefail

[ "${AADHARAM_GUARD:-on}" = "off" ] && exit 0

input="$(cat)"

cmd="$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("command", ""))
except Exception:
    print("")
')"

[ -z "$cmd" ] && exit 0

block() {
  echo "Aadharam guard blocked this command: $1" >&2
  exit 2
}

# 1. Destructive or privilege-escalating commands.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])(sudo|su)[[:space:]]'; then
  block "privilege escalation (sudo/su)"
fi
if printf '%s' "$cmd" | grep -Eq 'rm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[fF]?|-[a-zA-Z]*[fF][a-zA-Z]*[rR])[[:space:]]+(/|~|\$HOME|\*)([[:space:]]|$)'; then
  block "recursive delete of a broad path"
fi
if printf '%s' "$cmd" | grep -Eq '(mkfs|dd[[:space:]]+if=|:\(\)\{|shutdown|reboot|chmod[[:space:]]+-R[[:space:]]+777)'; then
  block "destructive system command"
fi
if printf '%s' "$cmd" | grep -Eq '(curl|wget)[^|;&]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z)?sh'; then
  block "piping a download into a shell"
fi

# 2. Network allowlist for curl / wget.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])(curl|wget)[[:space:]]'; then
  allowed="${AADHARAM_ALLOWED_HOSTS:-localhost,127.0.0.1}"
  if [ -n "${JIRA_BASE_URL:-}" ]; then
    jira_host="$(printf '%s' "$JIRA_BASE_URL" | sed -E 's#^[a-z]+://##; s#[/:].*$##')"
    allowed="${allowed},${jira_host}"
  fi

  # Extract hosts from every URL in the command.
  hosts="$(printf '%s' "$cmd" | grep -Eo 'https?://[^/"'"'"'[:space:]?#]+' | sed -E 's#^https?://##; s#^[^@]*@##; s#:[0-9]+$##' | sort -u)"

  for h in $hosts; do
    ok=0
    IFS=',' read -ra list <<<"$allowed"
    for a in "${list[@]}"; do
      a="$(printf '%s' "$a" | tr -d '[:space:]')"
      [ -z "$a" ] && continue
      if [ "$h" = "$a" ]; then ok=1; break; fi
    done
    [ "$ok" -eq 1 ] || block "host '$h' is not in AADHARAM_ALLOWED_HOSTS"
  done
fi

exit 0
