/**
 * LLM 模型提供者抽象层
 *
 * 定义与具体 LLM SDK 无关的接口，支持多 provider（OpenAI、Anthropic、Pi SDK）
 * 和按角色路由到不同模型。
 */

// ============================================================================
// Model Role — 按任务类型选模型
// ============================================================================

export type ModelRole = "classifier" | "architect" | "coder" | "reviewer" | "general";

// ============================================================================
// Chat Messages
// ============================================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// Tool Definitions (for function calling)
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// ============================================================================
// Chat Options & Response
// ============================================================================

export interface ChatOptions {
  modelRole?: ModelRole;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCallRequest[];
  usage?: { promptTokens: number; completionTokens: number };
  model?: string;
}

// ============================================================================
// Model Provider Interface
// ============================================================================

export interface ModelProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ModelProviderConfig {
  /** Map model roles to specific model IDs */
  roleMapping?: Partial<Record<ModelRole, string>>;
  /** Default model when no role mapping matches */
  defaultModel?: string;
  /** API key */
  apiKey?: string;
  /** Base URL override */
  baseUrl?: string;
}

/** Resolve model ID from role + config */
export function resolveModelId(role: ModelRole | undefined, config: ModelProviderConfig): string {
  if (role && config.roleMapping?.[role]) {
    return config.roleMapping[role]!;
  }
  return config.defaultModel ?? "gpt-4o-mini";
}
