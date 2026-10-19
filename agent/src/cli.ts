#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig, loadEnvFile } from "./config.js";
import { runQa } from "./orchestrator.js";
import { exitCodeFor } from "./report.js";

const HELP = `aadharam - parallel QA agents for Jira acceptance criteria

Usage:
  aadharam run <ISSUE-KEY> --base-url <staging url> [options]

Options:
  --base-url <url>        Staging URL to test (required). Only this host is allowed for curl.
  --criterion <text>      Acceptance criterion to test. Repeat for several.
                          Without it, criteria are extracted from the Jira ticket.
  --concurrency <n>       Parallel testers, 1-5 (default 3, or AADHARAM_CONCURRENCY)
  --out <dir>             Output folder for runs (default ./runs)
  --post                  Upload evidence and comment on the Jira ticket.
                          Without it nothing is written to Jira (dry run).
  -h, --help              Show this help

Environment: see .env.example. Exit code: 0 all pass, 1 any fail, 2 any blocked, 64 usage error.
`;

async function main(): Promise<number> {
  loadEnvFile();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "base-url": { type: "string" },
      criterion: { type: "string", multiple: true },
      concurrency: { type: "string" },
      out: { type: "string" },
      post: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, issueKey] = positionals;
  if (values.help || command !== "run" || !issueKey) {
    process.stdout.write(HELP);
    return values.help ? 0 : 64;
  }

  const baseUrl = values["base-url"];
  if (!baseUrl) {
    process.stderr.write("Missing --base-url\n\n" + HELP);
    return 64;
  }
  try {
    new URL(baseUrl);
  } catch {
    process.stderr.write(`Invalid --base-url: ${baseUrl}\n`);
    return 64;
  }

  if (values.concurrency) process.env.AADHARAM_CONCURRENCY = values.concurrency;
  if (values.out) process.env.AADHARAM_OUT_DIR = values.out;

  const cfg = loadConfig(baseUrl);
  const report = await runQa(cfg, {
    issueKey,
    baseUrl,
    criteria: values.criterion ?? [],
    post: values.post,
    log: (line) => process.stderr.write(line + "\n"),
  });

  process.stdout.write(
    JSON.stringify(
      {
        issue: report.issueKey,
        runDir: report.runDir,
        posted: report.posted,
        costUsdEstimate: Number(report.totalCostUsd.toFixed(4)),
        results: report.outcomes.map((o) => ({ id: o.id, verdict: o.result.verdict })),
      },
      null,
      2,
    ) + "\n",
  );
  return exitCodeFor(report.outcomes);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`aadharam: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(70);
  },
);
