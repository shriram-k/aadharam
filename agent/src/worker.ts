import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.js";
import { buildSdkEnv } from "./config.js";
import { gateOutcome, parseWorkerText } from "./evidence.js";
import type { Criterion, CriterionOutcome, IssueInfo, WorkerResult } from "./types.js";
import { slug, stripFrontmatter } from "./util.js";

export interface RunContext {
  dir: string;
  baseUrl: string;
  issue: IssueInfo;
}

/** The worker's system prompt comes from the plugin, so both products share one definition. */
export function loadAgentPrompt(pluginPath: string, agent: string): string {
  const file = path.join(pluginPath, "agents", `${agent}.md`);
  return stripFrontmatter(readFileSync(file, "utf8"));
}

function blocked(criterion: Criterion, reason: string): WorkerResult {
  return {
    criterion: `${criterion.id}: ${criterion.text}`,
    verdict: "BLOCKED",
    steps: [],
    expected: criterion.text,
    observed: reason,
    evidence: [],
    extra_findings: [],
  };
}

function buildPrompt(cfg: Config, run: RunContext, c: Criterion, evidenceRel: string): string {
  const creds =
    cfg.testUsername && cfg.testPassword
      ? "Test credentials are in the environment variables AADHARAM_TEST_USERNAME and " +
        "AADHARAM_TEST_PASSWORD. Read them with `printenv` when you need them, type them " +
        "into the login form, and never print or echo them in your output."
      : "No test credentials were provided. If the criterion needs a login, return BLOCKED.";

  return [
    `Ticket: ${run.issue.key}${run.issue.summary ? ` - ${run.issue.summary}` : ""}`,
    `Acceptance criterion ${c.id}: ${c.text}`,
    "",
    `Environment under test (staging): ${run.baseUrl}`,
    creds,
    "",
    `Your working directory is this criterion's evidence folder (${evidenceRel}). Save every screenshot and response capture here using a bare file name such as \`${c.id}-1-dashboard.png\` (screenshot tool: pass it as the filename; curl: use -o). Do not create subfolders and do not write anywhere else.`,
    "Load the aadharam:qa-playbook skill first and follow it.",
    "Finish with exactly one fenced JSON block in the schema from the playbook.",
  ].join("\n");
}

export async function runWorker(
  cfg: Config,
  run: RunContext,
  criterion: Criterion,
  systemAppend: string,
): Promise<CriterionOutcome> {
  const idSlug = slug(criterion.id);
  const evidenceRel = path.join("evidence", idSlug);
  const evidenceDir = path.join(run.dir, evidenceRel);
  const logDir = path.join(run.dir, "logs");
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${idSlug}.log`);
  const log = (line: string) => appendFileSync(logFile, line + "\n");

  const base = { id: criterion.id, text: criterion.text, costUsd: 0 };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.workerTimeoutMs);

  const browserArgs = [
    "-y",
    "@playwright/mcp@latest",
    "--headless",
    "--isolated",
    "--output-dir",
    path.resolve(evidenceDir),
  ];
  if (cfg.browserAllowedOrigins) browserArgs.push("--allowed-origins", cfg.browserAllowedOrigins);
  if (cfg.browserNoSandbox) browserArgs.push("--no-sandbox");

  let finalText: string | undefined;
  let failure: string | undefined;
  let costUsd = 0;

  try {
    const stream = query({
      prompt: buildPrompt(cfg, run, criterion, evidenceRel),
      options: {
        // Playwright saves explicitly named screenshots relative to the cwd, not to
        // --output-dir. Making the cwd the per-criterion evidence folder keeps parallel
        // testers from sharing (and overwriting) files.
        cwd: path.resolve(evidenceDir),
        env: buildSdkEnv(cfg),
        model: "sonnet",
        systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend },
        plugins: [{ type: "local", path: cfg.pluginPath, skipMcpDiscovery: true }],
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: { browser: { command: "npx", args: browserArgs } },
        permissionMode: "dontAsk",
        allowedTools: ["Bash", "Read", "Write", "Glob", "Grep", "Skill", "mcp__browser__*"],
        disallowedTools: ["WebFetch", "WebSearch", "Agent"],
        maxTurns: cfg.maxTurns,
        maxBudgetUsd: cfg.maxBudgetUsd,
        persistSession: false,
        abortController: abort,
        stderr: (data: string) => log(`[stderr] ${data.trimEnd()}`),
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") log(`tool: ${block.name}`);
          else if (block.type === "text") log(`assistant: ${block.text.slice(0, 500)}`);
        }
      } else if (msg.type === "result") {
        costUsd = msg.total_cost_usd;
        if (msg.subtype === "success" && !msg.is_error) finalText = msg.result;
        else failure = `${msg.subtype}${"errors" in msg && msg.errors.length ? `: ${msg.errors.join("; ")}` : ""}`;
      }
    }
  } catch (err) {
    failure = abort.signal.aborted
      ? `timed out after ${Math.round(cfg.workerTimeoutMs / 1000)}s`
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    clearTimeout(timer);
  }

  if (finalText === undefined) {
    log(`worker failed: ${failure ?? "no result"}`);
    return { ...base, costUsd, result: blocked(criterion, `Worker did not finish (${failure ?? "no result"})`) };
  }

  const parsed = parseWorkerText(finalText, `${criterion.id}: ${criterion.text}`);
  if (!parsed) {
    log("worker returned no valid verdict JSON");
    return {
      ...base,
      costUsd,
      result: blocked(criterion, "Worker returned no valid verdict JSON"),
    };
  }

  return gateOutcome({ ...base, costUsd }, parsed, run.dir, evidenceDir);
}
