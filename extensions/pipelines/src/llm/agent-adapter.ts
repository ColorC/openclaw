/**
 * Agent 框架集成适配器
 *
 * 桥接 Pipeline 的 ModelProvider 与 @mariozechner/pi-agent-core 的 agentLoop。
 * 让工作流节点（如需求澄清）能复用 OpenClaw 已有的 agent 循环能力。
 */

import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
} from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, Message } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { agentLoop } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type { ModelProviderConfig } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Pipeline 工具定义 — JSON Schema + execute 函数
 */
export interface PipelineAgentTool {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Agent 循环结果
 */
export interface AgentLoopResult {
  /** 所有消息（含 LLM 和工具结果） */
  messages: AgentMessage[];
  /** 最后一条 assistant 消息的文本内容 */
  finalResponse: string;
  /** 所有工具调用记录 */
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
}

/**
 * Agent 运行选项
 */
export interface AgentRunOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 对话历史 — 预填充到 agentLoop context.messages，支持多轮交互 */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

// ============================================================================
// Model Builder
// ============================================================================

/**
 * 从 ModelProviderConfig 构建 pi-ai Model 对象
 */
export function createModelFromConfig(config: ModelProviderConfig): Model<"openai-completions"> {
  const modelId = config.defaultModel ?? "gpt-4o-mini";
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openai",
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
    },
  };
}

// ============================================================================
// Tool Adapter
// ============================================================================

/**
 * 将 Pipeline 工具 (JSON Schema) 转换为 pi-agent AgentTool (TypeBox)
 */
function adaptTool(tool: PipelineAgentTool): AgentTool<TSchema, unknown> {
  return {
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
    // 用 Type.Unsafe 包裹 JSON Schema，TypeBox 会透传给 LLM
    parameters: Type.Unsafe(tool.parameters),
    execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
      const result = await tool.execute(params as Record<string, unknown>);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
        details: result,
      };
    },
  };
}

// ============================================================================
// Message Converter
// ============================================================================

/**
 * AgentMessage[] → Message[] 转换器
 * 只保留 LLM 能理解的标准消息类型
 */
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((m): m is Message => {
    if (typeof m !== "object" || m === null) return false;
    const role = (m as { role?: string }).role;
    return role === "user" || role === "assistant" || role === "toolResult";
  });
}

// ============================================================================
// Agent Runner
// ============================================================================

/**
 * 创建 agent 循环运行器
 *
 * @example
 * ```typescript
 * const runner = createAgentRunner({ apiKey: 'xxx', defaultModel: 'glm-5', baseUrl: '...' })
 * const result = await runner.run(
 *   'You are a requirement analyst.',
 *   'Clarify the following requirements: ...',
 *   [recordRequirementTool, webSearchTool],
 * )
 * console.log(result.finalResponse)
 * ```
 */
export function createAgentRunner(config: ModelProviderConfig) {
  const model = createModelFromConfig(config);
  const apiKey = config.apiKey;

  return {
    /**
     * 执行一次完整的 agent 循环
     */
    async run(
      systemPrompt: string,
      userMessage: string,
      tools: PipelineAgentTool[],
      options?: AgentRunOptions,
    ): Promise<AgentLoopResult> {
      const agentTools = tools.map(adaptTool);
      const toolCallRecords: Array<{ name: string; args: unknown; result: unknown }> = [];

      // 包装工具以收集调用记录
      const trackedTools: AgentTool<TSchema, unknown>[] = agentTools.map((t) => ({
        ...t,
        execute: async (toolCallId, params, signal, onUpdate) => {
          const result = await t.execute(toolCallId, params, signal, onUpdate);
          toolCallRecords.push({
            name: t.name,
            args: params,
            result: result.details,
          });
          return result;
        },
      }));

      const context: AgentContext = {
        systemPrompt,
        messages: (options?.history ?? []).map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
          timestamp: Date.now(),
        })),
        tools: trackedTools,
      };

      const loopConfig: AgentLoopConfig = {
        model,
        convertToLlm,
        getApiKey: apiKey ? async () => apiKey : undefined,
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens,
      };

      const prompt: AgentMessage = {
        role: "user",
        content: userMessage,
        timestamp: Date.now(),
      };

      const eventStream = agentLoop([prompt], context, loopConfig, options?.signal, streamSimple);

      // 消费事件流，打印 agent 行为日志
      for await (const event of eventStream) {
        if (event.type === "agent_start") {
          console.log("[agent] 🚀 Agent loop started");
        } else if (event.type === "turn_start") {
          console.log("[agent] ── turn start ──");
        } else if (event.type === "tool_execution_start") {
          console.log(
            `[agent] 🔧 Tool call: ${event.toolName}(${JSON.stringify(event.args).slice(0, 200)})`,
          );
        } else if (event.type === "tool_execution_end") {
          const resultPreview =
            typeof event.result === "string"
              ? event.result.slice(0, 150)
              : JSON.stringify(event.result).slice(0, 150);
          console.log(
            `[agent]    ↳ ${event.toolName} ${event.isError ? "❌" : "✅"} → ${resultPreview}`,
          );
        } else if (event.type === "message_end") {
          const msg = event.message as AssistantMessage;
          if (msg.role === "assistant" && msg.content) {
            const textParts = msg.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("");
            if (textParts) {
              console.log(
                `[agent] 💬 Assistant: ${textParts.slice(0, 200)}${textParts.length > 200 ? "..." : ""}`,
              );
            }
          }
        } else if (event.type === "agent_end") {
          console.log("[agent] 🏁 Agent loop ended");
        }
      }

      // 获取最终消息
      const allMessages = await eventStream.result();

      // 提取最后一条 assistant 消息的文本内容
      const lastAssistant = [...allMessages]
        .reverse()
        .find(
          (m): m is AssistantMessage =>
            typeof m === "object" && m !== null && (m as { role?: string }).role === "assistant",
        );

      const finalResponse =
        lastAssistant?.content
          ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("") ?? "";

      return {
        messages: allMessages,
        finalResponse,
        toolCalls: toolCallRecords,
      };
    },
  };
}
