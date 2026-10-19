import { writeFileSync } from "node:fs";
import path from "node:path";
import type { CriterionOutcome, RunReport } from "./types.js";

export function counts(outcomes: CriterionOutcome[]) {
  return {
    pass: outcomes.filter((o) => o.result.verdict === "PASS").length,
    fail: outcomes.filter((o) => o.result.verdict === "FAIL").length,
    blocked: outcomes.filter((o) => o.result.verdict === "BLOCKED").length,
  };
}

/** Plain-text summary used for the Jira comment and summary.md. Keep it short. */
export function buildSummary(
  issueKey: string,
  baseUrl: string,
  outcomes: CriterionOutcome[],
): string {
  const c = counts(outcomes);
  const lines: string[] = [
    `QA by Aadharam (automated): ${c.pass} pass, ${c.fail} fail, ${c.blocked} blocked`,
    "",
  ];
  for (const o of outcomes) {
    const r = o.result;
    const file = r.evidence[0] ? ` (${path.basename(r.evidence[0])})` : "";
    const detail =
      r.verdict === "PASS" ? o.text : `${o.text}. Observed: ${r.observed || "n/a"}`;
    lines.push(`${o.id} ${r.verdict}  ${detail}${file}`);
    if (o.note) lines.push(`    note: ${o.note}`);
    for (const f of r.extra_findings) lines.push(`    extra finding: ${f}`);
  }
  lines.push("", `Ticket: ${issueKey}. Environment: ${baseUrl}`);
  return lines.join("\n");
}

export function writeReport(report: RunReport, summary: string): void {
  writeFileSync(path.join(report.runDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(report.runDir, "summary.md"), summary + "\n");
}

export function exitCodeFor(outcomes: CriterionOutcome[]): number {
  const c = counts(outcomes);
  if (c.fail > 0) return 1;
  if (c.blocked > 0) return 2;
  return 0;
}
