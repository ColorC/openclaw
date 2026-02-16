/**
 * 需求分解工作流 (Requirement Decomposition)
 *
 * 将高层需求递归分解为可执行的子需求，并进行 INVEST 评分。
 *
 * 流程: START → validate → decompose → invest_scoring → finalize → END
 * 错误路径: validate 失败 → finalize（返回错误）
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/requirement_decomposition_workflow.py
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { RequirementDecompositionState, SubRequirement, InvestScoreResult } from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const RequirementDecompositionAnnotation = Annotation.Root({
  requirementDescription: Annotation<string>({ default: () => "" }),
  parentRequirementId: Annotation<string | undefined>({ default: () => undefined }),
  isValid: Annotation<boolean>({ default: () => false }),
  subRequirements: Annotation<SubRequirement[]>({ default: () => [] }),
  investScores: Annotation<InvestScoreResult[]>({ default: () => [] }),
  currentStep: Annotation<string>({ default: () => "init" }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  requirementTree: Annotation<Record<string, unknown>>({ default: () => ({}) }),
});

export type ReqDecompGraphState = typeof RequirementDecompositionAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

export type ReqDecompNodeExecutor = (
  state: ReqDecompGraphState,
) => Promise<Partial<ReqDecompGraphState>>;

export interface ReqDecompNodeOverrides {
  validate?: ReqDecompNodeExecutor;
  decompose?: ReqDecompNodeExecutor;
  investScoring?: ReqDecompNodeExecutor;
  finalize?: ReqDecompNodeExecutor;
}

// ============================================================================
// Default Node Implementations
// ============================================================================

const defaultNodes: Required<ReqDecompNodeOverrides> = {
  async validate(state) {
    const desc = state.requirementDescription?.trim();
    if (!desc) {
      return { isValid: false, error: "Requirement description is empty", currentStep: "validate" };
    }
    if (desc.length < 5) {
      return {
        isValid: false,
        error: "Requirement description too short",
        currentStep: "validate",
      };
    }
    return { isValid: true, currentStep: "validate" };
  },

  async decompose(state) {
    // Stub：规则化分解（关键词匹配）
    // 实际实现需要 LLM 驱动的智能分解
    const desc = state.requirementDescription;
    const keywords = ["用户", "管理", "数据", "展示", "接口", "API", "测试", "部署"];
    const matched = keywords.filter((kw) => desc.includes(kw));

    const subRequirements: SubRequirement[] =
      matched.length > 0
        ? matched.map((kw, i) => ({
            id: `sub-${i + 1}`,
            description: `${kw}相关子需求: ${desc}`,
            category: kw,
          }))
        : [
            {
              id: "sub-1",
              description: `实现: ${desc}`,
              category: "general",
            },
          ];

    return { subRequirements, currentStep: "decompose" };
  },

  async investScoring(state) {
    // INVEST 评分（启发式规则）
    const scores: InvestScoreResult[] = (state.subRequirements ?? []).map(() => {
      const independent = 0.8;
      const negotiable = 0.7;
      const valuable = 0.9;
      const estimable = 0.6;
      const small = 0.7;
      const testable = 0.8;
      const total = (independent + negotiable + valuable + estimable + small + testable) / 6;
      return { independent, negotiable, valuable, estimable, small, testable, total };
    });
    return { investScores: scores, currentStep: "invest_scoring" };
  },

  async finalize(state) {
    if (state.error) {
      return {
        requirementTree: { error: state.error },
        currentStep: "finalize",
      };
    }
    return {
      requirementTree: {
        root: state.requirementDescription,
        parentId: state.parentRequirementId ?? null,
        children: (state.subRequirements ?? []).map((sub, i) => ({
          ...sub,
          investScore: (state.investScores ?? [])[i],
        })),
        totalSubRequirements: (state.subRequirements ?? []).length,
      },
      currentStep: "finalize",
    };
  },
};

// ============================================================================
// Router
// ============================================================================

function shouldContinueAfterValidate(state: ReqDecompGraphState): "decompose" | "finalize" {
  return state.error ? "finalize" : "decompose";
}

// ============================================================================
// Graph Builder
// ============================================================================

export function createRequirementDecompositionGraph(overrides: ReqDecompNodeOverrides = {}) {
  const n = { ...defaultNodes, ...overrides };

  const workflow = new StateGraph(RequirementDecompositionAnnotation)
    .addNode("validate", n.validate)
    .addNode("decompose", n.decompose)
    .addNode("invest_scoring", n.investScoring)
    .addNode("finalize", n.finalize)
    .addEdge(START, "validate")
    .addConditionalEdges("validate", shouldContinueAfterValidate, {
      decompose: "decompose",
      finalize: "finalize",
    })
    .addEdge("decompose", "invest_scoring")
    .addEdge("invest_scoring", "finalize")
    .addEdge("finalize", END);

  return workflow.compile();
}
