export type Role = 'user' | 'assistant' | 'tool';

export interface NormalizedToolCall {
  id: string;
  name: string;
  /** Raw JSON string, uniformly across providers — Anthropic's already-parsed `input` is
   *  re-stringified by its adapter so both providers hand the decision loop the same shape. */
  argsRaw: string;
}

export interface NormalizedToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface NormalizedMessage {
  role: Role;
  text?: string;
  toolCalls?: NormalizedToolCall[];
  toolResults?: NormalizedToolResult[];
}

export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface NormalizedResponse {
  stopReason: 'tool_calls' | 'end' | 'error';
  toolCalls: NormalizedToolCall[];
  text: string | null;
  /** The raw provider response, kept only for logging/debugging. */
  raw: unknown;
}

/**
 * Provider-agnostic single-turn interface. The multi-turn agentic loop (retry, repair, model
 * escalation) lives once in `decisionLoop.ts`, not per provider — each adapter only translates
 * between this normalized shape and its own API, which is what makes adding a new provider (e.g.
 * Groq) a single new adapter file rather than a third copy of loop/repair logic.
 */
export interface LLMProvider {
  readonly name: string;
  createTurn(params: {
    system: string;
    messages: NormalizedMessage[];
    tools: ToolSpec[];
  }): Promise<NormalizedResponse>;
}
