import type { AgentStreamEvent } from "./agent-stream-events.js";

type BlockType = "text" | "thinking" | "tool_use";

type WriteEvent = (evt: object) => void;

/**
 * Manages `content_block_*` bookkeeping for Anthropic streaming responses.
 *
 * Anthropic requires that only one content block is open at a time and that
 * block indices are contiguous and monotonic. This helper closes the current
 * block before opening a new one of a different type, and exposes a single
 * `emit(event)` entry point that maps our `AgentStreamEvent` union to the
 * correct SSE frames (`content_block_start`, `content_block_delta`, `content_block_stop`).
 */
export function createAnthropicSseWriter(writeEvent: WriteEvent) {
  let index = -1;
  let openType: BlockType | null = null;

  const close = () => {
    if (openType === null) return;
    writeEvent({ type: "content_block_stop", index });
    openType = null;
  };

  const ensureOpen = (type: BlockType, startPayload: object) => {
    if (openType === type) return;
    close();
    index += 1;
    openType = type;
    writeEvent({ type: "content_block_start", index, content_block: startPayload });
  };

  return {
    /**
     * Emit an initial empty `thinking` block right after `message_start`.
     * Gives consumers an immediate "model is working" signal even when the first
     * real event arrives minutes later (thinking models, long tool calls).
     */
    openHeartbeatThinking(): void {
      ensureOpen("thinking", { type: "thinking", thinking: "" });
    },

    emit(event: AgentStreamEvent): void {
      if (event.kind === "text") {
        ensureOpen("text", { type: "text", text: "" });
        writeEvent({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: event.text },
        });
      } else if (event.kind === "thinking") {
        ensureOpen("thinking", { type: "thinking", thinking: "" });
        writeEvent({
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: event.text },
        });
      } else if (event.kind === "tool_use") {
        close();
        index += 1;
        openType = "tool_use";
        writeEvent({
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: event.id,
            name: event.name,
            input: {},
          },
        });
        writeEvent({
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(event.input ?? {}),
          },
        });
        writeEvent({ type: "content_block_stop", index });
        openType = null;
      }
    },

    closeCurrent(): void {
      close();
    },
  };
}
