export type Verdict = "PASS" | "FAIL" | "BLOCKED";

export interface Criterion {
  id: string;
  text: string;
}

/** What a QA worker must return (see plugin/skills/qa-playbook/SKILL.md). */
export interface WorkerResult {
  criterion: string;
  verdict: Verdict;
  steps: string[];
  expected: string;
  observed: string;
  evidence: string[];
  extra_findings: string[];
}

export interface CriterionOutcome {
  id: string;
  text: string;
  result: WorkerResult;
  costUsd: number;
  /** Set when the orchestrator changed the worker's verdict. */
  note?: string;
}

export interface IssueInfo {
  key: string;
  summary: string;
  description: string;
  status: string;
}

export interface RunReport {
  issueKey: string;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  runDir: string;
  outcomes: CriterionOutcome[];
  totalCostUsd: number;
  posted: boolean;
}
