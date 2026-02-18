/**
 * Coder 工作流 — 代码生成/修复
 *
 * 节点:
 * - prepare: 准备 Agent 任务（判断 generate 还是 fix）
 * - recursive_coder: 递归代码生成/修复（Agent 执行）
 * - handle_argue: 处理质量不达标/验证失败的 argue
 * - finalize: 提取最终代码和统计
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/coder_workflow.py
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { CoderState, CodeContext, ValidationResult, QualityIndicators } from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const CoderAnnotation = Annotation.Root({
  // 输入
  taskDescription: Annotation<string>({ default: () => "" }),
  codeContext: Annotation<CodeContext>({ default: () => ({}) }),
  maxIterations: Annotation<number>({ default: () => 10 }),
  qualityThreshold: Annotation<number>({ default: () => 0.7 }),
  // 迭代
  iterationCount: Annotation<number>({ default: () => 0 }),
  currentCode: Annotation<string | undefined>({ default: () => undefined }),
  validationResult: Annotation<ValidationResult | undefined>({ default: () => undefined }),
  qualityIndicators: Annotation<QualityIndicators | undefined>({ default: () => undefined }),
  qualityScore: Annotation<number>({ default: () => 0 }),
  qualityHistory: Annotation<number[]>({ default: () => [] }),
  retryReason: Annotation<string | undefined>({ default: () => undefined }),
  toolsUsed: Annotation<string[]>({ default: () => [] }),
  // 输出
  implementationSummary: Annotation<string | undefined>({ default: () => undefined }),
  fixSummary: Annotation<string | undefined>({ default: () => undefined }),
  modifiedFiles: Annotation<string[]>({ default: () => [] }),
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  // Argue
  argueResponse: Annotation<CoderState["argueResponse"]>({ default: () => undefined }),
  argueHandled: Annotation<boolean>({ default: () => false }),
});

export type CoderGraphState = typeof CoderAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

export type CoderNodeExecutor = (state: CoderGraphState) => Promise<Partial<CoderGraphState>>;

export interface CoderNodeOverrides {
  prepare?: CoderNodeExecutor;
  recursiveCoder?: CoderNodeExecutor;
  handleArgue?: CoderNodeExecutor;
  finalize?: CoderNodeExecutor;
}

// ============================================================================
// Default Node Implementations
// ============================================================================

const defaultNodes: Required<CoderNodeOverrides> = {
  async prepare(state) {
    const hasErrors = state.codeContext.errorReports?.length;
    return {
      iterationCount: 0,
      retryReason: undefined,
      toolsUsed: [],
      // 判断 generate 还是 fix
      currentCode: hasErrors ? (state.codeContext.skeleton ?? "") : undefined,
    };
  },

  async recursiveCoder(state) {
    // Stub: 实际实现需要调用 CoderAgent（LLM）
    return {
      iterationCount: state.iterationCount + 1,
      currentCode: state.currentCode ?? "// Generated code stub",
      qualityScore: 0.85,
      qualityHistory: [...(state.qualityHistory ?? []), 0.85],
      validationResult: { passed: true, errors: [], warnings: [] },
    };
  },

  async handleArgue(state) {
    if (state.validationResult && !state.validationResult.passed) {
      return {
        argueResponse: {
          type: "validation_failed" as const,
          details: state.validationResult.errors.join("; "),
          suggestedAction: "retry_with_fixes",
        },
        argueHandled: false,
      };
    }
    if (state.qualityScore < state.qualityThreshold) {
      return {
        argueResponse: {
          type: "quality_below_threshold" as const,
          details: `Quality ${state.qualityScore} < threshold ${state.qualityThreshold}`,
          suggestedAction: "retry_with_improvements",
        },
        argueHandled: false,
      };
    }
    // 无 argue — 继续 finalize
    return { argueHandled: false };
  },

  async finalize(state) {
    const hasErrors = state.codeContext.errorReports?.length;
    return {
      implementationSummary: !hasErrors ? state.currentCode : undefined,
      fixSummary: hasErrors ? state.currentCode : undefined,
      success: state.validationResult?.passed ?? false,
    };
  },
};

// ============================================================================
// Router
// ============================================================================

function shouldHandleArgue(state: CoderGraphState): "finalize" | "end" {
  // 如果有 argue 需要人工干预，暂停工作流
  if (state.argueResponse && !state.argueHandled) {
    // 有未处理的 argue → 暂停等待人工
    return "end";
  }
  return "finalize";
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * 创建 Coder 工作流图
 */
export function createCoderGraph(overrides: CoderNodeOverrides = {}) {
  const n = { ...defaultNodes, ...overrides };

  const workflow = new StateGraph(CoderAnnotation)
    .addNode("prepare", n.prepare)
    .addNode("recursive_coder", n.recursiveCoder)
    .addNode("handle_argue", n.handleArgue)
    .addNode("finalize", n.finalize)
    .addEdge(START, "prepare")
    .addEdge("prepare", "recursive_coder")
    .addEdge("recursive_coder", "handle_argue")
    .addConditionalEdges("handle_argue", shouldHandleArgue, {
      finalize: "finalize",
      end: END,
    })
    .addEdge("finalize", END);

  return workflow.compile();
}
