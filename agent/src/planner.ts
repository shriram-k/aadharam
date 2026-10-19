import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.js";
import { buildSdkEnv } from "./config.js";
import type { Criterion, IssueInfo } from "./types.js";
import { extractJson } from "./util.js";

const SYSTEM = [
  "You extract testable acceptance criteria from a Jira ticket.",
  "Return ONLY a JSON object: {\"criteria\":[{\"id\":\"AC-1\",\"text\":\"...\"}]}.",
  "Each criterion must be one independently testable statement with a clear pass condition.",
  "Use the ticket's own acceptance criteria when present; otherwise derive them from the description.",
  "Split compound criteria. Do not invent requirements the ticket does not imply.",
  "Preserve the ticket's wording where you can. Output no prose outside the JSON.",
].join("\n");

export async function planCriteria(cfg: Config, issue: IssueInfo): Promise<Criterion[]> {
  const prompt = `Ticket ${issue.key}: ${issue.summary}\n\nDescription:\n${issue.description || "(empty)"}`;
  let text: string | undefined;

  for await (const msg of query({
    prompt,
    options: {
      env: buildSdkEnv(cfg),
      model: "opus",
      systemPrompt: SYSTEM,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: "dontAsk",
      maxTurns: 2,
      persistSession: false,
    },
  })) {
    if (msg.type === "result" && msg.subtype === "success" && !msg.is_error) text = msg.result;
  }

  const parsed = text ? extractJson(text) : undefined;
  const list = (parsed as { criteria?: unknown } | undefined)?.criteria;
  if (!Array.isArray(list)) {
    throw new Error(
      "Could not extract acceptance criteria from the ticket. Pass them explicitly with --criterion.",
    );
  }

  const criteria: Criterion[] = [];
  for (const item of list) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      const t = (item as { text: string }).text.trim();
      if (t) criteria.push({ id: `AC-${criteria.length + 1}`, text: t });
    }
  }
  if (criteria.length === 0) {
    throw new Error("The ticket produced no testable criteria. Pass them with --criterion.");
  }
  return criteria.slice(0, cfg.maxCriteria);
}
