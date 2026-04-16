import type { AgentStreamEvent } from "./agent-stream-events.js";

/**
 * Parse Cursor CLI stream-json output into structured events.
 *
 * cursor-agent emits one JSON object per stdout line. Known shapes:
 * - `{ type: "assistant", message: { content: [{type:"text", text}, {type:"thinking", thinking}, {type:"tool_use", id, name, input}] } }`
 *   The `message.content` array is cumulative — each line contains the full message so far.
 *   We diff against what we've already emitted so consumers see clean deltas.
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

  return (line: string) => {
    if (done) return;
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        subtype?: string;
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
            if (!seenToolIds.has(part.id)) {
              seenToolIds.add(part.id);
              onEvent({
                kind: "tool_use",
                id: part.id,
                name: part.name,
                input: part.input ?? {},
              });
            }
          }
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
