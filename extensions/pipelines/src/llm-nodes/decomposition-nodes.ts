/**
 * Decomposition LLM Nodes
 *
 * 用真实 LLM 调用替换 requirement-decomposition 工作流中的 stub 节点:
 * - decompose: 调用 LLM 将需求分解为子需求
 * - investScoring: 调用 LLM 对子需求进行 INVEST 评分
 *
 * 两个节点都通过 chatWithTools() 获取结构化输出。
 */

import type { ModelProvider, ToolDefinition } from "../llm/types.js";
import type { ReqDecompGraphState } from "../maintenance/requirement-decomposition.js";
import type { SubRequirement, InvestScoreResult } from "../maintenance/states.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";

// ============================================================================
// Tool Schemas
// ============================================================================

const decomposeRequirementTool: ToolDefinition = {
  name: "decompose_requirement",
  description: "Return the structured decomposition of a requirement into sub-requirements",
  parameters: {
    type: "object",
    properties: {
      sub_requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique ID, e.g. sub-auth, sub-api" },
            description: { type: "string", description: "Clear, concise description" },
            category: {
              type: "string",
              enum: ["feature", "task", "bug", "improvement", "infrastructure"],
            },
          },
          required: ["id", "description", "category"],
        },
        minItems: 1,
        maxItems: 8,
      },
    },
    required: ["sub_requirements"],
  },
};

const scoreInvestTool: ToolDefinition = {
  name: "score_invest",
  description: "Return INVEST scores for each sub-requirement",
  parameters: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            independent: { type: "number", minimum: 0, maximum: 1 },
            negotiable: { type: "number", minimum: 0, maximum: 1 },
            valuable: { type: "number", minimum: 0, maximum: 1 },
            estimable: { type: "number", minimum: 0, maximum: 1 },
            small: { type: "number", minimum: 0, maximum: 1 },
            testable: { type: "number", minimum: 0, maximum: 1 },
            total: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "independent",
            "negotiable",
            "valuable",
            "estimable",
            "small",
            "testable",
            "total",
          ],
        },
      },
    },
    required: ["scores"],
  },
};

// ============================================================================
// Node Factories
// ============================================================================

export interface DecompositionNodeDeps {
  modelProvider: ModelProvider;
  promptRegistry: PromptRegistry;
}

/**
 * 创建 LLM 驱动的 decompose 节点
 *
 * 替换 requirement-decomposition.ts 中的 stub decompose 节点。
 * 通过 chatWithTools 调用 LLM，用 decompose_requirement tool 获取结构化子需求。
 */
export function createDecomposeNode(deps: DecompositionNodeDeps) {
  return async (state: ReqDecompGraphState): Promise<Partial<ReqDecompGraphState>> => {
    const { modelProvider, promptRegistry } = deps;

    const messages = promptRegistry.buildMessages(
      "decomposition/decompose",
      { requirement_description: state.requirementDescription },
      state.requirementDescription,
    );

    const response = await modelProvider.chatWithTools(messages, [decomposeRequirementTool], {
      modelRole: "architect",
      temperature: 0.3,
    });

    // 从 tool call 中提取结果
    const toolCall = response.toolCalls?.find((tc) => tc.name === "decompose_requirement");
    if (!toolCall) {
      return {
        error: "LLM did not call decompose_requirement tool",
        currentStep: "decompose",
      };
    }

    const args = toolCall.arguments as {
      sub_requirements: Array<{ id: string; description: string; category: string }>;
    };
    const subRequirements: SubRequirement[] = (args.sub_requirements ?? []).map((sr) => ({
      id: sr.id,
      description: sr.description,
      category: sr.category,
    }));

    if (subRequirements.length === 0) {
      return {
        error: "LLM returned empty sub-requirements",
        currentStep: "decompose",
      };
    }

    return { subRequirements, currentStep: "decompose" };
  };
}

/**
 * 创建 LLM 驱动的 investScoring 节点
 *
 * 替换 requirement-decomposition.ts 中的 stub investScoring 节点。
 * 通过 chatWithTools 调用 LLM，用 score_invest tool 获取 INVEST 评分。
 */
export function createInvestScoringNode(deps: DecompositionNodeDeps) {
  return async (state: ReqDecompGraphState): Promise<Partial<ReqDecompGraphState>> => {
    const { modelProvider, promptRegistry } = deps;

    const subReqJson = JSON.stringify(
      state.subRequirements.map((sr) => ({
        id: sr.id,
        description: sr.description,
        category: sr.category,
      })),
      null,
      2,
    );

    const messages = promptRegistry.buildMessages(
      "decomposition/invest-scoring",
      { sub_requirements_json: subReqJson },
      `Score the following ${state.subRequirements.length} sub-requirements using INVEST criteria.`,
    );

    const response = await modelProvider.chatWithTools(messages, [scoreInvestTool], {
      modelRole: "reviewer",
      temperature: 0.2,
    });

    const toolCall = response.toolCalls?.find((tc) => tc.name === "score_invest");
    if (!toolCall) {
      // 降级：返回默认分数而不是报错，保证流程不中断
      const defaultScores: InvestScoreResult[] = state.subRequirements.map(() => ({
        independent: 0.5,
        negotiable: 0.5,
        valuable: 0.5,
        estimable: 0.5,
        small: 0.5,
        testable: 0.5,
        total: 0.5,
      }));
      return { investScores: defaultScores, currentStep: "invest_scoring" };
    }

    const args = toolCall.arguments as { scores: InvestScoreResult[] };
    const scores = args.scores ?? [];

    // 如果 LLM 返回的分数数量不匹配，补齐或截断
    const aligned: InvestScoreResult[] = state.subRequirements.map((_, i) => {
      if (i < scores.length) return scores[i];
      return {
        independent: 0.5,
        negotiable: 0.5,
        valuable: 0.5,
        estimable: 0.5,
        small: 0.5,
        testable: 0.5,
        total: 0.5,
      };
    });

    return { investScores: aligned, currentStep: "invest_scoring" };
  };
}
