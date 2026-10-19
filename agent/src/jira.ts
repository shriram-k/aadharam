import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JiraConfig } from "./config.js";
import type { IssueInfo } from "./types.js";

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Flatten an Atlassian Document Format tree to readable plain text. */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content ?? []).map((c) => adfToText(c));
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "codeBlock":
      return inner.join("") + "\n";
    case "listItem":
      return "- " + inner.join("").trim() + "\n";
    case "bulletList":
    case "orderedList":
    case "doc":
    default:
      return inner.join("");
  }
}

function toAdfBody(text: string) {
  const content = text.split("\n").map((line) =>
    line.trim() === ""
      ? { type: "paragraph", content: [] }
      : { type: "paragraph", content: [{ type: "text", text: line }] },
  );
  return { body: { type: "doc", version: 1, content } };
}

export interface AttachResult {
  file: string;
  ok: boolean;
  status: number;
}

export class JiraClient {
  private readonly auth: string;

  constructor(private readonly cfg: JiraConfig) {
    this.auth = "Basic " + Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  }

  private url(p: string): string {
    return `${this.cfg.baseUrl}/rest/api/3${p}`;
  }

  private assertKey(key: string): void {
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new Error(`Invalid Jira issue key: ${key}`);
  }

  async getIssue(key: string): Promise<IssueInfo> {
    this.assertKey(key);
    const res = await fetch(this.url(`/issue/${key}?fields=summary,description,status`), {
      headers: { Authorization: this.auth, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Jira getIssue ${key} failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      key: string;
      fields: {
        summary?: string;
        description?: AdfNode | null;
        status?: { name?: string };
      };
    };
    return {
      key: data.key,
      summary: data.fields.summary ?? "",
      description: adfToText(data.fields.description).trim(),
      status: data.fields.status?.name ?? "",
    };
  }

  async attach(key: string, files: string[]): Promise<AttachResult[]> {
    this.assertKey(key);
    const results: AttachResult[] = [];
    for (const file of files) {
      try {
        const bytes = await readFile(file);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(bytes)]), path.basename(file));
        const res = await fetch(this.url(`/issue/${key}/attachments`), {
          method: "POST",
          headers: { Authorization: this.auth, "X-Atlassian-Token": "no-check" },
          body: form,
        });
        results.push({ file, ok: res.ok, status: res.status });
      } catch {
        results.push({ file, ok: false, status: 0 });
      }
    }
    return results;
  }

  async comment(key: string, text: string): Promise<void> {
    this.assertKey(key);
    const res = await fetch(this.url(`/issue/${key}/comment`), {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(toAdfBody(text)),
    });
    if (!res.ok) throw new Error(`Jira comment on ${key} failed: HTTP ${res.status}`);
  }
}
