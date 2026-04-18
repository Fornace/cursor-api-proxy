# Changelog

All notable changes to this project will be documented in this file.

## [0.10.0] — 2026-04-18

### Added
- **Skill translation (Path D)** — The Anthropic Agent SDK's `Skill` tool can't be dispatched to cursor-agent (it has its own hardcoded tool loop). The proxy now materialises bundled Anthropic skills — `init`, `review`, `simplify`, `security-review` — as `.cursor/rules/<name>.mdc` files inside the resolved workspace on each request. cursor-agent auto-discovers the rules, so `/simplify`, `/security-review`, etc. behave the same for proxied fast models (composer-2-fast) as for direct Anthropic endpoints. If the request advertises a `Skill` tool with an enum of names, only those names are materialised; otherwise every bundled skill is written. Existing `.mdc` files are left untouched — caller-authored rules take precedence.
- **Cursor tool_call → Anthropic tool_use translation** — `cli-stream-parser.ts` now recognises cursor-agent's `type:"tool_call"`, `subtype:"started"` events and surfaces them as Anthropic `tool_use` content blocks. Includes `readToolCall`, `editToolCall`, `writeToolCall`, `globToolCall`, `grepToolCall`, `shellToolCall`, `taskToolCall` (parallel sub-agents), `webFetchToolCall`, `webSearchToolCall`, and more. SDK consumers now see turn-by-turn tool activity from proxied fast models the same as a direct run — progress UI, budget tracking, nudge-on-silence all work. Unknown tool kinds fall back to stripping the `ToolCall` suffix.

### Changed
- **`toolsToSystemText` drops non-executable SDK tools** — `Skill`, `Task`, `Agent`, `EnterPlanMode`/`ExitPlanMode`, and the `Task*`/`TodoWrite`/`ScheduleWakeup` family are no longer serialised into the system prompt text. They either get translated elsewhere (Skill → rules, Task → cursor's native `taskToolCall`) or are harness-only bookkeeping — advertising them as JSON schemas to cursor-agent was pure noise.

## [0.9.3] — 2026-04-17

### Fixed
- **`--mode agent` is now the default** — Previously the proxy always appended `--mode <plan|ask>` to every `cursor-agent` invocation. Current cursor-agent treats both as strictly read-only (Write/Bash calls are silently dropped, exit 0 with empty stdout), which broke tool-heavy consumers such as claude-overnight workers. The mode flag is now only passed when `CURSOR_BRIDGE_MODE` is explicitly set to `plan` or `ask`; the new default (`agent`) omits the flag entirely so cursor-agent runs in its full agentic mode with Write/Bash/Read tool use. `CursorExecutionMode` accepts `"agent" | "plan" | "ask"`.

## [0.9.0] — 2026-04-16

### Added
- **Rich SSE streaming on `/v1/messages`** — The proxy now forwards `thinking_delta` and `tool_use` blocks emitted by cursor-agent (ACP `tool_call` + `agent_thought_chunk`, and `--stream-json` `tool_use` / `thinking` content parts) as proper Anthropic `content_block_*` events. SDK consumers with `includePartialMessages: true` (e.g. `claude-overnight`) now see live progress during long reasoning / tool-heavy runs instead of a silent spinner.
- **Thinking heartbeat** — A `content_block_start { type: "thinking" }` is emitted immediately after `message_start` so consumers get an instant "model is working" signal even when the first real event arrives minutes later.
- **CLI flags** — `--port <n>`, `--host <h>`, `--config-dir <path>` (repeatable), `--multi-port`. Running multiple proxy instances on the same machine no longer requires juggling env vars.
- **SSE: `flushHeaders()` + `socket.setNoDelay(true)`** so small stream frames aren't coalesced by Nagle / kernel buffering.
- **macOS keychain shim** — On Darwin, every spawned agent child is now launched with `NODE_OPTIONS=--require …/keychain-shim.cjs` that intercepts `/usr/bin/security` calls in `child_process.spawn` / `execFileSync`. `find-*` operations synthetically return `status 44` ("not found"); other operations return an empty buffer. This suppresses stray keychain prompts even when the Cursor CLI bypasses `CURSOR_SKIP_KEYCHAIN` at the process layer. Set `CURSOR_ALLOW_KEYCHAIN=1` to disable.

### Changed
- **Internal streaming API** — `runAgentStream` and `runAcpStream` now emit a structured `AgentStreamEvent` union (`{ kind: "text" | "thinking" | "tool_use" }`) instead of raw text chunks. Non-ACP and ACP paths share the same event shape; handlers no longer branch on `config.useAcp`. Consumers of the (previously private) `createStreamParser` helper must update to the new callback signature.

## [0.7.8] — 2026-04-16

### Fixed
- **`loadBridgeConfig`** — If `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` are unset, the agent now falls back to **`CURSOR_BRIDGE_API_KEY`**, so headless runs that only set the bridge secret (HTTP auth) still pass a token to the Cursor CLI and avoid macOS keychain / login-only paths.

## [0.7.7] — 2026-04-15

### Changed
- **CLI** — `CI` is set with `=` (not `??=`) so a parent process cannot leave a bad `CI` value that re-enables keychain probes.
- **Server** — On listen, logs one JSON line with `version`, `pid`, listen URL, `CI`, and `CURSOR_SKIP_KEYCHAIN` for debugging alongside claude-overnight.

## [0.7.6] — 2026-04-15

### Fixed
- **macOS keychain / headless agent** — Every spawned Cursor `agent` child now gets **`CI=true`** in addition to **`CURSOR_SKIP_KEYCHAIN=1`** (CLI, ACP, SDK auto-start, and `process.ts` after `envOverrides` so callers cannot disable either). Reduces keychain access from the CLI when used from harnesses such as claude-overnight.

## [0.7.5] — 2026-04-15

Version bump (no functional change from 0.7.4).

## [0.7.4] — 2026-04-15

### Fixed
- **ACP keychain guard** — `buildAcpSpawnEnv` no longer copies `CURSOR_SKIP_KEYCHAIN` from the parent `process.env`, which could overwrite the forced `"1"` (e.g. parent had `0` or empty). The skip flag is now applied last so it cannot be disabled by config or environment.
- **`acpEnv` and CLI entry** — bridge config always sets `CURSOR_SKIP_KEYCHAIN=1` on `acpEnv`; the CLI sets it at process start; the programmatic `client` proxy spawner injects it for the child.

## [0.7.3] — 2026-04-15

### Changed
- Renamed package to `cursor-composer-in-claude` for npm publishing.

## [0.7.2] — 2026-04-15

Fork of [cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) 0.7.1 with keychain and Node.js fixes.

### Fixed
- **macOS keychain popup suppressed** — `readKeychainToken()` returns `undefined` directly, avoiding the `security` execSync call that triggers the keychain dialog. The token is not needed since `cursor-agent` handles its own auth.
- **`CURSOR_SKIP_KEYCHAIN=1` always injected** into every spawned agent process (sync, streaming, and ACP), ensuring the underlying Cursor CLI never triggers the keychain popup regardless of parent environment.
- **`CURSOR_AGENT_NODE`/`CURSOR_AGENT_SCRIPT` on all platforms** — previously Windows-only; now available on macOS too to override the agent's bundled Node.js and avoid segfaults with `--list-models` on some installs.
