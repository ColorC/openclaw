/**
 * OpenAI Model Provider
 *
 * 使用 openai SDK 实现 ModelProvider 接口，支持 tool calling。
 */

import OpenAI from "openai";
import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ToolDefinition,
  ModelProviderConfig,
} from "./types.js";

// ============================================================================
// OpenAI Model Provider
// ============================================================================

export interface OpenAIModelProviderConfig extends ModelProviderConfig {
  /** OpenAI API key (or uses OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Base URL override (for proxies like Azure, Ollama) */
  baseUrl?: string;
  /** Organization ID */
  organization?: string;
  /** Request timeout in ms (default: 600_000 = 10 min) */
  timeout?: number;
  /** Max retries on transient errors (default: 3) */
  maxRetries?: number;
}

export class OpenAIModelProvider implements ModelProvider {
  private client: OpenAI;
  private config: ModelProviderConfig;

  constructor(config: OpenAIModelProviderConfig = {}) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
      organization: config.organization,
      timeout: config.timeout ?? 600_000, // 10 min per request
      maxRetries: config.maxRetries ?? 2,
    });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = this.resolveModel(options?.modelRole);
    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map(this.convertMessage),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? "",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
      model: response.model,
    };
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const model = this.resolveModel(options?.modelRole);
    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map(this.convertMessage),
      tools: tools.map(this.convertTool),
      // 使用 'auto' 兼容 GLM 等国产模型（GLM 不支持 'required'）
      tool_choice: "auto",
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    if (message?.tool_calls?.length) {
      return {
        content: message.content ?? "",
        toolCalls: message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => {
            try {
              return JSON.parse(tc.function.arguments);
            } catch {
              // LLM returned malformed JSON — attempt to salvage
              console.warn(
                `[model-provider] Malformed tool call JSON for ${tc.function.name}, attempting repair`,
              );
              try {
                // Common fix: trailing garbage after closing brace
                const trimmed = tc.function.arguments.replace(/\}[^}]*$/, "}");
                return JSON.parse(trimmed);
              } catch {
                return { _raw: tc.function.arguments, _parseError: true };
              }
            }
          })(),
        })),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
            }
          : undefined,
        model: response.model,
      };
    }

    // 没有 tool call，返回纯文本
    return {
      content: message?.content ?? "",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
      model: response.model,
    };
  }

  // ==================== Internal ====================

  private resolveModel(role: string | undefined): string {
    if (role && this.config.roleMapping?.[role as keyof typeof this.config.roleMapping]) {
      return this.config.roleMapping[role as keyof typeof this.config.roleMapping]!;
    }
    return this.config.defaultModel ?? "gpt-4o-mini";
  }

  private convertMessage(msg: ChatMessage): OpenAI.ChatCompletionMessageParam {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }
    if (msg.role === "user") {
      return { role: "user", content: msg.content };
    }
    if (msg.role === "assistant") {
      if (msg.toolCalls) {
        return {
          role: "assistant",
          content: msg.content,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: "assistant", content: msg.content };
    }
    if (msg.role === "tool") {
      return { role: "tool", tool_call_id: msg.toolCallId!, content: msg.content };
    }
    return { role: "user", content: msg.content };
  }

  private convertTool(tool: ToolDefinition): OpenAI.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}
