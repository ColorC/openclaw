/**
 * Agent 框架集成适配器
 *
 * 完全复用 OpenClaw 的核心 agent 能力:
 * - agentLoop: 核心事件驱动的 agent 循环
 * - SessionManager: 会话持久化、历史管理
 * - SettingsManager: 压缩配置、context pruning
 * - estimateTokens: token 估算
 * - compact: 会话压缩
 *
 * 桥接 Pipeline 的 ModelProvider 与 @mariozechner/pi-agent-core。
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
import {
  SessionManager,
  SettingsManager,
  estimateTokens,
  shouldCompact,
  generateSummary,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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
  /** 会话 ID（用于跨轮次持久化） */
  sessionId: string;
  /** 会话文件路径 */
  sessionFile: string;
  /** 估算的 token 数量 */
  estimatedTokens?: number;
}

/**
 * Agent 运行选项
 */
export interface AgentRunOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 对话历史 — 预填充到 context，支持多轮交互 */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** 会话 ID（用于跨轮次持久化，不传则创建新会话） */
  sessionId?: string;
  /** 会话存储目录（默认为系统临时目录） */
  sessionDir?: string;
  /** 工作目录（用于 SettingsManager） */
  cwd?: string;
  /** 是否启用自动压缩（当接近 context window 时） */
  autoCompact?: boolean;
}

/**
 * Agent Runner 配置
 */
export interface AgentRunnerConfig extends ModelProviderConfig {
  /** 会话存储目录 */
  sessionDir?: string;
  /** 工作目录 */
  cwd?: string;
  /** 默认压缩配置 */
  compactionSettings?: Partial<CompactionSettings>;
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
// Session Manager Helper
// ============================================================================

/**
 * 获取或创建 SessionManager
 */
async function getOrCreateSessionManager(
  sessionDir: string,
  sessionId: string,
): Promise<{ sessionManager: SessionManager; sessionFile: string }> {
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);

  // 确保文件存在
  try {
    await fs.access(sessionFile);
  } catch {
    await fs.writeFile(sessionFile, "", "utf-8");
  }

  const sessionManager = SessionManager.open(sessionFile);
  return { sessionManager, sessionFile };
}

/**
 * 估算消息列表的 token 数量
 */
function estimateMessagesTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    try {
      total += estimateTokens(msg);
    } catch {
      // 如果估算失败，使用字符数作为后备
      const content = (msg as { content?: unknown }).content;
      if (typeof content === "string") {
        total += Math.ceil(content.length / 4);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && "text" in block) {
            total += Math.ceil(String((block as { text: string }).text).length / 4);
          }
        }
      }
    }
  }
  return total;
}

// ============================================================================
// Agent Runner (Full OpenClaw Integration)
// ============================================================================

/**
 * 创建 agent 运行器（完全复用 OpenClaw 核心能力）
 *
 * 使用 agentLoop + SessionManager + SettingsManager，
 * 自动获得:
 * - 会话持久化
 * - Context window 管理
 * - 手动/自动压缩（compaction）
 * - Token 估算
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
 * // 下一轮可以传入相同的 sessionId 继续对话
 * const result2 = await runner.run(
 *   'You are a requirement analyst.',
 *   'More details about the project...',
 *   tools,
 *   { sessionId: result.sessionId }
 * )
 * ```
 */
