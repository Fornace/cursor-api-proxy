# cursor-composer-in-claude

OpenAI- and Anthropic-compatible proxy for the Cursor agent CLI. Expose Cursor models on localhost so any LLM client — OpenAI SDK, Anthropic SDK, LiteLLM, LangChain, etc. — can call them through standard chat APIs.

This package is **one npm dependency**: use it as an **SDK** in your app (auto-starts the proxy in the background), or run the **CLI** to start the proxy server yourself.

> _Originally built as a companion for [claude-overnight](https://www.npmjs.com/package/claude-overnight)._

## What it does

- **`POST /v1/chat/completions`** — OpenAI-compatible chat completions (streaming + non-streaming)
- **`POST /v1/messages`** — Anthropic Messages API with full SSE streaming (thinking deltas, tool-use blocks, heartbeat)
- **`GET /v1/models`** — Lists available Cursor models
- **Multi-account rotation** — Auto-discover and round-robin across multiple Cursor accounts to spread rate limits
- **SDK auto-start** — The proxy starts automatically in the background when you use the SDK with the default URL
- **macOS keychain suppression** — No keychain popups, ever
- **Workspace isolation** — Runs each request in an empty temp directory by default so the agent cannot read or write your project files

> **Note:** The HTTP API is not the Cursor IDE. There is no automatic `@codebase`, repo indexing, or host shell access from the proxy alone. See [Workspace and agent frameworks](#workspace-and-agent-frameworks).

## Prerequisites

- **Node.js** 18+
- **Cursor agent CLI** (`agent`). This package does not bundle the CLI. Install it separately:

  ```bash
  curl https://cursor.com/install -fsS | bash
  agent login
  agent --list-models
  ```

  For headless/automation use, set `CURSOR_API_KEY` instead of `agent login`.

## Install

**As a dependency (SDK):**

```bash
npm install cursor-composer-in-claude
```

**From source:**

```bash
git clone <this-repo>
cd cursor-composer-in-claude
npm install
npm run build
```

## Quick start (CLI)

Start the proxy server:

```bash
npx cursor-api-proxy
# or from repo: npm start
```

Default listen address: **`http://127.0.0.1:8765`**.

Expose on your network (e.g. Tailscale):

```bash
npx cursor-api-proxy --tailscale
```

Run multiple independent instances:

```bash
npx cursor-api-proxy --port 8765 --config-dir ~/.cursor-api-proxy/accounts/alice &
npx cursor-api-proxy --port 8766 --config-dir ~/.cursor-api-proxy/accounts/bob   &
```

### CLI commands

```bash
npx cursor-api-proxy login [name]            # Log into a Cursor account (isolated profile)
npx cursor-api-proxy login [name] --proxy=.. # Login through a proxy (comma-separated list)
npx cursor-api-proxy accounts                # List saved accounts with live usage/plan info
npx cursor-api-proxy logout <name>           # Remove a saved account
npx cursor-api-proxy reset-hwid              # Reset Cursor machine/telemetry IDs
npx cursor-api-proxy reset-hwid --deep-clean # Also wipe session storage and cookies
```

### CLI options

| Flag | Description |
|------|-------------|
| `--port <n>` | Listen port (default: 8765) |
| `--host <h>` | Listen host (default: 127.0.0.1) |
| `--config-dir <path>` | Cursor config dir to use (repeatable for account pool) |
| `--multi-port` | With multiple `--config-dir`, spawn one server per dir on incrementing ports |
| `--tailscale` | Bind to `0.0.0.0` for tailnet/LAN access |
| `-h, --help` | Show help |

Flags override their equivalent environment variables.

## Use as SDK

The SDK can start the proxy automatically in the background (Node.js only) if it is not already reachable at the default URL.

- **Base URL**: `http://127.0.0.1:8765/v1` (override with `CURSOR_PROXY_URL` or options)
- **API key**: Use any value (e.g. `unused`), or set `CURSOR_BRIDGE_API_KEY` and pass it
- **Auto-start**: Enabled by default when using the default base URL. Pass `startProxy: false` to disable
- **Shutdown**: The SDK stops the managed proxy on process exit or normal termination signals

### Option A: OpenAI SDK + helper (recommended)

`openai` is not a dependency of this package; install it only in the consumer project.

```js
import OpenAI from "openai";
import { getOpenAIOptionsAsync } from "cursor-composer-in-claude";

const opts = await getOpenAIOptionsAsync(); // starts proxy if needed
const client = new OpenAI(opts);

const completion = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(completion.choices[0].message.content);
```

For a sync variant without auto-start, use `getOpenAIOptions()`.

### Option B: Minimal client (no OpenAI SDK)

```js
import { createCursorProxyClient } from "cursor-composer-in-claude";

const proxy = createCursorProxyClient(); // proxy starts on first request if needed
const data = await proxy.chatCompletionsCreate({
  model: "auto",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(data.choices?.[0]?.message?.content);
```

### Option C: Raw OpenAI client (no SDK import)

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8765/v1",
  apiKey: process.env.CURSOR_BRIDGE_API_KEY || "unused",
});
// Start the proxy yourself (npx cursor-api-proxy) or use Option A/B for auto-start.
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server and config info |
| GET | `/v1/models` | List Cursor models (from `agent --list-models`) |
| POST | `/v1/chat/completions` | OpenAI-style chat completion (supports `stream: true`) |
| POST | `/v1/messages` | Anthropic Messages API (supports `stream: true`) |

