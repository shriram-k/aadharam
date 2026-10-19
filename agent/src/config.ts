import { fileURLToPath } from "node:url";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
}

export interface Config {
  provider: "openrouter" | "anthropic";
  /** Anthropic-compatible gateway URL used in openrouter mode (default: OpenRouter). */
  apiBaseUrl: string;
  openrouterKey?: string;
  anthropicKey?: string;
  workerModel: string;
  plannerModel: string;
  smallModel: string;
  jira?: JiraConfig;
  testUsername?: string;
  testPassword?: string;
  allowedHosts: string[];
  browserAllowedOrigins?: string;
  /** Pass --no-sandbox to Chromium. Needed when running as root (Docker/CI). Off by default. */
  browserNoSandbox: boolean;
  concurrency: number;
  maxTurns: number;
  maxBudgetUsd: number;
  workerTimeoutMs: number;
  maxCriteria: number;
  pluginPath: string;
  outDir: string;
}

/** Load ./.env if present. The Agent SDK does not do this by itself. */
export function loadEnvFile(file = ".env"): void {
  try {
    process.loadEnvFile(file);
  } catch {
    /* no .env file, or unsupported Node: environment variables still work */
  }
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return n;
}

export function hostOf(url: string): string {
  return new URL(url).hostname;
}

export function loadConfig(baseUrl?: string): Config {
  const env = process.env;
  const openrouterKey = env.OPENROUTER_API_KEY || undefined;
  const anthropicKey = env.ANTHROPIC_API_KEY || undefined;

  if (!openrouterKey && !anthropicKey) {
    throw new Error(
      "No model credentials. Set OPENROUTER_API_KEY (recommended) or ANTHROPIC_API_KEY.",
    );
  }

  const workerModel = env.AADHARAM_WORKER_MODEL || "anthropic/claude-sonnet-4.5";
  const plannerModel = env.AADHARAM_PLANNER_MODEL || workerModel;
  const smallModel = env.AADHARAM_SMALL_MODEL || workerModel;

  let jira: JiraConfig | undefined;
  if (env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    jira = {
      baseUrl: env.JIRA_BASE_URL.replace(/\/+$/, ""),
      email: env.JIRA_EMAIL,
      token: env.JIRA_API_TOKEN,
    };
  }

  const allowedHosts = (env.AADHARAM_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (baseUrl) allowedHosts.push(hostOf(baseUrl));

  return {
    provider: openrouterKey ? "openrouter" : "anthropic",
    apiBaseUrl: env.AADHARAM_API_BASE_URL || "https://openrouter.ai/api",
    openrouterKey,
    anthropicKey,
    workerModel,
    plannerModel,
    smallModel,
    jira,
    testUsername: env.AADHARAM_TEST_USERNAME || undefined,
    testPassword: env.AADHARAM_TEST_PASSWORD || undefined,
    allowedHosts: [...new Set(allowedHosts)],
    browserAllowedOrigins: env.AADHARAM_BROWSER_ALLOWED_ORIGINS || undefined,
    browserNoSandbox: ["1", "true", "yes"].includes((env.AADHARAM_BROWSER_NO_SANDBOX ?? "").toLowerCase()),
    concurrency: Math.min(5, Math.floor(num("AADHARAM_CONCURRENCY", 3))),
    maxTurns: Math.floor(num("AADHARAM_MAX_TURNS", 40)),
    maxBudgetUsd: num("AADHARAM_MAX_BUDGET_USD", 1),
    workerTimeoutMs: num("AADHARAM_WORKER_TIMEOUT_SEC", 600) * 1000,
    maxCriteria: Math.floor(num("AADHARAM_MAX_CRITERIA", 10)),
    pluginPath:
      env.AADHARAM_PLUGIN_PATH || fileURLToPath(new URL("../../plugin", import.meta.url)),
    outDir: env.AADHARAM_OUT_DIR || "./runs",
  };
}

/**
 * Environment for the Claude Code subprocess.
 *
 * The SDK replaces the subprocess environment when `env` is set, so we build it
 * from a small allowlist. In particular Jira credentials are NOT passed on, so a
 * confused or prompt-injected worker cannot read them.
 */
export function buildSdkEnv(cfg: Config): Record<string, string | undefined> {
  const passthrough = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TERM",
    "TZ",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "PLAYWRIGHT_BROWSERS_PATH",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "CURL_CA_BUNDLE",
  ];
  const env: Record<string, string | undefined> = {};
  for (const k of passthrough) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }

  env.AADHARAM_ALLOWED_HOSTS = cfg.allowedHosts.join(",");
  if (cfg.testUsername) env.AADHARAM_TEST_USERNAME = cfg.testUsername;
  if (cfg.testPassword) env.AADHARAM_TEST_PASSWORD = cfg.testPassword;

  if (cfg.provider === "openrouter") {
    env.ANTHROPIC_BASE_URL = cfg.apiBaseUrl;
    env.ANTHROPIC_AUTH_TOKEN = cfg.openrouterKey;
    env.ANTHROPIC_API_KEY = ""; // must be explicitly empty for OpenRouter
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = cfg.workerModel;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = cfg.plannerModel;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = cfg.smallModel;
  } else {
    env.ANTHROPIC_API_KEY = cfg.anthropicKey;
  }
  return env;
}
