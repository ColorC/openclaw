/**
 * Decomposition LLM Nodes — 测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ReqDecompGraphState } from "../maintenance/requirement-decomposition.js";
import { MockModelProvider, mockToolCallResponse } from "../llm/mock-model-provider.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createDecomposeNode, createInvestScoringNode } from "./decomposition-nodes.js";

// ============================================================================
// Helpers
// ============================================================================

function makeState(overrides: Partial<ReqDecompGraphState> = {}): ReqDecompGraphState {
  return {
    requirementDescription: "构建一个用户管理系统，支持注册、登录和权限管理",
    parentRequirementId: undefined,
    isValid: true,
    subRequirements: [],
    investScores: [],
    currentStep: "validate",
    error: undefined,
    requirementTree: {},
    ...overrides,
  };
}

// ============================================================================
// decompose node
// ============================================================================

describe("createDecomposeNode", () => {
  let promptRegistry: PromptRegistry;

  beforeEach(() => {
    promptRegistry = new PromptRegistry();
  });

  it("should decompose requirement via tool call", async () => {
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("decompose_requirement", {
        sub_requirements: [
          { id: "sub-auth", description: "用户注册与登录", category: "feature" },
          { id: "sub-rbac", description: "角色权限管理", category: "feature" },
          { id: "sub-api", description: "REST API 接口", category: "task" },
        ],
      }),
    ]);

    const node = createDecomposeNode({ modelProvider, promptRegistry });
    const result = await node(makeState());

    expect(result.error).toBeUndefined();
    expect(result.subRequirements).toHaveLength(3);
    expect(result.subRequirements![0].id).toBe("sub-auth");
    expect(result.subRequirements![1].category).toBe("feature");
    expect(result.subRequirements![2].id).toBe("sub-api");
    expect(result.currentStep).toBe("decompose");

    // 验证 LLM 调用参数
    expect(modelProvider.calls).toHaveLength(1);
    const call = modelProvider.calls[0];
    expect(call.tools).toHaveLength(1);
    expect(call.tools![0].name).toBe("decompose_requirement");
    expect(call.options?.modelRole).toBe("architect");
  });

  it("should return error when LLM does not call tool", async () => {
    const modelProvider = new MockModelProvider([
      { content: "I cannot decompose this requirement." },
    ]);

    const node = createDecomposeNode({ modelProvider, promptRegistry });
    const result = await node(makeState());

    expect(result.error).toBe("LLM did not call decompose_requirement tool");
    expect(result.subRequirements).toBeUndefined();
  });

  it("should return error when LLM returns empty sub-requirements", async () => {
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("decompose_requirement", { sub_requirements: [] }),
    ]);

    const node = createDecomposeNode({ modelProvider, promptRegistry });
    const result = await node(makeState());

    expect(result.error).toBe("LLM returned empty sub-requirements");
  });

  it("should use prompt template with correct variables", async () => {
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("decompose_requirement", {
        sub_requirements: [{ id: "sub-1", description: "Test", category: "task" }],
      }),
    ]);

    const node = createDecomposeNode({ modelProvider, promptRegistry });
    await node(makeState({ requirementDescription: "Build a chat app" }));

    const systemMsg = modelProvider.calls[0].messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("Requirement Decomposition Expert");
    expect(systemMsg.content).toContain("Build a chat app");
  });
});

// ============================================================================
// investScoring node
// ============================================================================

describe("createInvestScoringNode", () => {
  let promptRegistry: PromptRegistry;

  beforeEach(() => {
    promptRegistry = new PromptRegistry();
  });

  it("should score sub-requirements via tool call", async () => {
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("score_invest", {
        scores: [
          {
            independent: 0.9,
            negotiable: 0.8,
            valuable: 0.95,
            estimable: 0.7,
            small: 0.8,
            testable: 0.85,
            total: 0.83,
          },
          {
            independent: 0.7,
            negotiable: 0.6,
            valuable: 0.8,
            estimable: 0.5,
            small: 0.6,
            testable: 0.7,
            total: 0.65,
          },
        ],
      }),
    ]);

    const state = makeState({
      subRequirements: [
        { id: "sub-1", description: "用户注册", category: "feature" },
        { id: "sub-2", description: "权限管理", category: "feature" },
      ],
    });

    const node = createInvestScoringNode({ modelProvider, promptRegistry });
    const result = await node(state);

    expect(result.error).toBeUndefined();
    expect(result.investScores).toHaveLength(2);
    expect(result.investScores![0].independent).toBe(0.9);
    expect(result.investScores![1].total).toBe(0.65);
    expect(result.currentStep).toBe("invest_scoring");

    expect(modelProvider.calls[0].options?.modelRole).toBe("reviewer");
  });

  it("should fallback to default scores when LLM does not call tool", async () => {
    const modelProvider = new MockModelProvider([{ content: "Here are the scores..." }]);

    const state = makeState({
      subRequirements: [
        { id: "sub-1", description: "Test", category: "task" },
        { id: "sub-2", description: "Test2", category: "task" },
      ],
    });

    const node = createInvestScoringNode({ modelProvider, promptRegistry });
    const result = await node(state);

    // 降级而非报错
    expect(result.error).toBeUndefined();
    expect(result.investScores).toHaveLength(2);
    expect(result.investScores![0].total).toBe(0.5);
    expect(result.investScores![1].total).toBe(0.5);
  });

  it("should align scores count with sub-requirements count", async () => {
    // LLM 只返回 1 个分数，但有 3 个子需求
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("score_invest", {
        scores: [
          {
            independent: 0.9,
            negotiable: 0.8,
            valuable: 0.9,
            estimable: 0.7,
            small: 0.8,
            testable: 0.85,
            total: 0.83,
          },
        ],
      }),
    ]);

    const state = makeState({
      subRequirements: [
        { id: "sub-1", description: "A", category: "feature" },
        { id: "sub-2", description: "B", category: "task" },
        { id: "sub-3", description: "C", category: "task" },
      ],
    });

    const node = createInvestScoringNode({ modelProvider, promptRegistry });
    const result = await node(state);

    expect(result.investScores).toHaveLength(3);
    // 第一个用 LLM 返回的
    expect(result.investScores![0].independent).toBe(0.9);
    // 后两个用默认值补齐
    expect(result.investScores![1].total).toBe(0.5);
    expect(result.investScores![2].total).toBe(0.5);
  });

  it("should include sub-requirements JSON in prompt", async () => {
    const modelProvider = new MockModelProvider([
      mockToolCallResponse("score_invest", {
        scores: [
          {
            independent: 0.5,
            negotiable: 0.5,
            valuable: 0.5,
            estimable: 0.5,
            small: 0.5,
            testable: 0.5,
            total: 0.5,
          },
        ],
      }),
    ]);

    const state = makeState({
      subRequirements: [{ id: "sub-chat", description: "Chat feature", category: "feature" }],
    });

    const node = createInvestScoringNode({ modelProvider, promptRegistry });
    await node(state);

    const systemMsg = modelProvider.calls[0].messages[0];
    expect(systemMsg.content).toContain("sub-chat");
    expect(systemMsg.content).toContain("Chat feature");
  });
});
