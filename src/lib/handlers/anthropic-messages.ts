import { randomUUID } from "node:crypto";
import * as http from "node:http";

import type { AnthropicMessagesRequest } from "../anthropic.js";
import { buildPromptFromAnthropicMessages } from "../anthropic.js";
import { buildAgentFixedArgs } from "../agent-cmd-args.js";
import { runAgentStream, runAgentSync } from "../agent-runner.js";
import { createAnthropicSseWriter } from "../anthropic-sse-writer.js";
import type { BridgeConfig } from "../config.js";
import { json, writeSseHeaders } from "../http.js";
import { resolveToCursorModel } from "../model-map.js";
import { normalizeModelId, toolsToSystemText } from "../openai.js";
import {
  logAgentError,
  logAccountAssigned,
  logAccountStats,
  logTrafficRequest,
  logTrafficResponse,
  type TrafficMessage,
} from "../request-log.js";
import { resolveModel } from "../resolve-model.js";
import { resolveWorkspace } from "../workspace.js";
import { sanitizeMessages, sanitizeSystem } from "../sanitize.js";
import {
  extractAdvertisedSkillNames,
  materializeBundledSkills,
} from "../skill-materializer.js";
import {
  getNextAccountConfigDir,
  reportRequestStart,
  reportRequestEnd,
  reportRateLimit,
  reportRequestSuccess,
  reportRequestError,
  getAccountStats,
} from "../account-pool.js";
import {
  fitPromptToWinCmdline,
  warnPromptTruncated,
} from "../win-cmdline-limit.js";

function analyzeStderr(stderr: string): {
  isRateLimited: boolean;
  isMaxTurns: boolean;
  isError: boolean;
} {
  if (!stderr) return { isRateLimited: false, isMaxTurns: false, isError: false };

  const isRateLimited = /\b429\b|rate.?limit|too many requests/i.test(stderr);
  const isMaxTurns = /max.?turn|max_turn|turn.?limit|exceeded.*turn/i.test(stderr);
  const isError = /\berror\b|\bfail(?:ed|ure)?\b|\bexception\b|\babort(?:ed)?\b/i.test(stderr);

  return { isRateLimited, isMaxTurns, isError };
}

function estimateTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}

function logLatency(
  latencyMs: number,
  displayModel: string | undefined,
  suffix: string,
): void {
  const latencySec = (latencyMs / 1000).toFixed(1);
  if (latencyMs > 60_000) {
    console.warn(
      `[${new Date().toISOString()}] SLOW response: ${latencySec}s (model=${displayModel}${suffix})`,
    );
  }
}

export type AnthropicMessagesCtx = {
  config: BridgeConfig;
  lastRequestedModelRef: { current?: string };
};

