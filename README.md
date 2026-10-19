# Aadharam

Manual-QA agents that read a Jira ticket's acceptance criteria and **prove** whether each one is met.
Each tester drives a real browser, makes `curl` calls, runs shell checks, saves proof
screenshots, and reports a verdict back to Jira. No screenshot, no pass.

*Aadharam (ஆதாரம்) is Tamil for "proof" or "evidence".*

Two ways to run it, one shared brain:

| | Claude Code plugin | Standalone runner |
|---|---|---|
| Where | inside Claude Code | any terminal or CI job |
| Parallelism | sequential (one shared browser) | 1-5 testers, one isolated browser each |
| Models | whatever Claude Code is configured for | OpenRouter (any model) or Anthropic |
| Jira | optional connector, or the bundled REST scripts | REST API with an API token |

The runner is built on the Claude Agent SDK and loads the plugin, so the tester prompt, the QA
playbook, the safety hook and the Jira scripts live in one place: [`plugin/`](plugin).

```
plugin/                      Claude Code plugin (source of truth)
  agents/qa-tester.md          tester persona and hard rules
  skills/qa-playbook/          how to verify one criterion, verdict schema
  skills/qa-ticket/            interactive "QA this ticket" workflow
  skills/jira-evidence/        REST scripts: attach files, post comment
  hooks/guard-bash.sh          blocks off-allowlist curl/wget and destructive commands
  .mcp.json                    Playwright browser (headless, isolated)
agent/                       Standalone runner (TypeScript, Claude Agent SDK)
```

## How a run works

1. Fetch the ticket and extract acceptance criteria (or take them from `--criterion`).
2. Start one tester per criterion, up to the concurrency limit, each with its own headless browser.
3. Each tester returns one JSON verdict: `PASS`, `FAIL` or `BLOCKED`, with steps and evidence paths.
4. **The runner checks the evidence in code.** A `PASS` is downgraded to `FAIL` unless it cites at
   least one real, non-empty file inside the run folder. The model cannot talk its way past this.
5. Write `report.json` and `summary.md`. With `--post`, attach the evidence to the ticket and add
   one summary comment. Without it, nothing is written to Jira.

The runner never transitions a ticket.

## Quick start: standalone runner

Requires Node 20.12+.

```bash
git clone https://github.com/your-org/aadharam && cd aadharam
cp .env.example .env            # fill in OPENROUTER_API_KEY, Jira and test-account values
cd agent && npm install && npm run build

# one-time: download a browser for Playwright
npx playwright install chromium

# dry run: tests, saves a report, writes nothing to Jira
node dist/cli.js run PROJ-123 --base-url https://staging.example.com

# same, but upload proof and comment on the ticket
node dist/cli.js run PROJ-123 --base-url https://staging.example.com --post

# skip ticket parsing and supply criteria yourself
node dist/cli.js run PROJ-123 --base-url https://staging.example.com \
  --criterion "A user can log in with valid credentials" \
  --criterion "An invalid password shows an error and does not log in"
```

Results land in `runs/<ISSUE>-<timestamp>/`: `report.json`, `summary.md`, `evidence/<AC>/`, `logs/`.
Exit code: `0` all pass, `1` any fail, `2` any blocked.

Running in Docker or CI as root? Chromium will not start without `AADHARAM_BROWSER_NO_SANDBOX=1`.
Only use that inside a container or VM you treat as disposable.

## Quick start: Claude Code plugin

```bash
claude --plugin-dir ./plugin
```

Then `/aadharam:qa-ticket PROJ-123 https://staging.example.com`. Set `AADHARAM_ALLOWED_HOSTS`
to the staging hostname so the guard hook lets `curl` reach it. Testers run one at a time because
they share one browser. For parallel testers use the runner.

## Models and OpenRouter

The runner points the Agent SDK at OpenRouter by setting `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`
and mapping Claude Code's model tiers to your chosen OpenRouter models:

| Variable | Used for |
|---|---|
| `AADHARAM_WORKER_MODEL` | the testers |
| `AADHARAM_PLANNER_MODEL` | extracting criteria from the ticket |
| `AADHARAM_SMALL_MODEL` | Claude Code's internal small-model calls |

Set `ANTHROPIC_API_KEY` instead of `OPENROUTER_API_KEY` to talk to Anthropic directly. Set
`AADHARAM_API_BASE_URL` to use another Anthropic-compatible gateway.

**Choose capable models.** Testers need reliable tool calling and, for screenshots, vision. Weak or
free models tend to misread pages or skip steps. The evidence gate stops a bogus `PASS` from
being reported as one, but it cannot make a weak model test well. Keep the model per role configurable
and try your candidates on a few tickets you already know the answers to before trusting one.

## Safety model

Read [SECURITY.md](SECURITY.md) before pointing this at anything real. In short: staging only, throwaway
test accounts, Jira credentials are never given to the testers, `curl`/`wget` are limited to an allowlist,
and the guard hook is a safety net, not a sandbox. Run the agents in a container or VM for real isolation.

## Companion skills

[alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) (MIT) is a large library
that includes a `playwright-pro` skill for generating and fixing Playwright tests and Jira/Atlassian skills.
They complement Aadharam, for example turning a flaky manual check into a regression test, but are not
bundled or required. Install them separately with `/plugin marketplace add alirezarezvani/claude-skills`.

## What has and has not been tested

Verified in development: typecheck, 16 unit tests (evidence gate, cross-tester evidence isolation,
verdict parsing, concurrency pool, ADF flattening), the guard hook against 15 allow/block cases, and the
Jira scripts against a mock server.

Also verified end to end by running the real CLI against a **scripted model server** with a **real headless
Chromium** and a local web page: the plugin loads under the SDK, the guard hook blocks an off-allowlist
`curl` while allowing staging, the `mcp__browser__*` permission rule works, two testers run in parallel with
isolated browsers and each saves a real PNG into its own evidence folder, and a `PASS` backed by real
evidence is kept. This run caught and fixed a bug where named screenshots were saved to a shared directory.

**Not yet verified:** real OpenRouter models driving the browser (the scripted server stands in for the model,
so tester prompt quality and vision accuracy are untested), a live Jira Cloud site, and the interactive plugin
mode inside Claude Code. Expect to tune the tester prompt against your own app. Issues and PRs welcome.

## Known limitations

- Plugin mode is sequential by design (shared browser). Parallelism needs the runner.
- `AADHARAM_MAX_BUDGET_USD` is a client-side estimate. Pricing for non-Anthropic models may be off,
  so set a spend limit on your OpenRouter key as well.
- The runner uses Jira Cloud REST v3 with an API token. Jira Server/Data Center is untested.
- Criteria extraction is LLM-based. Pass `--criterion` when you need exact control.

## License

MIT. See [LICENSE](LICENSE).
