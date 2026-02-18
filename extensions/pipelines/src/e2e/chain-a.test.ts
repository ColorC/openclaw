/**
 * E2E 测试 — Chain A: 开发链路
 *
 * 完整流程: 需求描述 → 分解 → PM 导入 → 架构设计 → 任务生成
 *          → Coder 执行 → 质量门禁 → 合规检查 → KPI 采集 → 完成
 *
 * 验证:
 * 1. 需求被正确分解并写入 PM 数据库
 * 2. 架构设计产出 modules/interfaces
 * 3. 任务被发布到队列
 * 4. Coder 执行后 PM 状态更新
 * 5. 质量门禁和合规检查运行
 * 6. KPI 被采集
 * 7. step-hook 自动记录了 failure/lineage/metric
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createChainAGraph } from "../chains/chain-a-development.js";
import {
  createChainContext,
  disposeChainContext,
  type ChainContext,
} from "../chains/chain-context.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-chain-a-"));
}

describe("E2E: Chain A — 开发链路", () => {
  let dir: string;
  let ctx: ChainContext;

  beforeEach(() => {
    dir = tmpDir();
    ctx = createChainContext({
      dbPath: path.join(dir, "pm.db"),
      projectRoot: dir,
      projectName: "e2e-dev",
      iterationDbDir: path.join(dir, "si"),
      qualityThresholds: {
        invest: 0,
        smart: 0,
        coverage: 0,
        performance: 0,
        documentation: 0,
        contract: 0,
      },
    });
  });

  afterEach(() => {
    disposeChainContext(ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs the full development chain end-to-end", async () => {
    const graph = createChainAGraph(ctx, {
      // Stub decomposition: 产出 2 个子需求
      decompOverrides: {
        decompose: async () => ({
          subRequirements: [
            { id: "sub-auth", description: "实现用户认证模块", category: "feature" },
            { id: "sub-api", description: "实现 REST API 接口", category: "feature" },
          ],
          currentStep: "decompose",
        }),
        investScoring: async () => ({
          investScores: [
            {
              independent: 0.9,
              negotiable: 0.8,
              valuable: 0.9,
              estimable: 0.7,
              small: 0.6,
              testable: 0.8,
              total: 0.78,
            },
            {
              independent: 0.8,
              negotiable: 0.7,
              valuable: 0.8,
              estimable: 0.6,
              small: 0.7,
              testable: 0.9,
              total: 0.75,
            },
          ],
          currentStep: "invest_scoring",
        }),
      },
      // Stub architecture: 产出 2 个 modules + 1 个 interface
      architectureOverrides: {
        validateInput: async () => ({}),
        analyzeRequirement: async () => ({
          requirementAnalysis: {
            scale: "medium",
            complexity: "moderate",
            domain: "web",
            keyEntities: ["User", "API"],
          },
        }),
        listFeatures: async () => ({
          userFacingFeatures: [
            {
              id: "f-auth",
              name: "Authentication",
              description: "User auth",
              type: "user_facing" as const,
            },
            {
              id: "f-api",
              name: "REST API",
              description: "API endpoints",
              type: "user_facing" as const,
            },
          ],
        }),
        selectPattern: async () => ({ selectedPattern: "layered" }),
        designModules: async () => ({
          modules: [
            {
              id: "mod-auth",
              name: "AuthModule",
              description: "Authentication logic",
              responsibilities: ["Login", "Register", "Token management"],
              dependencies: [],
            },
            {
              id: "mod-api",
              name: "ApiModule",
              description: "REST API layer",
              responsibilities: ["Route handling", "Validation"],
              dependencies: ["mod-auth"],
            },
          ],
        }),
        defineInterfaces: async () => ({
          interfaces: [
            {
              id: "iface-auth",
              name: "IAuthService",
              type: "service" as const,
              methods: [
                {
                  name: "login",
                  input: "Credentials",
                  output: "Token",
                  description: "Authenticate user",
                },
              ],
            },
          ],
        }),
        designReview: async () => ({}),
        validateArchitecture: async () => ({ needsRefinement: false }),
        designFileStructure: async () => ({ fileStructure: { "src/auth/": {}, "src/api/": {} } }),
        generateOpenspec: async () => ({ openspecFiles: ["spec.md"] }),
        finalize: async () => ({ success: true }),
      },
      // Stub coder: 每个任务都成功
      coderOverrides: {
        recursiveCoder: async (state) => ({
          iterationCount: state.iterationCount + 1,
          currentCode: `// Implementation for task\nexport function handler() { return true }`,
          qualityScore: 0.88,
          qualityHistory: [...(state.qualityHistory ?? []), 0.88],
          validationResult: { passed: true, errors: [], warnings: [] },
        }),
      },
    });

    // ====== 执行 ======
    const result = await graph.invoke({
      requirementDescription: "实现一个用户认证系统，包含登录注册和 REST API",
      projectId: "proj-e2e",
      scenario: "new_project",
    });

    // ====== 验证 1: 需求分解 + PM 导入 ======
    expect(result.decomposedRequirements).toHaveLength(2);
    expect(result.parentRequirementId).toBeDefined();

    // 验证 PM 数据库中有父需求
    const parentReq = ctx.db.getRequirement(result.parentRequirementId!);
    expect(parentReq).toBeDefined();
    expect(parentReq!.description).toContain("用户认证");

    // 验证子需求也在 PM 数据库中
    const subAuth = ctx.db.getRequirement("sub-auth");
    expect(subAuth).toBeDefined();
    expect(subAuth!.parentId).toBe(result.parentRequirementId);

    // ====== 验证 2: 架构设计产出 ======
    expect(result.architectureModules).toHaveLength(2);
    expect(result.architectureInterfaces).toHaveLength(1);

    // ====== 验证 3: 任务发布到队列 ======
    expect(result.publishedTasks.length).toBeGreaterThanOrEqual(3); // 2 modules + 1 interface method

    // 验证任务在 PM 数据库中
    for (const task of result.publishedTasks) {
      const fetched = ctx.db.getRequirement(task.id);
      expect(fetched).toBeDefined();
    }

    // ====== 验证 4: Coder 执行结果 ======
    expect(result.coderResults).toHaveLength(result.publishedTasks.length);
    expect(result.coderResults.every((r) => r.success)).toBe(true);
    expect(result.coderResults.every((r) => r.qualityScore > 0.8)).toBe(true);

    // 验证 PM 状态已更新
    for (const cr of result.coderResults) {
      const req = ctx.db.getRequirement(cr.taskId);
      expect(req).toBeDefined();
      expect(req!.status).toBe("completed");
    }

    // ====== 验证 5: 质量门禁 ======
    expect(result.qualityResults).toHaveLength(result.publishedTasks.length);

    // ====== 验证 6: 合规检查 ======
    expect(result.complianceReport).toBeDefined();

    // ====== 验证 7: step-hook 自动采集 ======
    // KPI metrics 应该被采集（每个节点至少一个 latency metric）
    const allMetrics = ctx.kpiCollector.queryMetrics({ limit: 100 });
    expect(allMetrics.length).toBeGreaterThanOrEqual(8); // 8 nodes in chain

    // Lineage artifacts 应该被记录
    const lineageStats = ctx.lineageTracker.getStatistics();
    expect(lineageStats.total).toBeGreaterThanOrEqual(8);

    // ====== 验证 8: 最终状态 ======
    expect(result.success).toBe(true);
    expect(result.summary).toContain("requirements");
    expect(result.summary).toContain("tasks");
    expect(result.summary).toContain("passed");

    // 父需求应该被标记为 completed
    const finalParent = ctx.db.getRequirement(result.parentRequirementId!);
    expect(finalParent!.status).toBe("completed");
  });

  it("handles coder failure gracefully", async () => {
    const graph = createChainAGraph(ctx, {
      decompOverrides: {
        decompose: async () => ({
          subRequirements: [{ id: "sub-fail", description: "Will fail", category: "feature" }],
          currentStep: "decompose",
        }),
        investScoring: async () => ({
          investScores: [
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
            { id: "f1", name: "F", description: "F", type: "user_facing" as const },
          ],
        }),
        selectPattern: async () => ({ selectedPattern: "simple" }),
        designModules: async () => ({
          modules: [
            {
              id: "mod-fail",
              name: "FailModule",
              description: "Will fail",
              responsibilities: ["fail"],
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
      // Coder 失败
      coderOverrides: {
        recursiveCoder: async (state) => ({
          iterationCount: state.iterationCount + 1,
          currentCode: "",
          qualityScore: 0.2,
          qualityHistory: [...(state.qualityHistory ?? []), 0.2],
          validationResult: { passed: false, errors: ["Compilation failed"], warnings: [] },
        }),
        finalize: async (state) => ({
          success: false,
          fixSummary: undefined,
          implementationSummary: undefined,
        }),
      },
    });

    const result = await graph.invoke({
      requirementDescription: "一个会失败的需求",
      projectId: "proj-fail",
    });

    // Coder 失败
    expect(result.coderResults.every((r) => !r.success)).toBe(true);

    // 最终状态反映失败
    expect(result.success).toBe(false);

    // PM 数据库中任务状态为 failed
    for (const cr of result.coderResults) {
      const req = ctx.db.getRequirement(cr.taskId);
      expect(req!.status).toBe("failed");
    }

    // 父需求也应该是 failed
    const parent = ctx.db.getRequirement(result.parentRequirementId!);
    expect(parent!.status).toBe("failed");
  });

  it("records performance metrics in PM database", async () => {
    const graph = createChainAGraph(ctx, {
      decompOverrides: {
        decompose: async () => ({
          subRequirements: [{ id: "sub-perf", description: "Perf test", category: "task" }],
          currentStep: "decompose",
        }),
        investScoring: async () => ({
          investScores: [
            {
              independent: 0.8,
              negotiable: 0.8,
              valuable: 0.8,
              estimable: 0.8,
              small: 0.8,
              testable: 0.8,
              total: 0.8,
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
        listFeatures: async () => ({ userFacingFeatures: [] }),
        selectPattern: async () => ({ selectedPattern: "simple" }),
        designModules: async () => ({
          modules: [
            {
              id: "mod-perf",
              name: "PerfMod",
              description: "Perf",
              responsibilities: ["perf"],
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
          currentCode: "// code",
          qualityScore: 0.95,
          qualityHistory: [...(state.qualityHistory ?? []), 0.95],
          validationResult: { passed: true, errors: [], warnings: [] },
        }),
      },
    });

    await graph.invoke({ requirementDescription: "性能测试需求", projectId: "proj-perf" });

    // 验证 PM 数据库中有性能指标
    const metrics = ctx.db.getPerformanceMetrics("sub-perf");
    // coder-to-quality adapter 调用了 logPerformance
    // 但任务 ID 是 task-mod-mod-perf，不是 sub-perf
    // 检查所有已发布任务的性能指标
    const allReqs = ctx.db.getAllRequirements({});
    const taskReqs = allReqs.filter((r) => r.id.startsWith("task-"));
    expect(taskReqs.length).toBeGreaterThan(0);

    for (const task of taskReqs) {
      const perfMetrics = ctx.db.getPerformanceMetrics(task.id);
      expect(perfMetrics.length).toBeGreaterThanOrEqual(1);
      expect(perfMetrics[0].qualityScore).toBe(0.95);
    }
  });
});
