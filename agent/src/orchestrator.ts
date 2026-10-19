import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { JiraClient } from "./jira.js";
import { planCriteria } from "./planner.js";
import { buildSummary, counts, writeReport } from "./report.js";
import type { Criterion, IssueInfo, RunReport } from "./types.js";
import { pool, slug } from "./util.js";
import { loadAgentPrompt, runWorker } from "./worker.js";

export interface RunOptions {
  issueKey: string;
  baseUrl: string;
  criteria: string[]; // explicit criteria; empty means "extract from the ticket"
  post: boolean;
  log?: (line: string) => void;
}

export async function runQa(cfg: Config, opts: RunOptions): Promise<RunReport> {
  const log = opts.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const jira = cfg.jira ? new JiraClient(cfg.jira) : undefined;

  if (opts.post && !jira) {
    throw new Error("--post needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to be set.");
  }

  // 1. Ticket
  let issue: IssueInfo = { key: opts.issueKey, summary: "", description: "", status: "" };
  if (jira) {
    issue = await jira.getIssue(opts.issueKey);
    log(`Fetched ${issue.key}: ${issue.summary} [${issue.status}]`);
  } else if (opts.criteria.length === 0) {
    throw new Error("No Jira credentials, so pass the acceptance criteria with --criterion.");
  }

  // 2. Criteria
  let criteria: Criterion[];
  if (opts.criteria.length > 0) {
    criteria = opts.criteria
      .slice(0, cfg.maxCriteria)
      .map((text, i) => ({ id: `AC-${i + 1}`, text }));
  } else {
    log("Extracting acceptance criteria from the ticket...");
    criteria = await planCriteria(cfg, issue);
  }
  log(`Testing ${criteria.length} criteria with concurrency ${cfg.concurrency}`);

  // 3. Run directory
  const stamp = startedAt.replace(/[:.]/g, "-");
  const runDir = path.resolve(cfg.outDir, `${slug(issue.key)}-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  // 4. Workers
  const systemAppend = loadAgentPrompt(cfg.pluginPath, "qa-tester");
  const run = { dir: runDir, baseUrl: opts.baseUrl, issue };
  const outcomes = await pool(criteria, cfg.concurrency, async (c) => {
    log(`[${c.id}] started`);
    const outcome = await runWorker(cfg, run, c, systemAppend);
    log(`[${c.id}] ${outcome.result.verdict}${outcome.note ? ` (${outcome.note})` : ""}`);
    return outcome;
  });

  // 5. Report
  let summary = buildSummary(issue.key, opts.baseUrl, outcomes);
  const totalCostUsd = outcomes.reduce((n, o) => n + o.costUsd, 0);
  let posted = false;

  if (opts.post && jira) {
    const files = outcomes.flatMap((o) => o.result.evidence.map((e) => path.join(runDir, e)));
    const results = files.length ? await jira.attach(issue.key, files) : [];
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      summary += `\n\nWarning: ${failed.length} of ${results.length} evidence file(s) failed to upload. See the run folder for the originals.`;
    }
    await jira.comment(issue.key, summary);
    posted = true;
    log(`Posted summary and ${results.length - failed.length} attachment(s) to ${issue.key}`);
  }

  const report: RunReport = {
    issueKey: issue.key,
    baseUrl: opts.baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    runDir,
    outcomes,
    totalCostUsd,
    posted,
  };
  writeReport(report, summary);

  const c = counts(outcomes);
  log(`Done: ${c.pass} pass, ${c.fail} fail, ${c.blocked} blocked. Report: ${runDir}`);
  return report;
}