**Token usage:** Responses may include `usage` with `prompt_tokens`, `completion_tokens`, and `total_tokens`. These are heuristic estimates (character count ÷ 4), not Cursor billing meters.

## Multi-account setup

Use multiple Cursor accounts to distribute load and avoid rate limits.

### Adding accounts

```bash
npx cursor-api-proxy login account1
npx cursor-api-proxy login account2
```

An incognito Chrome window opens for each login. Sessions are saved under `~/.cursor-api-proxy/accounts/` (macOS/Linux) or `%USERPROFILE%\.cursor-api-proxy\accounts\` (Windows).

**Auto-discovery:** When you start the proxy normally, it automatically finds all authenticated accounts under that directory and rotates between them.

### Manual config directories

Override auto-discovery with `CURSOR_CONFIG_DIRS` (or `CURSOR_ACCOUNT_DIRS`):

```bash
CURSOR_CONFIG_DIRS=/path/to/cfg1,/path/to/cfg2 npm start
```

### Rotation modes

**Single port, round-robin (default)** — One server listens on one port and rotates across accounts per request, picking the least busy account automatically.

**Multi-port** — Spawn one server per account on incrementing ports:

```bash
npx cursor-api-proxy --port 8765 \
  --config-dir ~/.cursor-api-proxy/accounts/alice \
  --config-dir ~/.cursor-api-proxy/accounts/bob   \
  --multi-port
