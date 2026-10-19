import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { coerceWorkerResult, gateOutcome, parseWorkerText } from "../src/evidence.js";
import { adfToText } from "../src/jira.js";
import { extractJson, isInside, pool, stripFrontmatter } from "../src/util.js";

const base = { id: "AC-1", text: "Dashboard loads", costUsd: 0 };

function fixture() {
  const runDir = mkdtempSync(path.join(tmpdir(), "bb-"));
  const evidenceDir = path.join(runDir, "evidence", "AC-1");
  mkdirSync(evidenceDir, { recursive: true });
  return { runDir, evidenceDir };
}

const pass = (evidence: string[]) =>
  coerceWorkerResult(
    { criterion: "AC-1", verdict: "PASS", steps: ["a"], expected: "x", observed: "y", evidence },
    "AC-1",
  )!;

test("PASS with a real evidence file stays PASS", () => {
  const { runDir, evidenceDir } = fixture();
  writeFileSync(path.join(evidenceDir, "shot.png"), "png-bytes");
  const out = gateOutcome(base, pass(["evidence/AC-1/shot.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "PASS");
  assert.deepEqual(out.result.evidence, [path.join("evidence", "AC-1", "shot.png")]);
});

test("PASS with no evidence is downgraded to FAIL", () => {
  const { runDir, evidenceDir } = fixture();
  const out = gateOutcome(base, pass([]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
  assert.match(out.note ?? "", /no verifiable evidence/);
});

test("PASS citing a file that does not exist is downgraded", () => {
  const { runDir, evidenceDir } = fixture();
  const out = gateOutcome(base, pass(["evidence/AC-1/ghost.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
  assert.match(out.note ?? "", /did not exist/);
});

test("PASS citing an empty file is downgraded", () => {
  const { runDir, evidenceDir } = fixture();
  writeFileSync(path.join(evidenceDir, "empty.png"), "");
  const out = gateOutcome(base, pass(["evidence/AC-1/empty.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
});

test("evidence outside the run directory is rejected", () => {
  const { runDir, evidenceDir } = fixture();
  const outside = path.join(tmpdir(), `bb-outside-${Date.now()}.txt`);
  writeFileSync(outside, "secret");
  const out = gateOutcome(base, pass([outside, "../../../etc/passwd"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
  assert.deepEqual(out.result.evidence, []);
});

test("a tester cannot be credited with another tester's evidence", () => {
  const { runDir, evidenceDir } = fixture();
  const otherDir = path.join(runDir, "evidence", "AC-2");
  mkdirSync(otherDir, { recursive: true });
  writeFileSync(path.join(otherDir, "theirs.png"), "x");
  const out = gateOutcome(base, pass(["evidence/AC-2/theirs.png", "../AC-2/theirs.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
  assert.deepEqual(out.result.evidence, []);
});

test("a file in the run root (outside the tester's folder) is not accepted", () => {
  const { runDir, evidenceDir } = fixture();
  writeFileSync(path.join(runDir, "stray.png"), "x");
  const out = gateOutcome(base, pass(["stray.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "FAIL");
});

test("evidence given as a bare file name resolves inside the evidence dir", () => {
  const { runDir, evidenceDir } = fixture();
  writeFileSync(path.join(evidenceDir, "page.png"), "x");
  const out = gateOutcome(base, pass(["page.png"]), runDir, evidenceDir);
  assert.equal(out.result.verdict, "PASS");
});

test("FAIL and BLOCKED are never upgraded", () => {
  const { runDir, evidenceDir } = fixture();
  writeFileSync(path.join(evidenceDir, "s.png"), "x");
  for (const verdict of ["FAIL", "BLOCKED"]) {
    const r = coerceWorkerResult(
      { verdict, evidence: ["evidence/AC-1/s.png"] },
      "AC-1",
    )!;
    assert.equal(gateOutcome(base, r, runDir, evidenceDir).result.verdict, verdict);
  }
});

test("invalid verdicts are rejected", () => {
  assert.equal(coerceWorkerResult({ verdict: "MAYBE" }, "x"), undefined);
  assert.equal(coerceWorkerResult("nope", "x"), undefined);
  assert.equal(coerceWorkerResult(null, "x"), undefined);
});

test("lowercase verdicts are normalised", () => {
  assert.equal(coerceWorkerResult({ verdict: "pass" }, "x")?.verdict, "PASS");
});

test("extractJson prefers the last fenced block and tolerates noise", () => {
  const text = 'thinking {"a":1}\n```json\n{"verdict":"FAIL"}\n```\nmore\n```json\n{"verdict":"PASS"}\n```';
  assert.deepEqual(extractJson(text), { verdict: "PASS" });
  assert.deepEqual(extractJson('prefix {"k": 2} suffix'), { k: 2 });
  assert.equal(extractJson("no json here"), undefined);
  assert.equal(parseWorkerText("garbage", "x"), undefined);
});

test("pool respects the concurrency limit and keeps order", async () => {
  let active = 0;
  let peak = 0;
  const results = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return n * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});

test("isInside handles traversal", () => {
  assert.equal(isInside("/a/b", "/a/b/c"), true);
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/bc"), false);
  assert.equal(isInside("/a/b", "/a/b/../x"), false);
});

test("stripFrontmatter removes the YAML header only", () => {
  assert.equal(stripFrontmatter("---\nname: x\n---\n\nBody text"), "Body text");
  assert.equal(stripFrontmatter("No header"), "No header");
});

test("adfToText flattens paragraphs and lists", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Acceptance criteria" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Login works" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Logout works" }] }] },
        ],
      },
    ],
  };
  const text = adfToText(doc).trim();
  assert.match(text, /Acceptance criteria/);
  assert.match(text, /- Login works/);
  assert.match(text, /- Logout works/);
});
