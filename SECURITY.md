# Security

Aadharam gives an AI model a browser, `curl` and a shell. Treat it accordingly.

## Rules of use

- **Staging only.** Never point it at production or at systems holding real customer data.
- **Throwaway test accounts.** Give testers a dedicated low-privilege account, not a personal or admin one.
- **Isolate the runtime.** Run the runner in a container or VM, with no access to credentials or
  files you care about. The guard hook is not a sandbox.
- **Cap spend** on your model key (OpenRouter lets you set a limit). The built-in budget is only an estimate.

## What the project does for you

| Risk | Mitigation | Limits |
|---|---|---|
| Tester reaches an unintended host | `guard-bash.sh` blocks `curl`/`wget` to hosts outside `AADHARAM_ALLOWED_HOSTS`. In runner mode the `--base-url` host is added automatically and the Jira host is deliberately not (testers have no business reaching Jira). In plugin mode the Jira host is allowed too, so the evidence scripts work. | Only covers `curl`/`wget`. A tester can still use other tools (`python`, `node`, `nc`) from the shell. The browser is unrestricted unless you set `AADHARAM_BROWSER_ALLOWED_ORIGINS`. |
| Destructive shell commands | Hook blocks `sudo`, `rm -rf` of broad paths, `mkfs`, `dd if=`, piping downloads into a shell. | Pattern based, so it is bypassable by a determined or creative agent. |
| Jira credentials leak to the model | The runner builds the subprocess environment from an allowlist, so `JIRA_*` variables are never given to testers. Only the orchestrator talks to Jira. | In plugin mode the Jira scripts run in the same session, so the credentials are in your shell environment. |
| Test-account password leak | Passed by environment variable and never placed in prompts. Testers are told not to print it. | A model can still be tricked into echoing it, and it can appear in `logs/`. Use a throwaway account. |
| False PASS | The runner downgrades a `PASS` unless it cites real, non-empty evidence files inside the run folder. | It proves a file exists, not that the screenshot shows the right thing. Review evidence for anything important. |
| Unreviewed writes to Jira | `--post` is opt-in. The runner never transitions tickets. | |

## Prompt injection

Web pages, API responses and ticket text are untrusted input that the model reads. A malicious page can
try to steer a tester. The mitigations above (host allowlist, no Jira credentials, isolated runtime) limit
the blast radius but do not eliminate the risk. Do not test pages you do not control.

## Reporting a vulnerability

Please open a private security advisory on the repository rather than a public issue.
