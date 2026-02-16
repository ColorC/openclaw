/**
 * 链式编排层测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createChainAGraph } from "./chain-a-development.js";
import { createChainBGraph } from "./chain-b-wiki.js";
import { createChainCGraph, runIterationCycle } from "./chain-c-iteration.js";
import { createChainContext, disposeChainContext, type ChainContext } from "./chain-context.js";
import {
  withStepHook,
  collectStepMetric,
  recordStepArtifact,
  collectFailure,
} from "./step-hook.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chain-test-"));
}

let dir: string;
let ctx: ChainContext;

beforeEach(() => {
  dir = tmpDir();
  ctx = createChainContext({
    dbPath: path.join(dir, "pm.db"),
    projectRoot: dir,
    projectName: "test-project",
    iterationDbDir: path.join(dir, "si"),
  });
});

afterEach(() => {
  disposeChainContext(ctx);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// ChainContext
// ============================================================================

describe("ChainContext", () => {
  it("creates and disposes without error", () => {
    expect(ctx.db).toBeDefined();
    expect(ctx.queue).toBeDefined();
    expect(ctx.qualityGate).toBeDefined();
    expect(ctx.compliance).toBeDefined();
    expect(ctx.symidGen).toBeDefined();
    expect(ctx.headerInjector).toBeDefined();
    expect(ctx.docManager).toBeDefined();
    expect(ctx.failureCollector).toBeDefined();
    expect(ctx.kpiCollector).toBeDefined();
    expect(ctx.lineageTracker).toBeDefined();
    expect(ctx.patchDb).toBeDefined();
    expect(ctx.argueManager).toBeDefined();
  });
});

// ============================================================================
// Step Hook
// ============================================================================

describe("step-hook", () => {
  it("wraps successful execution with KPI + lineage", async () => {
    const executor = async (state: { x: number }) => ({ x: state.x + 1 });
    const wrapped = withStepHook("test_node", executor, ctx, {
      workflowId: "wf-test",
      chainId: "A",
    });

    const result = await wrapped({ x: 5 });
    expect(result.x).toBe(6);

    // Verify KPI was collected
    const metrics = ctx.kpiCollector.queryMetrics({ workflowId: "wf-test" });
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    expect(metrics[0].kpiType).toBe("latency");
  });

  it("wraps failed execution with failure event", async () => {
    const executor = async () => {
      throw new Error("boom");
    };
    const wrapped = withStepHook("fail_node", executor, ctx, {
      workflowId: "wf-fail",
      chainId: "A",
    });

    await expect(wrapped({})).rejects.toThrow("boom");

    // Verify failure was collected
    const failures = ctx.failureCollector.queryByWorkflow("wf-fail");
    expect(failures).toHaveLength(1);
    expect(failures[0].errorMessage).toBe("boom");
  });

  it("collectStepMetric writes to KPI collector", () => {
    const id = collectStepMetric(ctx, "wf-1", "node-1", 150);
    expect(id).toBeDefined();
    const metrics = ctx.kpiCollector.queryMetrics({ workflowId: "wf-1" });
    expect(metrics[0].value).toBe(150);
  });

  it("recordStepArtifact writes to lineage tracker", () => {
    const id = recordStepArtifact(ctx, "wf-1", "node-1", { data: "test" });
    expect(id).toBeDefined();
    const artifact = ctx.lineageTracker.getArtifact(id);
    expect(artifact).toBeDefined();
    expect(artifact!.createdBy).toBe("node-1");
  });

  it("collectFailure writes to failure collector", () => {
    const id = collectFailure(
      ctx,
      "wf-1",
      "node-1",
      new Error("test error"),
      "execution_error",
      "high",
    );
    expect(id).toBeDefined();
    const failures = ctx.failureCollector.queryByWorkflow("wf-1");
    expect(failures[0].errorMessage).toBe("test error");
  });
});

// ============================================================================
// Chain A
// ============================================================================

describe("Chain A — Development", () => {
  it("compiles successfully", () => {
    const graph = createChainAGraph(ctx);
    expect(graph).toBeDefined();
  });

  it("runs full chain with stub overrides", async () => {
    const graph = createChainAGraph(ctx, {
      decompOverrides: {
        decompose: async () => ({
          subRequirements: [{ id: "sub-1", description: "Test sub", category: "feature" }],
          currentStep: "decompose",
        }),
        investScoring: async () => ({
          investScores: [
            {
              independent: 0.8,
              negotiable: 0.7,
              valuable: 0.9,
              estimable: 0.6,
              small: 0.7,
              testable: 0.8,
              total: 0.75,
            },
          ],
          currentStep: "invest_scoring",
        }),
      },
      architectureOverrides: {
        validateInput: async () => ({}),
        analyzeRequirement: async () => ({
          requirementAnalysis: {
            scale: "small",
            complexity: "low",
            domain: "test",
            keyEntities: [],
          },
        }),
        listFeatures: async () => ({
          userFacingFeatures: [
            { id: "f1", name: "Feature", description: "Test", type: "user_facing" as const },
          ],
        }),
        selectPattern: async () => ({ selectedPattern: "layered" }),
        designModules: async () => ({
          modules: [
            {
              id: "mod-1",
              name: "TestModule",
              description: "Test",
              responsibilities: ["test"],
              dependencies: [],
            },
          ],
        }),
        defineInterfaces: async () => ({ interfaces: [] }),
        designReview: async () => ({}),
        validateArchitecture: async () => ({ needsRefinement: false }),
        designFileStructure: async () => ({ fileStructure: {} }),
        generateOpenspec: async () => ({ openspecFiles: [] }),
        finalize: async () => ({ success: true }),
      },
      coderOverrides: {
        recursiveCoder: async (state) => ({
          iterationCount: state.iterationCount + 1,
          currentCode: "// test code",
          qualityScore: 0.9,
          qualityHistory: [...(state.qualityHistory ?? []), 0.9],
          validationResult: { passed: true, errors: [], warnings: [] },
        }),
      },
    });

    const result = await graph.invoke({
      requirementDescription: "实现测试功能",
      projectId: "test-proj",
    });

    expect(result.decomposedRequirements.length).toBeGreaterThan(0);
    expect(result.publishedTasks.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Chain B
// ============================================================================

describe("Chain B — Wiki", () => {
  it("compiles successfully", () => {
    const graph = createChainBGraph(ctx);
    expect(graph).toBeDefined();
  });

  it("runs B1 (new project) with stub overrides", async () => {
    const graph = createChainBGraph(ctx, {
      exploreOverrides: {
        checkCompletion: async () => ({ nextAction: "complete" as const }),
        decision: async () => ({
          pendingToolCalls: [{ tool: "list_files", args: { path: "." } }],
        }),
        executeTools: async () => ({
          toolResults: [{ tool: "list_files", result: "src/index.ts" }],
          pendingToolCalls: [],
        }),
        accumulateFindings: async (state) => ({
          findings: [
            ...(state.findings ?? []),
            {
              type: "tool_result",
              content: "Found index.ts",
              source: "src/index.ts",
              iteration: 1,
            },
          ],
          currentIteration: (state.currentIteration ?? 0) + 1,
        }),
      },
    });

    const result = await graph.invoke({
      projectPath: dir,
      projectName: "test-project",
      mode: "new_project",
      userInput: "Explore architecture",
      maxExplorationIterations: 1,
    });

    expect(result.success).toBe(true);
    expect(result.wikiPages.length).toBeGreaterThan(0);
    expect(result.summary).toContain("wiki pages");
  });

  it("runs B2 (existing project) route", async () => {
    const graph = createChainBGraph(ctx, {
      exploreOverrides: {
        checkCompletion: async () => ({ nextAction: "complete" as const }),
        accumulateFindings: async (state) => ({
          findings: [
            ...(state.findings ?? []),
            {
              type: "tool_result",
              content: "Updated file",
              source: "src/app.ts",
              iteration: 1,
            },
          ],
          currentIteration: (state.currentIteration ?? 0) + 1,
        }),
      },
    });

    const result = await graph.invoke({
      projectPath: dir,
      projectName: "test-project",
      mode: "existing_project",
      userInput: "Update wiki",
      maxExplorationIterations: 1,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain("incremental");
  });
});

// ============================================================================
// Chain C
// ============================================================================

describe("Chain C — Iteration", () => {
  it("compiles successfully", () => {
    const graph = createChainCGraph(ctx);
    expect(graph).toBeDefined();
  });

  it("runs with no failures (clean pass)", async () => {
    const result = await runIterationCycle(ctx, "A", "wf-clean");
    expect(result.success).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.suggestedPatches).toHaveLength(0);
    expect(result.feedback.adjustments).toHaveLength(0);
  });

  it("detects failures and generates patches", async () => {
    // Seed a failure
    ctx.failureCollector.collectFailure({
      failureId: "f-1",
      workflowId: "wf-broken",
      nodeId: "coder",
      failureType: "execution_error",
      severity: "high",
      errorMessage: "Code generation failed",
    });

    const result = await runIterationCycle(ctx, "A", "wf-broken");
    expect(result.failures).toHaveLength(1);
    expect(result.lineageGaps.length).toBeGreaterThan(0);
    expect(result.suggestedPatches.length).toBeGreaterThan(0);
    expect(result.feedback.adjustments.length).toBeGreaterThan(0);
  });

  it("detects KPI gaps against expectations", async () => {
    // Set expectation
    ctx.kpiCollector.setExpectation({
      expectationId: "exp-1",
      kpiType: "latency",
      targetValue: 100,
      operator: "<",
      description: "Under 100ms",
      level: "hard",
      flexibility: 0,
      active: true,
      createdAt: new Date().toISOString(),
    });
    // Seed a metric that violates expectation
    ctx.kpiCollector.collectMetric({
      metricId: "m-1",
      kpiType: "latency",
      value: 500,
      unit: "ms",
      workflowId: "wf-slow",
      nodeId: "coder",
      timestamp: new Date().toISOString(),
      tags: {},
    });

    const result = await runIterationCycle(ctx, "A", "wf-slow");
    expect(result.lineageGaps.some((g) => g.includes("KPI gap"))).toBe(true);
    expect(result.suggestedPatches.length).toBeGreaterThan(0);
  });
});