# → alice on 8765, bob on 8766
```

## Streaming

Both `/v1/chat/completions` and `/v1/messages` support `stream: true`.

### OpenAI SSE (`/v1/chat/completions`)

Returns `chat.completion.chunk` deltas. Thinking and text are both surfaced as `delta.content` so callers see live progress. Tool events are not currently synthesized into OpenAI `delta.tool_calls` — use `/v1/messages` if you need structured tool events.

### Anthropic SSE (`/v1/messages`)

Returns proper Anthropic SSE events. Event types forwarded:

| Event | When |
|-------|------|
| `message_start` | At request start |
| `content_block_start { type: "thinking" }` | Heartbeat immediately after start, and whenever the agent reasons |
| `content_block_delta { type: "thinking_delta" }` | Per thinking chunk |
| `content_block_start { type: "tool_use" }` + `input_json_delta` | Per tool invocation (read, edit, write, glob, grep, shell, task, web fetch, web search, etc.) |
| `content_block_start { type: "text" }` + `text_delta` | Assistant output text |
| `content_block_stop` | When block type changes or stream ends |
| `message_delta` + `message_stop` | End of stream with `stop_reason: "end_turn"` |
| `error` | On upstream agent failure |

The heartbeat `thinking` block fires within milliseconds so clients get an immediate progress signal even when the first real output takes minutes (common on reasoning models).

**Test streaming:**

```bash
node examples/test-stream.mjs
```

See [examples/README.md](examples/README.md) for more.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_BRIDGE_HOST` | `127.0.0.1` | Bind address. `--tailscale` changes this to `0.0.0.0` unless already set. |
| `CURSOR_BRIDGE_PORT` | `8765` | Listen port |
| `CURSOR_BRIDGE_API_KEY` | — | If set, requires `Authorization: Bearer <key>` on requests. Also used as the **agent** token when `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` are unset. |
| `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` | — | Cursor access token passed to spawned CLI/ACP children. Takes precedence over `CURSOR_BRIDGE_API_KEY` for the agent. |
| `CURSOR_BRIDGE_WORKSPACE` | process cwd | Base workspace directory. With `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false`, the `X-Cursor-Workspace` header must point to an existing directory under this path. |
| `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE` | `true` | When `true`, the CLI runs in an empty temp dir so it cannot read or write your real project. Also overrides `HOME`, `USERPROFILE`, and `CURSOR_CONFIG_DIR` so the agent cannot load global or project rules. Set to `false` to allow workspace access. |
| `CURSOR_BRIDGE_MODE` | `agent` | Execution mode: `agent` (full tool use, default), `plan` (read-only), or `ask` (chat-only). |
| `CURSOR_BRIDGE_DEFAULT_MODEL` | `auto` | Default model when the request omits one |
| `CURSOR_BRIDGE_STRICT_MODEL` | `true` | Use the last requested model when none is specified |
| `CURSOR_BRIDGE_FORCE` | `false` | Pass `--force` to the Cursor CLI |
| `CURSOR_BRIDGE_APPROVE_MCPS` | `false` | Pass `--approve-mcps` to the Cursor CLI |
| `CURSOR_BRIDGE_TIMEOUT_MS` | `300000` | Timeout per completion (ms) |
| `CURSOR_BRIDGE_TLS_CERT` | — | Path to TLS certificate file (e.g. Tailscale cert). Use with `CURSOR_BRIDGE_TLS_KEY` for HTTPS. |
| `CURSOR_BRIDGE_TLS_KEY` | — | Path to TLS private key file. Use with `CURSOR_BRIDGE_TLS_CERT` for HTTPS. |
| `CURSOR_BRIDGE_SESSIONS_LOG` | `~/.cursor-api-proxy/sessions.log` | Path to request log file (timestamp, method, path, IP, status). |
| `CURSOR_BRIDGE_VERBOSE` | `false` | When `true`, print full request messages and response content to stdout for every completion. |
| `CURSOR_BRIDGE_MAX_MODE` | `false` | When `true`, enable Cursor **Max Mode** for all requests (larger context window, higher tool-call limits). |
| `CURSOR_BRIDGE_PROMPT_VIA_STDIN` | `false` | When `true`, send the user prompt via stdin instead of argv (helps on Windows if argv is truncated). |
| `CURSOR_BRIDGE_USE_ACP` | `false` | When `true`, use **ACP (Agent Client Protocol)** over stdio (`agent acp`). Avoids Windows argv limits. Set `NODE_DEBUG=cursor-api-proxy:acp` to debug. |
| `CURSOR_BRIDGE_ACP_SKIP_AUTHENTICATE` | auto | When an agent API key is resolved, skips the ACP authenticate step. Set to `true` to skip when using `agent login` instead. |
| `CURSOR_BRIDGE_ACP_RAW_DEBUG` | `false` | When `1` or `true`, log raw JSON-RPC from ACP stdout (requires `NODE_DEBUG=cursor-api-proxy:acp`). |
| `CURSOR_BRIDGE_RATE_LIMIT_MAX` | `0` | Inbound rate limit: max requests per IP within the window. `0` disables rate limiting. |
| `CURSOR_BRIDGE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit sliding window duration in milliseconds. |
| `CURSOR_BRIDGE_WIN_CMDLINE_MAX` | `30000` | **(Windows)** Upper bound for the full CreateProcess command line. If exceeded, the proxy keeps the tail of the prompt and prepends an omission notice. Clamped to `4096`–`32700`. |
| `CURSOR_CONFIG_DIRS` / `CURSOR_ACCOUNT_DIRS` | — | Comma-separated configuration directories for round-robin account rotation. Auto-discovers authenticated accounts under `~/.cursor-api-proxy/accounts/` when unset. |
| `CURSOR_BRIDGE_MULTI_PORT` | `false` | When `true` and multiple config dirs are set, spawn a separate server per directory on incrementing ports starting from `CURSOR_BRIDGE_PORT`. |
| `CURSOR_AGENT_BIN` | `agent` | Path to Cursor CLI binary. Alias precedence: `CURSOR_AGENT_BIN`, `CURSOR_CLI_BIN`, `CURSOR_CLI_PATH`. |
| `CURSOR_AGENT_NODE` | — | Path to Node.js. With `CURSOR_AGENT_SCRIPT`, spawns Node directly and bypasses cmd.exe's ~8191 limit. Available on all platforms. |
| `CURSOR_AGENT_SCRIPT` | — | Path to the agent script (e.g. `agent.cmd` or `.js`). Use with `CURSOR_AGENT_NODE` for long prompts. |
| `CURSOR_SKIP_KEYCHAIN` | `1` (always) | Always injected into every spawned agent process. The macOS keychain popup is suppressed by default. |

Notes:
- Relative paths (`CURSOR_BRIDGE_WORKSPACE`, `CURSOR_BRIDGE_SESSIONS_LOG`, `CURSOR_BRIDGE_TLS_CERT`, `CURSOR_BRIDGE_TLS_KEY`) are resolved from the current working directory.
- ACP `session/request_permission` uses `reject-once` (least-privilege) so the agent cannot grant file/tool access; this is intentional for chat-only mode.

## Workspace and agent frameworks

Pointing an agent runtime at this proxy gives you a **cloud model behind a standard HTTP API**. This is not the same as the **Cursor IDE**, which indexes and acts on a local workspace.

- **No implicit project context:** The model only sees what you send in the request — `messages`, optional tools schema, and tool results that your client executes and sends back.
- **Client-side tools:** Reads, shell commands, and directory listings happen only when your agent framework implements tools, runs them on the host, and returns outputs in follow-up messages.
- **Server-side workspace (optional):** Set `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false` and send the `X-Cursor-Workspace` header to use a subdirectory of `CURSOR_BRIDGE_WORKSPACE` for a specific request. The path must exist under the base workspace directory.
- **Skill translation:** When using the Anthropic SDK's `Skill` tool, the proxy materialises bundled skills (`init`, `review`, `simplify`, `security-review`) as `.cursor/rules/<name>.mdc` files in the resolved workspace. cursor-agent auto-discovers them, so `/<name>` invocations work for proxied fast models.

**Recommended patterns:** Use client-side tools and pass results as tool messages; add RAG or retrieval and inject snippets into `user` content; or paste relevant files into the prompt.

## macOS keychain

This package **always** forces `CURSOR_SKIP_KEYCHAIN=1` and `CI=true` into every spawned Cursor agent process. For ACP, the variable is applied last when building the child environment so a parent value cannot override it.

On macOS, a `NODE_OPTIONS` shim also intercepts `/usr/bin/security` calls in child processes. `find-*` operations return a synthetic "not found" status; other operations return empty data. Set `CURSOR_ALLOW_KEYCHAIN=1` to disable this shim.

If you still see a system keychain prompt, it is usually the Cursor `agent` binary accessing the login keychain directly. Updating the Cursor CLI and ensuring `agent login` or `CURSOR_API_KEY` is set typically avoids repeated prompts.

## Windows command-line limits

Two limits matter on Windows:

1. **cmd.exe** — about 8191 characters.
2. **CreateProcess** — about 32,767 characters for the entire command line.

When `agent.cmd` is used, the proxy **auto-detects the versioned layout** (`versions/YYYY.MM.DD-commit/`) and spawns `node.exe` + `index.js` from the latest version directly, bypassing cmd.exe. If that does not apply, set both `CURSOR_AGENT_NODE` and `CURSOR_AGENT_SCRIPT` so the proxy spawns Node with the script directly.

Very large prompts can still hit the CreateProcess cap. The proxy mitigates this by **truncating the start of the prompt** while **keeping the tail** (recent context), prepending a short notice, and setting `X-Cursor-Proxy-Prompt-Truncated: true` on the response. Tune with `CURSOR_BRIDGE_WIN_CMDLINE_MAX` (default `30000`). **ACP** or **stdin prompt** avoids argv length limits entirely.

## HTTPS with Tailscale (MagicDNS)

To serve over HTTPS so browsers and clients trust the connection:

1. **Generate Tailscale certificates** on this machine:

   ```bash
   sudo tailscale cert <your-machine>.tailXXXX.ts.net
   ```

2. **Run the proxy with TLS:**

   ```bash
   export CURSOR_BRIDGE_API_KEY=your-secret
   export CURSOR_BRIDGE_TLS_CERT=./<your-machine>.tailXXXX.ts.net.crt
   export CURSOR_BRIDGE_TLS_KEY=./<your-machine>.tailXXXX.ts.net.key
   npm start
   ```

3. **Access the API** from any device on your tailnet at `https://<your-machine>.tailXXXX.ts.net:8765/v1`.

## License

MIT