export function createAgentRunner(config: AgentRunnerConfig) {
  const model = createModelFromConfig(config);
  const apiKey = config.apiKey;
  const defaultSessionDir = config.sessionDir ?? path.join(os.tmpdir(), "pipelines-sessions");
  const cwd = config.cwd ?? process.cwd();

  return {
    /**
     * 执行一次完整的 agent 循环
     *
     * 使用 agentLoop + SessionManager 实现完整的会话管理
     */
    async run(
      systemPrompt: string,
      userMessage: string,
      tools: PipelineAgentTool[],
      options?: AgentRunOptions,
    ): Promise<AgentLoopResult> {
      const sessionId =
        options?.sessionId ?? `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionDir = options?.sessionDir ?? defaultSessionDir;
      const effectiveCwd = options?.cwd ?? cwd;

      const agentTools = tools.map(adaptTool);
      const toolCallRecords: Array<{ name: string; args: unknown; result: unknown }> = [];

      // 包装工具以收集调用记录
      const trackedTools: AgentTool<TSchema, unknown>[] = agentTools.map((t) => ({
        ...t,
        execute: async (toolCallId, params, signal, onUpdate) => {
          console.log(`[agent] 🔧 Tool call: ${t.name}(${JSON.stringify(params).slice(0, 200)})`);
          const result = await t.execute(toolCallId, params, signal, onUpdate);
          toolCallRecords.push({
            name: t.name,
            args: params,
            result: result.details,
          });
          const resultPreview =
            typeof result.details === "string"
              ? result.details.slice(0, 150)
              : JSON.stringify(result.details).slice(0, 150);
          console.log(`[agent]    ↳ ${t.name} ✅ → ${resultPreview}`);
          return result;
        },
      }));

      // 获取或创建 SessionManager
      const { sessionManager, sessionFile } = await getOrCreateSessionManager(
        sessionDir,
        sessionId,
      );

      // 创建 SettingsManager（用于压缩配置）
      const settingsManager = SettingsManager.create(effectiveCwd, effectiveCwd);

      // 从 session 加载历史消息
      const sessionContext = sessionManager.buildSessionContext();
      let contextMessages = sessionContext.messages;

      // 如果有 history 选项，转换为 AgentMessage 格式
      if (options?.history && options.history.length > 0) {
        const historyMessages: AgentMessage[] = options.history.map((h) => {
          if (h.role === "assistant") {
            return {
              role: "assistant" as const,
              content: [{ type: "text" as const, text: h.content }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop" as const,
              timestamp: Date.now(),
            };
          }
          return {
            role: "user" as const,
            content: h.content,
            timestamp: Date.now(),
          };
        });
        // 合并历史和 session 消息
        contextMessages = [...historyMessages, ...contextMessages];
      }

      // 构建 AgentContext
      const context: AgentContext = {
        systemPrompt,
        messages: contextMessages,
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

      console.log("[agent] 🚀 Agent loop started");

      // 执行 agent 循环
      const eventStream = agentLoop([prompt], context, loopConfig, options?.signal, streamSimple);

      // 消费事件流（may be aborted early via signal）
      let allMessages: AgentMessage[] = [];
      let aborted = false;
      try {
        for await (const event of eventStream) {
          if (event.type === "turn_start") {
            console.log("[agent] ── turn start ──");
          } else if (event.type === "message_end") {
            const msg = event.message as AssistantMessage;
            if (msg.role === "assistant" && msg.content) {
              const textParts = (Array.isArray(msg.content) ? msg.content : [])
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
        allMessages = await eventStream.result();
      } catch (err) {
        // Handle abort gracefully — still return collected tool calls
        if (options?.signal?.aborted) {
          console.log("[agent] 🛑 Agent loop aborted (task_complete signal)");
          aborted = true;
          try {
            allMessages = await eventStream.result();
          } catch {
            // result() may also throw on abort — use empty array
          }
        } else {
          throw err;
        }
      }

      // 估算 token 数量
      const estimatedTokens = estimateMessagesTokens(allMessages);

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

      // 持久化消息到 session（skip if aborted with no messages）
      if (allMessages.length > 0) {
        for (const msg of allMessages) {
          if (
            (msg as { role?: string }).role === "user" ||
            (msg as { role?: string }).role === "assistant"
          ) {
            sessionManager.appendMessage(msg as Message);
          }
        }
        console.log("[agent] 📝 Session saved");
      } else if (aborted) {
        console.log("[agent] 📝 Session save skipped (aborted)");
      }

      return {
        messages: allMessages,
        finalResponse,
        toolCalls: toolCallRecords,
        sessionId,
        sessionFile,
        estimatedTokens,
      };
    },

    /**
     * 压缩会话（调用 LLM 生成摘要）
     *
     * 当会话过长时，调用此方法进行压缩
     */
    async compact(
      sessionId: string,
      options?: { sessionDir?: string; customInstructions?: string },
    ): Promise<{
      success: boolean;
      tokensBefore?: number;
      tokensAfter?: number;
      summary?: string;
    }> {
      const sessionDir = options?.sessionDir ?? defaultSessionDir;
      const { sessionManager } = await getOrCreateSessionManager(sessionDir, sessionId);

      try {
        const sessionContext = sessionManager.buildSessionContext();
        const messages = sessionContext.messages;
        const tokensBefore = estimateMessagesTokens(messages);

        const settings = config.compactionSettings
          ? { ...DEFAULT_COMPACTION_SETTINGS, ...config.compactionSettings }
          : DEFAULT_COMPACTION_SETTINGS;

        if (!shouldCompact(tokensBefore, model.contextWindow, settings)) {
          console.log("[agent] ℹ️ Session does not need compaction yet");
          return { success: true, tokensBefore, tokensAfter: tokensBefore };
        }

        console.log(`[agent] 🗜️ Compacting session (tokens before: ${tokensBefore})`);

        const resolvedApiKey = apiKey ?? "";
        const summary = await generateSummary(
          messages,
          model as any,
          settings.reserveTokens,
          resolvedApiKey,
          undefined,
          options?.customInstructions,
        );

        // 持久化压缩摘要到 session
        const leafEntry = sessionManager.getLeafEntry();
        if (leafEntry) {
          sessionManager.appendCompaction(summary, leafEntry.id, tokensBefore);
        }

        const afterContext = sessionManager.buildSessionContext();
        const tokensAfter = estimateMessagesTokens(afterContext.messages);

        console.log(`[agent] ✅ Compaction complete (tokens after: ${tokensAfter})`);

        return {
          success: true,
          tokensBefore,
          tokensAfter,
          summary,
        };
      } catch (err) {
        console.error("[agent] Compaction failed:", err);
        return { success: false };
      }
    },

    /**
     * 获取会话中的消息列表
     */
    async getMessages(
      sessionId: string,
      options?: { sessionDir?: string },
    ): Promise<AgentMessage[]> {
      const sessionDir = options?.sessionDir ?? defaultSessionDir;
      const { sessionManager } = await getOrCreateSessionManager(sessionDir, sessionId);
      return sessionManager.buildSessionContext().messages;
    },

    /**
     * 获取会话的估算 token 数量
     */
    async getTokenCount(sessionId: string, options?: { sessionDir?: string }): Promise<number> {
      const sessionDir = options?.sessionDir ?? defaultSessionDir;
      const { sessionManager } = await getOrCreateSessionManager(sessionDir, sessionId);
      return estimateMessagesTokens(sessionManager.buildSessionContext().messages);
    },

    /**
     * 删除会话
     */
    async deleteSession(sessionId: string, options?: { sessionDir?: string }): Promise<void> {
      const sessionDir = options?.sessionDir ?? defaultSessionDir;
      const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
      try {
        await fs.unlink(sessionFile);
      } catch {
        // 忽略文件不存在的错误
      }
    },
  };
}
