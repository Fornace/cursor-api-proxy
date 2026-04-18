import { describe, it, expect, vi } from "vitest";
import { createStreamParser, mapCursorToolName } from "./cli-stream-parser.js";
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

  it("translates cursor tool_call:started → tool_use", () => {
    const c = collector();
    const parse = createStreamParser(c.on, () => {});

    parse(
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "tool_abc",
        tool_call: {
          readToolCall: { args: { path: "/tmp/messy.ts" } },
        },
      }),
    );
    parse(
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "tool_def",
        tool_call: {
          taskToolCall: {
            args: {
              description: "Count lines",
              prompt: "Read /tmp/messy.ts and count lines",
            },
          },
        },
      }),
    );

    expect(c.events).toEqual([
      {
        kind: "tool_use",
        id: "tool_abc",
        name: "Read",
        input: { path: "/tmp/messy.ts" },
      },
      {
        kind: "tool_use",
        id: "tool_def",
        name: "Task",
        input: {
          description: "Count lines",
          prompt: "Read /tmp/messy.ts and count lines",
        },
      },
    ]);
  });

  it("deduplicates tool_call emissions across started + completed", () => {
    const c = collector();
    const parse = createStreamParser(c.on, () => {});

    const started = {
      type: "tool_call",
      subtype: "started",
      call_id: "tool_xyz",
      tool_call: { editToolCall: { args: { path: "x.ts" } } },
    };
    parse(JSON.stringify(started));
    parse(JSON.stringify({ ...started, subtype: "completed" }));

    expect(c.events).toEqual([
      { kind: "tool_use", id: "tool_xyz", name: "Edit", input: { path: "x.ts" } },
    ]);
  });

  it("maps unknown cursor tool kinds by stripping ToolCall suffix", () => {
    expect(mapCursorToolName("readToolCall")).toBe("Read");
    expect(mapCursorToolName("shellToolCall")).toBe("Bash");
    expect(mapCursorToolName("taskToolCall")).toBe("Task");
    expect(mapCursorToolName("brandNewToolCall")).toBe("BrandNew");
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
