import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { createRequestListener } from "./request-listener.js";
import type { BridgeConfig } from "./config.js";

// Mock expensive dependencies that would otherwise spawn CLI processes
vi.mock("./handlers/models.js", () => ({
  handleModels: vi.fn((res: http.ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [] }));
  }),
}));

vi.mock("./handlers/health.js", () => ({
  handleHealth: vi.fn((res: http.ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }),
}));

vi.mock("./handlers/chat-completions.js", () => ({
  handleChatCompletions: vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock" }));
  }),
}));

vi.mock("./handlers/anthropic-messages.js", () => ({
  handleAnthropicMessages: vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock" }));
  }),
}));

vi.mock("./request-log.js", () => ({
  logIncoming: vi.fn(),
  appendSessionLine: vi.fn(),
}));

function makeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    agentBin: "agent",
    acpCommand: "agent acp",
    acpArgs: ["acp"],
    acpEnv: {},
    host: "127.0.0.1",
    port: 8765,
    defaultModel: "default",
    mode: "agent",
    force: false,
    approveMcps: false,
    strictModel: true,
    workspace: "/tmp",
    timeoutMs: 300_000,
    sessionsLogPath: "/tmp/sessions.log",
    chatOnlyWorkspace: true,
    verbose: false,
    maxMode: false,
    promptViaStdin: false,
    useAcp: false,
    acpSkipAuthenticate: false,
    acpRawDebug: false,
    configDirs: [],
    multiPort: false,
    winCmdlineMax: 30_000,
    rateLimitMaxRequests: 0,
    rateLimitWindowMs: 60_000,
    ...overrides,
  };
}

function makeReq(pathname: string, method = "GET", remoteAddress = "127.0.0.1"): http.IncomingMessage {
  return {
    method,
    url: pathname,
    headers: { host: "localhost" },
    socket: { remoteAddress } as any,
  } as unknown as http.IncomingMessage;
}

function makeRes(): http.ServerResponse & { _statusCode?: number; _body: string; _headers: Record<string, string>; _on: Record<string, Function[]> } {
  const res = {} as any;
  res._body = "";
  res._headers = {};
  res._on = {};
  res.writeHead = vi.fn((status: number, headers: Record<string, string>) => {
    res._statusCode = status;
    Object.assign(res._headers, headers);
  });
  res.end = vi.fn((body: string) => { res._body = body; });
  res.headersSent = false;
  res.on = vi.fn((event: string, fn: Function) => {
    (res._on[event] ??= []).push(fn);
  });
  return res;
}

describe("request-listener rate limiting", () => {
  let listener: ReturnType<typeof createRequestListener>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("/v1/models is rate-limited", () => {
    it("allows requests when under limit", async () => {
      listener = createRequestListener({
        version: "test",
        config: makeConfig({ rateLimitMaxRequests: 3, rateLimitWindowMs: 60_000 }),
      });

      const res = makeRes();
      await listener(makeReq("/v1/models", "GET"), res);
      expect(res._statusCode).toBe(200);
    });

    it("returns 429 when rate limit exceeded", async () => {
      listener = createRequestListener({
        version: "test",
        config: makeConfig({ rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 }),
      });

      // First request: allowed
      const res1 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res1);
      expect(res1._statusCode).toBe(200);

      // Second request: rate limited
      const res2 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res2);
      expect(res2._statusCode).toBe(429);
      expect(res2._body).toContain("Rate limit");
    });

    it("includes Retry-After header when rate limited", async () => {
      listener = createRequestListener({
        version: "test",
        config: makeConfig({ rateLimitMaxRequests: 1, rateLimitWindowMs: 5000 }),
      });

      const res1 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res1);

      const res2 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res2);
      expect(res2._statusCode).toBe(429);
      expect(res2._headers["Retry-After"]).toBeDefined();
      const retryAfter = parseInt(res2._headers["Retry-After"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(5);
    });
  });

  describe("/health is not rate-limited", () => {
    it("always allows health checks", async () => {
      listener = createRequestListener({
        version: "test",
        config: makeConfig({ rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 }),
      });

      // Exhaust the rate limit
      const res1 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res1);
      const res2 = makeRes();
      await listener(makeReq("/v1/models", "GET"), res2);
      expect(res2._statusCode).toBe(429);

      // Health should still work
      const resHealth = makeRes();
      await listener(makeReq("/health", "GET"), resHealth);
      expect(resHealth._statusCode).toBe(200);
    });
  });

  describe("rate limiting tracks IPs independently", () => {
    it("different IPs have separate limits", async () => {
      listener = createRequestListener({
        version: "test",
        config: makeConfig({ rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 }),
      });

      // IP1 uses its allowance
      const res1 = makeRes();
      await listener(makeReq("/v1/models", "GET", "10.0.0.1"), res1);
      expect(res1._statusCode).toBe(200);

      // IP2 should still be allowed
      const res2 = makeRes();
      await listener(makeReq("/v1/models", "GET", "10.0.0.2"), res2);
      expect(res2._statusCode).toBe(200);

      // IP1 should be blocked
      const res3 = makeRes();
      await listener(makeReq("/v1/models", "GET", "10.0.0.1"), res3);
      expect(res3._statusCode).toBe(429);
    });
  });
});
