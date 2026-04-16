import { describe, it, expect, vi } from "vitest";
import { createStreamParser } from "./cli-stream-parser.js";
import type { AgentStreamEvent } from "./agent-stream-events.js";

function collector() {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    on: (e: AgentStreamEvent) => events.push(e),
  };
}

describe("createStreamParser", () => {
  it("emits incremental text deltas", () => {
    const c = collector();
    const onDone = vi.fn();
    const parse = createStreamParser(c.on, onDone);

    parse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
    );
    parse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      }),
    );

    expect(c.events).toEqual([
      { kind: "text", text: "Hello" },
      { kind: "text", text: " world" },
    ]);
  });

  it("deduplicates final full-message emission", () => {
    const c = collector();
    const parse = createStreamParser(c.on, () => {});

    parse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi there" }] },
      }),
    );
    parse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi there" }] },
      }),
    );

    expect(c.events).toEqual([{ kind: "text", text: "Hi there" }]);
  });

  it("emits thinking deltas separately from text", () => {
    const c = collector();
    const parse = createStreamParser(c.on, () => {});

    parse(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me think" },
            { type: "text", text: "Hi" },
          ],
        },
      }),
    );
    parse(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me think harder" },
            { type: "text", text: "Hi there" },
          ],
        },
      }),
    );

    expect(c.events).toEqual([
      { kind: "thinking", text: "Let me think" },
      { kind: "text", text: "Hi" },
      { kind: "thinking", text: " harder" },
      { kind: "text", text: " there" },
    ]);
  });

  it("emits tool_use once per id", () => {
    const c = collector();
    const parse = createStreamParser(c.on, () => {});

    parse(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "Read",
              input: { path: "foo.ts" },
            },
          ],
        },
      }),
    );
    parse(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "Read",
              input: { path: "foo.ts" },
            },
            { type: "text", text: "Done." },
          ],
        },
      }),
    );

    expect(c.events).toEqual([
      { kind: "tool_use", id: "tu_1", name: "Read", input: { path: "foo.ts" } },
      { kind: "text", text: "Done." },
    ]);
  });

  it("calls onDone when result/success received and stops emitting", () => {
    const c = collector();
    const onDone = vi.fn();
    const parse = createStreamParser(c.on, onDone);

    parse(JSON.stringify({ type: "result", subtype: "success" }));
    parse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "late" }] },
      }),
    );

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(c.events).toEqual([]);
  });

  it("ignores non-JSON and malformed lines", () => {
    const c = collector();
    const onDone = vi.fn();
    const parse = createStreamParser(c.on, onDone);

    parse("not json");
    parse("{");
    parse("");

    expect(c.events).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });
});