export async function handleAnthropicMessages(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: AnthropicMessagesCtx,
  rawBody: string,
  method: string,
  pathname: string,
  remoteAddress: string,
): Promise<void> {
  const { config, lastRequestedModelRef } = ctx;
  const body = JSON.parse(rawBody || "{}") as AnthropicMessagesRequest;
  const requested = normalizeModelId(body.model);
  const model = resolveModel(requested, lastRequestedModelRef, config);
  const displayModel =
    requested === "default" && config.defaultModel !== "default"
      ? config.defaultModel
      : model;

  const cleanSystem = sanitizeSystem(body.system);
  const cleanMessages = sanitizeMessages(
    body.messages ?? [],
  ) as AnthropicMessagesRequest["messages"];

  const toolsText = toolsToSystemText((body as any).tools);
  const systemWithTools = toolsText
    ? [cleanSystem, toolsText].filter(Boolean).join("\n\n")
    : cleanSystem;
  const prompt = buildPromptFromAnthropicMessages(
    cleanMessages,
    systemWithTools as AnthropicMessagesRequest["system"],
  );

  if (body.max_tokens == null || typeof body.max_tokens !== "number") {
    json(res, 400, {
      error: {
        type: "invalid_request_error",
        message: "max_tokens is required",
      },
    });
    return;
  }

  const cursorModel = resolveToCursorModel(model) ?? model;

  const trafficMessages: TrafficMessage[] = [];
  if (cleanSystem) {
    const sys =
      typeof cleanSystem === "string"
        ? cleanSystem
        : (cleanSystem as Array<{ type?: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("\n");
    if (sys.trim())
      trafficMessages.push({ role: "system", content: sys.trim() });
  }
  for (const m of cleanMessages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ type?: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("");
    if (text) trafficMessages.push({ role: m.role, content: text });
  }
  logTrafficRequest(
    config.verbose,
    model ?? cursorModel,
    trafficMessages,
    !!body.stream,
  );

  const headerWs = req.headers["x-cursor-workspace"];
  let workspaceDir: string;
  let tempDir: string | undefined;
  try {
    const ws = resolveWorkspace(config, headerWs);
    workspaceDir = ws.workspaceDir;
    tempDir = ws.tempDir;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid workspace";
    json(res, 400, {
      error: { type: "invalid_request_error", message: msg },
    });
    return;
  }

  // Path D (PROXIED_FAST_MODEL_RESEARCH.md): cursor-agent can't invoke the
  // SDK-provided Skill tool, so materialise bundled Anthropic skills as
  // `.cursor/rules/<name>.mdc` in the workspace. cursor-agent auto-discovers
  // them and applies them verbatim for `/<name>` invocations.
  const advertised = extractAdvertisedSkillNames((body as any).tools);
  const materialized = materializeBundledSkills(workspaceDir, advertised);
  if (materialized.length > 0 && config.verbose) {
    console.log(
      `[${new Date().toISOString()}] Materialised ${materialized.length} skill(s) as .cursor/rules: ${materialized.join(", ")}`,
    );
  }

  const fixedArgs = buildAgentFixedArgs(
    config,
    workspaceDir,
    cursorModel,
    !!body.stream,
  );
  const fit = fitPromptToWinCmdline(config.agentBin, fixedArgs, prompt, {
    maxCmdline: config.winCmdlineMax,
    platform: process.platform,
    cwd: workspaceDir,
  });
  if (!fit.ok) {
    json(res, 500, {
      error: {
        type: "api_error",
        message: fit.error,
        code: "windows_cmdline_limit",
      },
    });
    return;
  }
  if (fit.truncated) {
    warnPromptTruncated(fit.originalLength, fit.finalPromptLength);
  }
  const cmdArgs = fit.args;

  const msgId = `msg_${randomUUID().replace(/-/g, "")}`;

  const truncatedHeaders = fit.truncated
    ? { "X-Cursor-Proxy-Prompt-Truncated": "true" }
    : undefined;

  const promptForAgent =
    config.promptViaStdin || config.useAcp ? prompt : undefined;

  if (body.stream) {
    writeSseHeaders(res, truncatedHeaders);
    res.on("error", () => {
      /* client disconnected mid-stream */
    });

    const writeEvent = (evt: object) => {
      if (!res.writable) return;
      try {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {
        /* socket closed, ignore */
      }
    };

    // Keep-alive heartbeats so HTTP intermediaries don't drop the connection
    // during long silent periods (thinking models, slow tool calls).
    const heartbeatInterval = setInterval(() => {
      if (res.writable) {
        try {
          res.write(": keep-alive\n\n");
        } catch {
          /* socket closed */
        }
      }
    }, 15_000);
    const clearHeartbeat = () => clearInterval(heartbeatInterval);

    writeEvent({
      type: "message_start",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model: displayModel ?? cursorModel,
        content: [],
      },
    });

    const sse = createAnthropicSseWriter(writeEvent);
    // Heartbeat so SDK consumers see a "thinking" signal instead of a silent
    // wait when cursor-agent takes minutes before the first real event.
    sse.openHeartbeatThinking();

    const configDir = getNextAccountConfigDir();
    logAccountAssigned(configDir);
    reportRequestStart(configDir);
    const streamStart = Date.now();

    const abortController = new AbortController();
    req.once("close", () => abortController.abort());

    let accumulatedText = "";
    let turnCount = 0;
    const idleTimeoutMs = 120_000; // 2 min idle → kill
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearHeartbeat();
        abortController.abort();
        sse.closeCurrent();
        writeEvent({
          type: "message_delta",
          delta: { stop_reason: "error", stop_sequence: null },
          usage: { output_tokens: 0 },
        });
        writeEvent({
          type: "error",
          error: { type: "api_error", message: "Streaming timed out after 2 minutes of inactivity" },
        });
        res.end();
      }, idleTimeoutMs);
    };

    resetIdleTimer();

    runAgentStream(
      config,
      workspaceDir,
      cmdArgs,
      {
        onEvent: (event) => {
          if (event.kind === "text") accumulatedText += event.text;
          if (event.kind === "tool_use") turnCount++;
          resetIdleTimer();
          sse.emit(event);
        },
      },
      tempDir,
      promptForAgent,
      configDir,
      abortController.signal,
    )
      .then(({ code, stderr: stderrOut }) => {
        const latencyMs = Date.now() - streamStart;
        reportRequestEnd(configDir);
        clearHeartbeat();
        if (idleTimer) clearTimeout(idleTimer);

        const analysis = analyzeStderr(stderrOut);
        if (analysis.isRateLimited) {
          reportRateLimit(configDir, 60000);
        }
        if (analysis.isMaxTurns) {
          console.warn(
            `[${new Date().toISOString()}] Cursor agent hit internal max_turns limit (stderr tail: ${stderrOut.slice(-300)})`,
          );
        }

        logLatency(latencyMs, displayModel, `, turns=${turnCount}`);
        if (config.verbose) {
          console.log(
            `[${new Date().toISOString()}] Response in ${(latencyMs / 1000).toFixed(1)}s (model=${displayModel}, turns=${turnCount})`,
          );
        }
        if (turnCount > 0) {
          console.log(
            `[${new Date().toISOString()}] Agent completed with ${turnCount} tool turns (code=${code}) in ${latencyMs}ms`,
          );
        }

        if (!abortController.signal.aborted) {
          if (code !== 0) {
            reportRequestError(configDir, latencyMs);
            const publicMsg = logAgentError(
              config.sessionsLogPath,
              method,
              pathname,
              remoteAddress,
              code,
              stderrOut,
            );
            sse.closeCurrent();
            writeEvent({
              type: "message_delta",
              delta: { stop_reason: "error", stop_sequence: null },
              usage: { output_tokens: 0 },
            });
            writeEvent({
              type: "error",
              error: { type: "api_error", message: publicMsg },
            });
          } else {
            reportRequestSuccess(configDir, latencyMs);
            logTrafficResponse(
              config.verbose,
              model ?? cursorModel,
              accumulatedText,
              true,
            );
            sse.closeCurrent();
            writeEvent({
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: {
                input_tokens: estimateTokens(prompt.length),
                output_tokens: estimateTokens(accumulatedText.length),
              },
            });
            writeEvent({ type: "message_stop" });
          }
        }
        logAccountStats(config.verbose, getAccountStats());
        res.end();
      })
      .catch((err) => {
        reportRequestEnd(configDir);
        clearHeartbeat();
        if (idleTimer) clearTimeout(idleTimer);
        if (!abortController.signal.aborted) {
          reportRequestError(configDir, Date.now() - streamStart);
        }
        console.error(
          `[${new Date().toISOString()}] Agent stream error:`,
          err,
        );
        if (!abortController.signal.aborted) {
          sse.closeCurrent();
          writeEvent({
            type: "message_delta",
            delta: { stop_reason: "error", stop_sequence: null },
            usage: { output_tokens: 0 },
          });
          writeEvent({
            type: "error",
            error: {
              type: "api_error",
              message: "The Cursor agent stream failed. See server logs for details.",
            },
          });
        }
        res.end();
      });
    return;
  }

  const configDir = getNextAccountConfigDir();
  logAccountAssigned(configDir);
  reportRequestStart(configDir);
  const syncStart = Date.now();

  const abortController = new AbortController();
  req.once("close", () => abortController.abort());

  const out = await runAgentSync(
    config,
    workspaceDir,
    cmdArgs,
    tempDir,
    promptForAgent,
    configDir,
    abortController.signal,
  );
  const syncLatency = Date.now() - syncStart;
  reportRequestEnd(configDir);

  const analysis = analyzeStderr(out.stderr);
  if (analysis.isRateLimited) {
    reportRateLimit(configDir, 60000);
  }
  if (analysis.isMaxTurns) {
    console.warn(
      `[${new Date().toISOString()}] Cursor agent hit internal max_turns limit (stderr tail: ${out.stderr.slice(-300)})`,
    );
  }

  logLatency(syncLatency, displayModel, " [sync]");
  if (config.verbose) {
    console.log(
      `[${new Date().toISOString()}] Response in ${(syncLatency / 1000).toFixed(1)}s (model=${displayModel}) [sync]`,
    );
  }

  if (out.code !== 0) {
    reportRequestError(configDir, syncLatency);
    logAccountStats(config.verbose, getAccountStats());
    const errMsg = logAgentError(
      config.sessionsLogPath,
      method,
      pathname,
      remoteAddress,
      out.code,
      out.stderr,
    );
    json(res, 500, {
      error: { type: "api_error", message: errMsg, code: "cursor_cli_error" },
    });
    return;
  }

  reportRequestSuccess(configDir, syncLatency);
  const content = out.stdout.trim();
  logTrafficResponse(config.verbose, model ?? cursorModel, content, false);
  logAccountStats(config.verbose, getAccountStats());
  const inTok = estimateTokens(prompt.length);
  const outTok = estimateTokens(content.length);
  json(
    res,
    200,
    {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: content }],
      model: displayModel ?? cursorModel,
      stop_reason: "end_turn",
      usage: {
        input_tokens: inTok,
        output_tokens: outTok,
      },
    },
    truncatedHeaders,
  );
}
