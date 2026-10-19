import path from "node:path";
import type { CriterionOutcome, Verdict, WorkerResult } from "./types.js";
import { extractJson, isInside, isNonEmptyFile } from "./util.js";

const VERDICTS: Verdict[] = ["PASS", "FAIL", "BLOCKED"];

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Validate and normalise whatever JSON a worker produced. Returns undefined if unusable. */
export function coerceWorkerResult(raw: unknown, fallbackCriterion: string): WorkerResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const verdict = typeof r.verdict === "string" ? (r.verdict.toUpperCase() as Verdict) : undefined;
  if (!verdict || !VERDICTS.includes(verdict)) return undefined;
  return {
    criterion: typeof r.criterion === "string" ? r.criterion : fallbackCriterion,
    verdict,
    steps: strList(r.steps),
    expected: typeof r.expected === "string" ? r.expected : "",
    observed: typeof r.observed === "string" ? r.observed : "",
    evidence: strList(r.evidence),
    extra_findings: strList(r.extra_findings),
  };
}

export function parseWorkerText(text: string, fallbackCriterion: string): WorkerResult | undefined {
  return coerceWorkerResult(extractJson(text), fallbackCriterion);
}

/**
 * Resolve each claimed evidence path to a real, non-empty file inside THIS
 * worker's own evidence folder. Returns paths relative to `runDir`. Anything
 * else is dropped, including files in another worker's folder, so one tester can
 * never be credited with another tester's evidence.
 */
export function resolveEvidence(claimed: string[], runDir: string, evidenceDir: string): string[] {
  const found: string[] = [];
  for (const p of claimed) {
    const candidates = [
      path.resolve(evidenceDir, p),
      path.resolve(runDir, p),
      path.resolve(evidenceDir, path.basename(p)),
    ];
    for (const c of candidates) {
      if (isInside(evidenceDir, c) && isNonEmptyFile(c)) {
        found.push(path.relative(runDir, c));
        break;
      }
    }
  }
  return [...new Set(found)];
}

/**
 * Evidence gate: a PASS without at least one verifiable evidence file is not a
 * PASS. This is enforced here, in code, regardless of what the model claims.
 */
export function gateOutcome(
  base: Omit<CriterionOutcome, "result" | "note">,
  result: WorkerResult,
  runDir: string,
  evidenceDir: string,
): CriterionOutcome {
  const verified = resolveEvidence(result.evidence, runDir, evidenceDir);
  const dropped = result.evidence.length - verified.length;
  const next: WorkerResult = { ...result, evidence: verified };
  const notes: string[] = [];

  if (dropped > 0) notes.push(`${dropped} claimed evidence file(s) did not exist and were dropped`);

  if (next.verdict === "PASS" && verified.length === 0) {
    next.verdict = "FAIL";
    notes.push("PASS downgraded to FAIL: no verifiable evidence file");
  }

  return { ...base, result: next, note: notes.length ? notes.join("; ") : undefined };
}
