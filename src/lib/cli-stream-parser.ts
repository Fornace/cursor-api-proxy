import type { AgentStreamEvent } from "./agent-stream-events.js";

/**
 * Parse Cursor CLI stream-json output into structured events.
 *
 * cursor-agent emits one JSON object per stdout line. Known shapes:
 * - `{ type: "assistant", message: { content: [{type:"text", text}, {type:"thinking", thinking}, {type:"tool_use", id, name, input}] } }`
 *   The `message.content` array is cumulative — each line contains the full message so far.
 *   We diff against what we've already emitted so consumers see clean deltas.
 * - `{ type: "tool_call", subtype: "started"|"completed", call_id, tool_call: { <kind>ToolCall: { args, result? } } }`
 *   cursor-agent's native tool events. We translate them to Anthropic `tool_use`
 *   blocks so SDK consumers (claude-overnight progress UI, budget tracking,
 *   nudge-on-silence) see tool activity the same way as a direct Anthropic run.
 * - `{ type: "result", subtype: "success" }` — terminates the stream.
 *
 * Unknown types are ignored (non-JSON lines too) so future cursor CLI updates don't crash.
 */
export function createStreamParser(
  onEvent: (event: AgentStreamEvent) => void,
  onDone: () => void,
): (line: string) => void {
  let textAcc = "";
  let thinkingAcc = "";
  const seenToolIds = new Set<string>();
  let done = false;

  const emitToolUse = (id: string, name: string, input: unknown) => {
    if (seenToolIds.has(id)) return;
    seenToolIds.add(id);
    onEvent({ kind: "tool_use", id, name, input });
  };

  return (line: string) => {
    if (done) return;
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        call_id?: string;
        tool_call?: Record<string, { args?: unknown }>;
        message?: {
          content?: Array<{
            type?: string;
            text?: string;
            thinking?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>;
        };
      };

      if (obj.type === "assistant" && obj.message?.content) {
        for (const part of obj.message.content) {
          if (part.type === "text" && typeof part.text === "string") {
            const delta = diffAppend(part.text, textAcc);
            if (delta !== null) {
              textAcc = part.text;
              if (delta) onEvent({ kind: "text", text: delta });
            }
          } else if (
            part.type === "thinking" &&
            typeof part.thinking === "string"
          ) {
            const delta = diffAppend(part.thinking, thinkingAcc);
            if (delta !== null) {
              thinkingAcc = part.thinking;
              if (delta) onEvent({ kind: "thinking", text: delta });
            }
          } else if (part.type === "tool_use" && part.id && part.name) {
            emitToolUse(part.id, part.name, part.input ?? {});
          }
        }
      }

      if (
        obj.type === "tool_call" &&
        obj.subtype === "started" &&
        obj.call_id &&
        obj.tool_call
      ) {
        const entry = Object.entries(obj.tool_call)[0];
        if (entry) {
          const [rawKind, body] = entry;
          const name = mapCursorToolName(rawKind);
          const input =
            body && typeof body === "object" && "args" in body
              ? ((body as { args?: unknown }).args ?? {})
              : {};
          emitToolUse(obj.call_id, name, input);
        }
      }

      if (obj.type === "result" && obj.subtype === "success") {
        done = true;
        onDone();
      }
    } catch {
      /* ignore parse errors for non-JSON lines */
    }
  };
}

/**
 * Map cursor-agent's camelCase tool kind (e.g. `readToolCall`) to its
 * Anthropic-standard name (`Read`). Unknown kinds fall back to stripping the
 * `ToolCall` suffix and capitalising, which keeps future cursor tools
 * surfacing with a reasonable name rather than being dropped on the floor.
 */
export function mapCursorToolName(rawKind: string): string {
  const table: Record<string, string> = {
    readToolCall: "Read",
    editToolCall: "Edit",
    writeToolCall: "Write",
    multiEditToolCall: "MultiEdit",
    globToolCall: "Glob",
    grepToolCall: "Grep",
    shellToolCall: "Bash",
    runTerminalToolCall: "Bash",
    terminalToolCall: "Bash",
    taskToolCall: "Task",
    webFetchToolCall: "WebFetch",
    webSearchToolCall: "WebSearch",
    readLintsToolCall: "ReadLints",
    lsToolCall: "LS",
    todoWriteToolCall: "TodoWrite",
    notebookEditToolCall: "NotebookEdit",
  };
  if (rawKind in table) return table[rawKind];
  const stripped = rawKind.replace(/ToolCall$/, "");
  if (!stripped) return rawKind;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * If `full` extends `prev`, return the delta (possibly empty).
 * If `full === prev`, return empty string (no-op).
 * If `full` is a completely different string (no prefix match), return `full`
 *   and reset — cursor-agent sometimes re-emits the whole message.
 * Returns null when `full` is shorter/older than `prev` (stale line, skip).
 */
function diffAppend(full: string, prev: string): string | null {
  if (full === prev) return "";
  if (prev.length === 0) return full;
  if (full.startsWith(prev)) return full.slice(prev.length);
  if (full.length < prev.length) return null;
  return full;
}
