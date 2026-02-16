/**
 * 需求澄清工作流
 *
 * 使用 LLM + Tool 循环实现需求澄清，LLM 可调用多种研究工具收集信息。
 *
 * 节点:
 * - call_llm: 调用 LLM 决定工具使用或生成响应
 * - execute_tools: 执行 LLM 请求的工具调用
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/requirement_clarification_agent_workflow.py
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { RequirementClarificationState, ToolCall, ToolResult } from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const RequirementClarificationAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),
  pendingToolCalls: Annotation<ToolCall[] | undefined>({
    default: () => undefined,
  }),
  toolResults: Annotation<ToolResult[] | undefined>({
    default: () => undefined,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
  }),
  completed: Annotation<boolean>({
    default: () => false,
  }),
  error: Annotation<string | undefined>({
    default: () => undefined,
  }),
  iteration: Annotation<number>({
    default: () => 0,
  }),
  maxIteration: Annotation<number>({
    default: () => 50,
  }),
  sessionId: Annotation<string>({
    default: () => `session-${Date.now()}`,
  }),
  researchTaskIds: Annotation<string[]>({
    default: () => [],
  }),
  /** 序列化的 CollectedInfo JSON，跨轮次持久化 */
  collectedInfoJson: Annotation<string>({
    default: () => "{}",
  }),
  /** 对话历史（user/assistant 交替），传给 agentLoop 做多轮上下文 */
  conversationHistory: Annotation<Array<{ role: string; content: string }>>({
    default: () => [],
    reducer: (_prev, next) => next,
  }),
  /** 生成的 OpenSpec proposal.md 内容 */
  proposalDocument: Annotation<string | undefined>({
    default: () => undefined,
  }),
});

export type RequirementClarificationGraphState = typeof RequirementClarificationAnnotation.State;

// ============================================================================
// Nodes
// ============================================================================

/**
 * call_llm 节点
 *
 * 调用 LLM 决定是否使用工具或直接生成响应。
 * 实际 LLM 调用由外部注入的 executor 实现。
 */
export async function callLlmNode(
  state: RequirementClarificationGraphState,
  executor?: (
    state: RequirementClarificationGraphState,
  ) => Promise<Partial<RequirementClarificationGraphState>>,
): Promise<Partial<RequirementClarificationGraphState>> {
  if (executor) {
    return executor(state);
  }
  // 默认实现：标记完成（无 LLM 时直接结束）
  return {
    completed: true,
    response: "LLM executor not configured. Please provide an executor function.",
    iteration: state.iteration + 1,
  };
}

/**
 * execute_tools 节点
 *
 * 执行 LLM 请求的工具调用。
 * 实际工具执行由外部注入的 executor 实现。
 */
export async function executeToolsNode(
  state: RequirementClarificationGraphState,
  executor?: (
    state: RequirementClarificationGraphState,
  ) => Promise<Partial<RequirementClarificationGraphState>>,
): Promise<Partial<RequirementClarificationGraphState>> {
  if (!state.pendingToolCalls?.length) {
    return { pendingToolCalls: undefined };
  }

  if (executor) {
    return executor(state);
  }
  // 默认实现：模拟工具执行
  const results: ToolResult[] = state.pendingToolCalls.map((tc) => ({
    toolCallId: tc.id ?? `${tc.name}-${Date.now()}`,
    name: tc.name,
    result: { message: `Tool '${tc.name}' executed (stub)` },
  }));
  return {
    toolResults: results,
    pendingToolCalls: undefined,
    iteration: state.iteration + 1,
  };
}

// ============================================================================
// Routers
// ============================================================================

/** 判断是否继续执行工具 */
export function shouldContinue(state: RequirementClarificationGraphState): "execute_tools" | "end" {
  if (state.completed || state.error) {
    return "end";
  }
  if (state.pendingToolCalls?.length) {
    return "execute_tools";
  }
  return "end";
}

// ============================================================================
// Graph Builder
// ============================================================================

export interface RequirementClarificationConfig {
  llmExecutor?: (
    state: RequirementClarificationGraphState,
  ) => Promise<Partial<RequirementClarificationGraphState>>;
  toolExecutor?: (
    state: RequirementClarificationGraphState,
  ) => Promise<Partial<RequirementClarificationGraphState>>;
}

/**
 * 创建需求澄清工作流图
 */
export function createRequirementClarificationGraph(config: RequirementClarificationConfig = {}) {
  const workflow = new StateGraph(RequirementClarificationAnnotation)
    .addNode("call_llm", (state) => callLlmNode(state, config.llmExecutor))
    .addNode("execute_tools", (state) => executeToolsNode(state, config.toolExecutor))
    .addEdge(START, "call_llm")
    .addConditionalEdges("call_llm", shouldContinue, {
      execute_tools: "execute_tools",
      end: END,
    })
    .addEdge("execute_tools", "call_llm");

  return workflow.compile();
}

/**
 * 简化版：直接传入消息列表执行需求澄清
 */
export async function clarifyRequirements(
  messages: BaseMessage[],
  config: RequirementClarificationConfig = {},
): Promise<RequirementClarificationState> {
  const graph = createRequirementClarificationGraph(config);

  const initialState: Partial<RequirementClarificationGraphState> = {
    messages,
    iteration: 0,
    completed: false,
  };

  const result = await graph.invoke(initialState);

  return {
    messages: result.messages,
    pendingToolCalls: result.pendingToolCalls,
    toolResults: result.toolResults,
    response: result.response,
    completed: result.completed,
    error: result.error,
    iteration: result.iteration,
    maxIteration: result.maxIteration,
    sessionId: result.sessionId,
    researchTaskIds: result.researchTaskIds,
    collectedInfoJson: result.collectedInfoJson,
    conversationHistory: result.conversationHistory,
    proposalDocument: result.proposalDocument,
  };
}
