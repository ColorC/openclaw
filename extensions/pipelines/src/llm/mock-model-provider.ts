/**
 * Mock Model Provider — 测试用
 *
 * 按顺序返回预设响应，记录调用日志供断言。
 */

import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ToolDefinition,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface MockResponseEntry {
  /** Optional matcher — if provided, only matches when predicate returns true */
  match?: (messages: ChatMessage[]) => boolean;
  response: ChatResponse;
}

export interface MockCallRecord {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  options?: ChatOptions;
}

// ============================================================================
// MockModelProvider
// ============================================================================

export class MockModelProvider implements ModelProvider {
  private responses: MockResponseEntry[];
  private callIndex = 0;
  private _calls: MockCallRecord[] = [];

  constructor(responses: Array<MockResponseEntry | ChatResponse>) {
    this.responses = responses.map((r) =>
      "response" in r ? (r as MockResponseEntry) : { response: r as ChatResponse },
    );
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this._calls.push({ messages, options });
    return this.nextResponse(messages);
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    this._calls.push({ messages, tools, options });
    return this.nextResponse(messages);
  }

  /** All recorded calls */
  get calls(): readonly MockCallRecord[] {
    return this._calls;
  }

  /** Reset call log and response index */
  reset(): void {
    this._calls = [];
    this.callIndex = 0;
  }

  // ==================== Internal ====================

  private nextResponse(messages: ChatMessage[]): ChatResponse {
    // Try matcher-based responses first
    for (const entry of this.responses) {
      if (entry.match && entry.match(messages)) {
        return entry.response;
      }
    }

    // Fall back to sequential (skip matcher-only entries)
    while (this.callIndex < this.responses.length) {
      const entry = this.responses[this.callIndex++];
      if (!entry.match) return entry.response;
    }

    throw new Error(
      `MockModelProvider: no more responses (called ${this._calls.length} times, no matching or sequential responses left)`,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple text response */
export function mockTextResponse(content: string): ChatResponse {
  return { content };
}

/** Create a tool call response */
export function mockToolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id = "tc-mock",
): ChatResponse {
  return {
    content: "",
    toolCalls: [{ id, name, arguments: args }],
  };
}
