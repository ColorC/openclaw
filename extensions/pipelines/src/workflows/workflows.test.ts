/**
 * 工作流测试
 *
 * 测试三大生成工作流的图结构和默认节点行为。
 */

import { describe, expect, it } from "vitest";
import {
  createArchitectureDesignGraph,
  type ArchitectureDesignGraphState,
} from "./architecture-design.js";
import { createCoderGraph, type CoderGraphState } from "./coder.js";
import {
  createRequirementClarificationGraph,
  callLlmNode,
  executeToolsNode,
  shouldContinue,
  type RequirementClarificationGraphState,
} from "./requirement-clarification.js";

// ============================================================================
// Requirement Clarification
// ============================================================================

describe("RequirementClarification", () => {
  describe("shouldContinue router", () => {
    it("returns end when completed", () => {
      expect(shouldContinue({ completed: true } as RequirementClarificationGraphState)).toBe("end");
    });

    it("returns end when error", () => {
      expect(shouldContinue({ error: "fail" } as RequirementClarificationGraphState)).toBe("end");
    });

    it("returns execute_tools when pending tool calls", () => {
      expect(
        shouldContinue({
          pendingToolCalls: [{ name: "test", args: {} }],
        } as RequirementClarificationGraphState),
      ).toBe("execute_tools");
    });

    it("returns end when no pending tools", () => {
      expect(shouldContinue({ completed: false } as RequirementClarificationGraphState)).toBe(
        "end",
      );
    });
  });

  describe("callLlmNode", () => {
    it("marks completed without executor", async () => {
      const result = await callLlmNode({
        iteration: 0,
      } as RequirementClarificationGraphState);
      expect(result.completed).toBe(true);
      expect(result.iteration).toBe(1);
    });

    it("calls custom executor", async () => {
      const executor = async () => ({
        pendingToolCalls: [{ name: "research", args: { query: "test" } }],
        iteration: 1,
      });
      const result = await callLlmNode(
        { iteration: 0 } as RequirementClarificationGraphState,
        executor,
      );
      expect(result.pendingToolCalls).toHaveLength(1);
    });
  });

  describe("executeToolsNode", () => {
    it("returns empty when no pending tools", async () => {
      const result = await executeToolsNode({
        pendingToolCalls: [],
      } as unknown as RequirementClarificationGraphState);
      expect(result.pendingToolCalls).toBeUndefined();
    });

    it("executes stub tools", async () => {
      const result = await executeToolsNode({
        pendingToolCalls: [{ name: "search", args: {}, id: "tc-1" }],
        iteration: 0,
      } as RequirementClarificationGraphState);
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults![0].name).toBe("search");
      expect(result.pendingToolCalls).toBeUndefined();
    });
  });

  describe("graph compilation", () => {
    it("compiles without error", () => {
      const graph = createRequirementClarificationGraph();
      expect(graph).toBeDefined();
    });

    it("runs with default (no LLM)", async () => {
      const graph = createRequirementClarificationGraph();
      const result = await graph.invoke({
        messages: [],
        iteration: 0,
        completed: false,
      });
      expect(result.completed).toBe(true);
    });
  });
});

// ============================================================================
// Architecture Design
// ============================================================================

describe("ArchitectureDesign", () => {
  describe("graph compilation", () => {
    it("compiles without error", () => {
      const graph = createArchitectureDesignGraph();
      expect(graph).toBeDefined();
    });

    it("fails validation for empty requirement", async () => {
      const graph = createArchitectureDesignGraph();
      const result = await graph.invoke({ requirement: "" });
      expect(result.error).toContain("required");
      expect(result.success).toBe(false);
    });

    it("runs new_project scenario with defaults", async () => {
      const graph = createArchitectureDesignGraph();
      const result = await graph.invoke({
        requirement: "实现用户认证系统",
        scenario: "new_project",
      });
      expect(result.success).toBe(true);
      expect(result.requirementAnalysis).toBeDefined();
      expect(result.selectedPattern).toBeDefined();
    });

    it("fails modify_existing without projectPath", async () => {
      const graph = createArchitectureDesignGraph();
      const result = await graph.invoke({
        requirement: "添加认证",
        scenario: "modify_existing",
      });
      expect(result.error).toContain("Project path");
    });

    it("runs modify_existing with projectPath", async () => {
      const graph = createArchitectureDesignGraph();
      const result = await graph.invoke({
        requirement: "添加认证",
        scenario: "modify_existing",
        projectPath: "/tmp/project",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("custom node overrides", () => {
    it("uses custom analyzeRequirement", async () => {
      const graph = createArchitectureDesignGraph({
        analyzeRequirement: async () => ({
          requirementAnalysis: {
            scale: "large" as const,
            complexity: "high" as const,
            domain: "fintech",
            keyEntities: ["User", "Account", "Transaction"],
          },
        }),
      });
      const result = await graph.invoke({
        requirement: "金融交易系统",
        scenario: "new_project",
      });
      expect(result.requirementAnalysis?.scale).toBe("large");
      expect(result.requirementAnalysis?.domain).toBe("fintech");
    });
  });
});

// ============================================================================
// Coder
// ============================================================================

describe("Coder", () => {
  describe("graph compilation", () => {
    it("compiles without error", () => {
      const graph = createCoderGraph();
      expect(graph).toBeDefined();
    });

    it("runs code generation with defaults", async () => {
      const graph = createCoderGraph();
      const result = await graph.invoke({
        taskDescription: "实现排序算法",
        codeContext: { requirements: "Quick sort" },
      });
      expect(result.success).toBe(true);
      expect(result.implementationCode).toBeDefined();
      expect(result.iterationCount).toBe(1);
    });

    it("runs code fix with error reports", async () => {
      const graph = createCoderGraph();
      const result = await graph.invoke({
        taskDescription: "修复编译错误",
        codeContext: {
          skeleton: "function foo() { return 1 }",
          errorReports: [{ file: "foo.ts", message: "Type error", type: "compile" as const }],
        },
      });
      expect(result.fixedCode).toBeDefined();
    });
  });

  describe("argue mechanism", () => {
    it("handles quality argue (pauses)", async () => {
      const graph = createCoderGraph({
        recursiveCoder: async (state) => ({
          iterationCount: state.iterationCount + 1,
          currentCode: "low quality code",
          qualityScore: 0.3,
          qualityHistory: [...(state.qualityHistory ?? []), 0.3],
          validationResult: { passed: true, errors: [], warnings: [] },
        }),
      });
      const result = await graph.invoke({
        taskDescription: "Write something",
        codeContext: {},
        qualityThreshold: 0.7,
      });
      // Argue 未处理，工作流应该在 handle_argue 后结束（暂停）
      expect(result.argueResponse).toBeDefined();
      expect(result.argueResponse?.type).toBe("quality_below_threshold");
    });

    it("passes validation without argue", async () => {
      const graph = createCoderGraph({
        recursiveCoder: async (state) => ({
          iterationCount: 1,
          currentCode: "good code",
          qualityScore: 0.95,
          qualityHistory: [0.95],
          validationResult: { passed: true, errors: [], warnings: [] },
        }),
      });
      const result = await graph.invoke({
        taskDescription: "Quality code",
        codeContext: {},
        qualityThreshold: 0.7,
      });
      expect(result.success).toBe(true);
      expect(result.argueResponse).toBeUndefined();
    });
  });
});
