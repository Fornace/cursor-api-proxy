/**
 * Structured events emitted by the agent streaming layer.
 * Consumers (Anthropic / OpenAI handlers) map these to protocol-specific blocks.
 */
export type AgentStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown };
