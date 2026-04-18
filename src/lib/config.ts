import { loadEnvConfig, resolveAgentCommand, type EnvOptions } from "./env.js";

/** "agent" is a sentinel meaning "default agentic mode" — do not pass --mode to cursor-agent. */
export type CursorExecutionMode = "agent" | "ask" | "plan";

export type BridgeConfig = {
  agentBin: string;
  /** Resolved command for ACP (node + script on Windows when .cmd); avoids spawn EINVAL and DEP0190. */
  acpCommand: string;
  /** Args for ACP (e.g. [scriptPath, "acp"] or ["acp"]). */
  acpArgs: string[];
  /** Env to use when spawning ACP (e.g. CURSOR_INVOKED_AS). */
  acpEnv: Record<string, string | undefined>;
  host: string;
  port: number;
  requiredKey?: string;
  defaultModel: string;
  mode: CursorExecutionMode;
  force: boolean;
  approveMcps: boolean;
  strictModel: boolean;
  workspace: string;
  timeoutMs: number;
  /** Path to TLS certificate file (e.g. Tailscale cert). When set with tlsKeyPath, server uses HTTPS. */
  tlsCertPath?: string;
  /** Path to TLS private key file. When set with tlsCertPath, server uses HTTPS. */
  tlsKeyPath?: string;
  /** Path to sessions log file; each request is appended as a line. Default: sessions.log in cwd. */
  sessionsLogPath: string;
  /** When true (default), run CLI in an empty temp dir so it cannot read or write the real project. Pure chat only. */
  chatOnlyWorkspace: boolean;
  /** When true, print full request/response content to stdout for each completion. */
  verbose: boolean;
  /** When true, enable Cursor Max Mode (larger context, more tool calls) via cli-config.json preflight. */
  maxMode: boolean;
  /** When true, pass the user prompt via stdin instead of argv (avoids Windows argv issues). */
  promptViaStdin: boolean;
  /** When true, use ACP (Agent Client Protocol) over stdio; fixes prompt delivery on Windows. */
  useAcp: boolean;
  /** Spawn options for ACP (e.g. windowsVerbatimArguments when using cmd.exe fallback). */
  acpSpawnOptions?: { windowsVerbatimArguments?: boolean };
  /** When true, skip ACP authenticate step (use when pre-authenticated via --api-key or agent login). */
  acpSkipAuthenticate: boolean;
  /** When true, log every raw JSON-RPC line from ACP stdout (very verbose). Set CURSOR_BRIDGE_ACP_RAW_DEBUG=1 to enable. */
  acpRawDebug: boolean;
  /** Pool of cursor configuration directories for round-robin account rotation. */
  configDirs: string[];
  /** When true, runs each config dir on its own incrementing port starting from `port` */
  multiPort: boolean;
  /** Windows CreateProcess command-line budget for prompt truncation (ignored on non-Windows). */
  winCmdlineMax: number;
  /** Max inbound requests per IP within the window. 0 = disabled. */
  rateLimitMaxRequests: number;
  /** Sliding window duration in milliseconds for rate limiting. */
  rateLimitWindowMs: number;
};

export function loadBridgeConfig(opts: EnvOptions = {}): BridgeConfig {
  const env = loadEnvConfig(opts);
  const acpResolved = resolveAgentCommand(env.agentBin, ["acp"], opts);
  const envSource = opts.env ?? process.env;
  // Bridge key gates HTTP only unless mirrored here — without a token the Cursor CLI falls back
  // to login/keychain (bad for headless/macOS). Prefer explicit CURSOR_* for agent when they differ.
  const apiKey =
    envSource.CURSOR_API_KEY ??
    envSource.CURSOR_AUTH_TOKEN ??
    envSource.CURSOR_BRIDGE_API_KEY;
  const acpArgs = acpResolved.args;

  const acpEnv = { ...acpResolved.env } as Record<string, string | undefined>;
  acpEnv.CURSOR_SKIP_KEYCHAIN = "1";
  acpEnv.CI = "true";
  if (apiKey) {
    acpEnv.CURSOR_API_KEY = apiKey;
    acpEnv.CURSOR_AUTH_TOKEN = apiKey;
  }

  return {
    agentBin: env.agentBin,
    acpCommand: acpResolved.command,
    acpArgs,
    acpEnv,
    host: env.host,
    port: env.port,
    requiredKey: env.requiredKey,
    defaultModel: env.defaultModel,
    mode: env.mode as CursorExecutionMode, // "agent" (default, full tools), "plan", or "ask" via CURSOR_BRIDGE_MODE
    force: env.force,
    approveMcps: env.approveMcps,
    strictModel: env.strictModel,
    workspace: env.workspace,
    timeoutMs: env.timeoutMs,
    tlsCertPath: env.tlsCertPath,
    tlsKeyPath: env.tlsKeyPath,
    sessionsLogPath: env.sessionsLogPath,
    chatOnlyWorkspace: env.chatOnlyWorkspace,
    verbose: env.verbose,
    maxMode: env.maxMode,
    promptViaStdin: env.promptViaStdin,
    useAcp: env.useAcp,
    acpSpawnOptions:
      acpResolved.windowsVerbatimArguments != null
        ? { windowsVerbatimArguments: acpResolved.windowsVerbatimArguments }
        : undefined,
    acpSkipAuthenticate:
      !!apiKey ||
      /^(1|true|yes|on)$/i.test(
        String(envSource.CURSOR_BRIDGE_ACP_SKIP_AUTHENTICATE ?? "").trim(),
      ),
    acpRawDebug: /^(1|true|yes|on)$/i.test(
      String(envSource.CURSOR_BRIDGE_ACP_RAW_DEBUG ?? "").trim(),
    ),
    configDirs: env.configDirs ?? [],
    multiPort: env.multiPort,
    winCmdlineMax: env.winCmdlineMax,
    rateLimitMaxRequests: env.rateLimitMaxRequests,
    rateLimitWindowMs: env.rateLimitWindowMs,
  };
}
