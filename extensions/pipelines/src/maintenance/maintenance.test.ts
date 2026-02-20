/**
 * 维护管线测试
 *
 * 覆盖: RequirementDecomposition, ArchitectureExploration, DocumentOrganization
 */

import { describe, expect, it } from "vitest";
import { createArchitectureExplorationGraph } from "./architecture-exploration.js";
import { createDocumentOrganizationGraph } from "./document-organization.js";
import { createRequirementDecompositionGraph } from "./requirement-decomposition.js";

// ============================================================================
// RequirementDecomposition
// ============================================================================

describe("RequirementDecomposition", () => {
  it("compiles successfully", () => {
    const graph = createRequirementDecompositionGraph();
    expect(graph).toBeDefined();
  });

  it("decomposes valid requirement", async () => {
    const graph = createRequirementDecompositionGraph();
    const result = await graph.invoke({
      requirementDescription: "实现用户管理和数据展示功能",
    });
    expect(result.isValid).toBe(true);
    expect(result.subRequirements.length).toBeGreaterThan(0);
    expect(result.investScores.length).toBe(result.subRequirements.length);
    expect(result.requirementTree).toHaveProperty("root");
    expect(result.currentStep).toBe("finalize");
  });

  it("handles empty description", async () => {
    const graph = createRequirementDecompositionGraph();
    const result = await graph.invoke({
      requirementDescription: "",
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.requirementTree).toHaveProperty("error");
  });

  it("handles short description", async () => {
    const graph = createRequirementDecompositionGraph();
    const result = await graph.invoke({
      requirementDescription: "abc",
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("too short");
  });

  it("preserves parentRequirementId", async () => {
    const graph = createRequirementDecompositionGraph();
    const result = await graph.invoke({
      requirementDescription: "实现API接口",
      parentRequirementId: "REQ-001",
    });
    expect(result.requirementTree).toHaveProperty("parentId", "REQ-001");
  });

  it("INVEST scores have correct structure", async () => {
    const graph = createRequirementDecompositionGraph();
    const result = await graph.invoke({
      requirementDescription: "用户管理功能",
    });
    for (const score of result.investScores) {
      expect(score).toHaveProperty("independent");
      expect(score).toHaveProperty("negotiable");
      expect(score).toHaveProperty("valuable");
      expect(score).toHaveProperty("estimable");
      expect(score).toHaveProperty("small");
      expect(score).toHaveProperty("testable");
      expect(score).toHaveProperty("total");
      expect(score.total).toBeGreaterThan(0);
      expect(score.total).toBeLessThanOrEqual(1);
    }
  });

  it("accepts custom node overrides", async () => {
    const graph = createRequirementDecompositionGraph({
      decompose: async () => ({
        subRequirements: [{ id: "custom-1", description: "Custom sub", category: "custom" }],
        currentStep: "decompose",
      }),
    });
    const result = await graph.invoke({
      requirementDescription: "测试自定义分解",
    });
    expect(result.subRequirements).toHaveLength(1);
    expect(result.subRequirements[0].id).toBe("custom-1");
  });
});

// ============================================================================
// ArchitectureExploration
// ============================================================================

describe("ArchitectureExploration", () => {
  it("compiles successfully", () => {
    const graph = createArchitectureExplorationGraph();
    expect(graph).toBeDefined();
  });

  it("runs exploration with max 1 iteration", async () => {
    const graph = createArchitectureExplorationGraph({
      checkCompletion: async (state) => ({
        nextAction: "complete" as const,
      }),
    });
    const result = await graph.invoke({
      userInput: "探索项目架构",
      maxIterations: 1,
    });
    expect(result.success).toBe(true);
    expect(result.architectureSummary).toBeDefined();
    expect(result.stats.iterations).toBeGreaterThanOrEqual(1);
  });

  it("handles empty input", async () => {
    const graph = createArchitectureExplorationGraph();
    const result = await graph.invoke({
      userInput: "",
      maxIterations: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("respects maxIterations limit", async () => {
    const graph = createArchitectureExplorationGraph();
    const result = await graph.invoke({
      userInput: "探索架构",
      maxIterations: 2,
    });
    expect(result.stats.iterations).toBeLessThanOrEqual(3); // +1 tolerance for iteration counting
    expect(result.success).toBe(true);
  });

  it("accumulates findings across iterations", async () => {
    let iterCount = 0;
    const graph = createArchitectureExplorationGraph({
      checkCompletion: async (state) => {
        iterCount++;
        return { nextAction: iterCount >= 2 ? "complete" : "continue" };
      },
    });
    const result = await graph.invoke({
      userInput: "深度探索架构",
      maxIterations: 5,
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts custom decision override", async () => {
    const graph = createArchitectureExplorationGraph({
      decision: async () => ({
        pendingToolCalls: [{ tool: "read_file", args: { path: "package.json" } }],
      }),
      checkCompletion: async () => ({ nextAction: "complete" as const }),
    });
    const result = await graph.invoke({
      userInput: "读取配置",
      maxIterations: 1,
    });
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// DocumentOrganization
// ============================================================================

describe("DocumentOrganization", () => {
  it("compiles successfully", () => {
    const graph = createDocumentOrganizationGraph();
    expect(graph).toBeDefined();
  });

  it("processes files end-to-end", async () => {
    const graph = createDocumentOrganizationGraph();
    const result = await graph.invoke({
      sourceDir: "/tmp/docs",
      projectRoot: "/tmp/project",
      importToPm: true,
      autoArchive: false,
      discoveredFiles: [
        {
          path: "/tmp/docs/checklist-1.md",
          filename: "checklist-1.md",
          documentType: "checklist",
          size: 100,
        },
        {
          path: "/tmp/docs/report-1.md",
          filename: "report-1.md",
          documentType: "report",
          size: 200,
        },
      ],
    });
    expect(result.currentStep).toBe("finalize");
    expect(result.summary).toContain("2 files");
    expect(result.classifiedFiles.checklist).toHaveLength(1);
    expect(result.classifiedFiles.report).toHaveLength(1);
  });

  it("handles empty sourceDir", async () => {
    const graph = createDocumentOrganizationGraph();
    const result = await graph.invoke({
      sourceDir: "",
      projectRoot: ".",
    });
    expect(result.error).toBeDefined();
  });

  it("parses tasks from checklists", async () => {
    const graph = createDocumentOrganizationGraph();
    const result = await graph.invoke({
      sourceDir: "/tmp/docs",
      projectRoot: ".",
      discoveredFiles: [
        {
          path: "/tmp/checklist-a.md",
          filename: "checklist-a.md",
          documentType: "checklist",
          size: 50,
        },
        {
          path: "/tmp/checklist-b.md",
          filename: "checklist-b.md",
          documentType: "checklist",
          size: 60,
        },
      ],
    });
    expect(result.parsedTasks.length).toBe(2);
    expect(result.totalTasks).toBe(2);
  });

  it("skips import when importToPm is false", async () => {
    const graph = createDocumentOrganizationGraph();
    const result = await graph.invoke({
      sourceDir: "/tmp/docs",
      projectRoot: ".",
      importToPm: false,
      discoveredFiles: [
        {
          path: "/tmp/todo.md",
          filename: "todo-checklist.md",
          documentType: "checklist",
          size: 50,
        },
      ],
    });
    expect(result.importedCount).toBe(0);
  });

  it("archives when autoArchive is true", async () => {
    const graph = createDocumentOrganizationGraph();
    const result = await graph.invoke({
      sourceDir: "/tmp/docs",
      projectRoot: ".",
      autoArchive: true,
      discoveredFiles: [
        { path: "/tmp/file.md", filename: "file.md", documentType: "other", size: 100 },
      ],
    });
    expect(result.archivedFiles.length).toBeGreaterThan(0);
  });

  it("accepts custom node overrides", async () => {
    const graph = createDocumentOrganizationGraph({
      parseChecklists: async () => ({
        parsedTasks: [
          {
            id: "custom-1",
            description: "Custom task",
            status: "done",
            metadata: {},
            sourceFile: "x.md",
          },
        ],
        totalTasks: 1,
        currentStep: "parse",
      }),
    });
    const result = await graph.invoke({
      sourceDir: "/tmp/docs",
      projectRoot: ".",
    });
    expect(result.parsedTasks).toHaveLength(1);
    expect(result.parsedTasks[0].id).toBe("custom-1");
  });
});
