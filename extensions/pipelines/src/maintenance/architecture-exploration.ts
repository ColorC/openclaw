/**
 * 架构探索工作流 (Architecture Exploration)
 *
 * 迭代式探索项目架构：LLM 决策工具调用 → 执行工具 → 累积发现 → 检查完成。
 *
 * 流程:
 * START → validate → decision ↔ execute_tools → accumulate → check_completion → finalize → END
 *                     ↑                                                    |
 *                     └──────── (continue) ────────────────────────────────┘
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/architectureexploration_workflow.py
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type {
  ArchitectureExplorationState,
  ExplorationFinding,
  ExplorationToolCall,
} from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const ArchitectureExplorationAnnotation = Annotation.Root({
  // 输入
  userInput: Annotation<string>({ default: () => "" }),
  context: Annotation<Record<string, unknown>>({ default: () => ({}) }),
  maxIterations: Annotation<number>({ default: () => 10 }),
  projectPath: Annotation<string | undefined>({ default: () => undefined }),
  // 迭代
  currentIteration: Annotation<number>({ default: () => 0 }),
  nextAction: Annotation<"continue" | "complete">({ default: () => "continue" }),
  pendingToolCalls: Annotation<ExplorationToolCall[]>({ default: () => [] }),
  toolResults: Annotation<Array<Record<string, unknown>>>({ default: () => [] }),
  findings: Annotation<ExplorationFinding[]>({ default: () => [] }),
  keyFindings: Annotation<string[]>({ default: () => [] }),
  // 输出
  architectureSummary: Annotation<string>({ default: () => "" }),
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  stats: Annotation<ArchitectureExplorationState["stats"]>({
    default: () => ({ iterations: 0, toolCallsCount: 0, findingsCount: 0 }),
  }),
});

export type ArchExploreGraphState = typeof ArchitectureExplorationAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

export type ArchExploreNodeExecutor = (
  state: ArchExploreGraphState,
) => Promise<Partial<ArchExploreGraphState>>;

export interface ArchExploreNodeOverrides {
  validateInput?: ArchExploreNodeExecutor;
  decision?: ArchExploreNodeExecutor;
  executeTools?: ArchExploreNodeExecutor;
  accumulateFindings?: ArchExploreNodeExecutor;
  checkCompletion?: ArchExploreNodeExecutor;
  finalize?: ArchExploreNodeExecutor;
}

// ============================================================================
// Default Node Implementations
// ============================================================================

const defaultNodes: Required<ArchExploreNodeOverrides> = {
  async validateInput(state) {
    if (!state.userInput?.trim()) {
      return { error: "User input is required", success: false };
    }
    return { currentIteration: 0, nextAction: "continue" };
  },

  async decision(state) {
    // Stub: LLM 决策下一步调用哪些工具
    return {
      pendingToolCalls: [{ tool: "list_files", args: { path: state.projectPath ?? "." } }],
    };
  },

  async executeTools(state) {
    // Stub: 执行工具调用
    const results = (state.pendingToolCalls ?? []).map((tc) => ({
      tool: tc.tool,
      args: tc.args,
      result: `[stub] ${tc.tool} result`,
    }));
    return { toolResults: results, pendingToolCalls: [] };
  },

  async accumulateFindings(state) {
    const newFindings: ExplorationFinding[] = (state.toolResults ?? []).map((r) => ({
      type: "tool_result",
      content: JSON.stringify(r),
      source: ((r as Record<string, unknown>).tool as string) ?? "unknown",
      iteration: state.currentIteration,
    }));
    return {
      findings: [...(state.findings ?? []), ...newFindings],
      currentIteration: state.currentIteration + 1,
    };
  },

  async checkCompletion(state) {
    const maxReached = state.currentIteration >= state.maxIterations;
    return {
      nextAction: maxReached ? "complete" : "continue",
    };
  },

  async finalize(state) {
    const allFindings = state.findings ?? [];
    return {
      architectureSummary: `Architecture exploration completed with ${allFindings.length} findings`,
      keyFindings: allFindings.slice(0, 5).map((f) => f.content),
      success: !state.error,
      stats: {
        iterations: state.currentIteration,
        toolCallsCount: allFindings.length,
        findingsCount: allFindings.length,
      },
    };
  },
};

// ============================================================================
// Router
// ============================================================================

function shouldContinueExploration(state: ArchExploreGraphState): "continue" | "finalize" {
  if (state.error) return "finalize";
  return state.nextAction === "complete" ? "finalize" : "continue";
}

// ============================================================================
// Graph Builder
// ============================================================================

export function createArchitectureExplorationGraph(overrides: ArchExploreNodeOverrides = {}) {
  const n = { ...defaultNodes, ...overrides };

  const workflow = new StateGraph(ArchitectureExplorationAnnotation)
    .addNode("validate_input", n.validateInput)
    .addNode("decision", n.decision)
    .addNode("execute_tools", n.executeTools)
    .addNode("accumulate_findings", n.accumulateFindings)
    .addNode("check_completion", n.checkCompletion)
    .addNode("finalize", n.finalize)
    .addEdge(START, "validate_input")
    .addEdge("validate_input", "decision")
    .addEdge("decision", "execute_tools")
    .addEdge("execute_tools", "accumulate_findings")
    .addEdge("accumulate_findings", "check_completion")
    .addConditionalEdges("check_completion", shouldContinueExploration, {
      continue: "decision",
      finalize: "finalize",
    })
    .addEdge("finalize", END);

  return workflow.compile();
}

/** 便捷函数 */
export async function exploreArchitecture(
  userInput: string,
  opts: { maxIterations?: number; projectPath?: string; context?: Record<string, unknown> } = {},
) {
  const graph = createArchitectureExplorationGraph();
  return graph.invoke({
    userInput,
    maxIterations: opts.maxIterations ?? 10,
    projectPath: opts.projectPath,
    context: opts.context ?? {},
  });
}
