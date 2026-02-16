/**
 * E2E 测试 — Chain B: 整理链路
 *
 * B1 (new_project): explore → annotate → save_docs → organize → synthesize_wiki → END
 * B2 (existing_project): explore → update_headers → organize → finalize_existing → END
 *
 * 验证:
 * 1. 架构探索产出 findings
 * 2. 文件注解生成 SymID + 语义头
 * 3. 项目文档被保存
 * 4. Wiki 页面被合成
 * 5. step-hook 自动记录 KPI/lineage
 * 6. B2 增量模式正确路由
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createChainBGraph } from "../chains/chain-b-wiki.js";
import {
  createChainContext,
  disposeChainContext,
  type ChainContext,
} from "../chains/chain-context.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-chain-b-"));
}

describe("E2E: Chain B — 整理链路", () => {
  let dir: string;
  let ctx: ChainContext;

  beforeEach(() => {
    dir = tmpDir();
    ctx = createChainContext({
      dbPath: path.join(dir, "pm.db"),
      projectRoot: dir,
      projectName: "e2e-wiki",
      iterationDbDir: path.join(dir, "si"),
    });
  });

  afterEach(() => {
    disposeChainContext(ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("B1: new_project — full wiki generation chain", async () => {
    const graph = createChainBGraph(ctx, {
      // Stub exploration: 产出 3 个 findings（来自 2 个文件）
      exploreOverrides: {
        validateInput: async () => ({ currentIteration: 0, nextAction: "continue" }),
        decision: async () => ({
          pendingToolCalls: [{ tool: "list_files", args: { path: "." } }],
        }),
        executeTools: async () => ({
          toolResults: [{ tool: "list_files", result: "src/auth.ts, src/api.ts" }],
          pendingToolCalls: [],
        }),
        accumulateFindings: async (state) => ({
          findings: [
            {
              type: "file_structure",
              content: "Auth module handles login/register",
              source: "src/auth.ts",
              iteration: 0,
            },
            {
              type: "file_structure",
              content: "API module handles REST endpoints",
              source: "src/api.ts",
              iteration: 0,
            },
            {
              type: "dependency",
              content: "API depends on Auth for token validation",
              source: "src/api.ts",
              iteration: 0,
            },
          ],
          currentIteration: 1,
        }),
        checkCompletion: async () => ({ nextAction: "complete" as const }),
        finalize: async (state) => ({
          architectureSummary: "Project has 2 modules: Auth and API. API depends on Auth.",
          keyFindings: ["Auth module", "API module"],
          success: true,
          stats: { iterations: 1, toolCallsCount: 3, findingsCount: 3 },
        }),
      },
      // Use default doc-org (stub nodes handle it fine)
    });

    const result = await graph.invoke({
      projectPath: dir,
      projectName: "e2e-wiki",
      mode: "new_project",
      userInput: "探索项目架构并生成 Wiki",
      maxExplorationIterations: 1,
    });

    // ====== 验证 1: 探索产出 findings ======
    expect(result.explorationFindings).toHaveLength(3);
    expect(result.architectureSummary).toContain("Auth");
    expect(result.architectureSummary).toContain("API");

    // ====== 验证 2: 文件注解 ======
    expect(result.fileAnnotations).toHaveLength(2); // 2 unique files
    for (const ann of result.fileAnnotations) {
      expect(ann.symid).toBeTruthy();
      expect(ann.header).toContain("symid");
      expect(ann.findings.length).toBeGreaterThan(0);
    }

    // ====== 验证 3: Wiki 页面 ======
    expect(result.wikiPages.length).toBeGreaterThanOrEqual(2); // index + at least 1 type page
    const indexPage = result.wikiPages.find((p) => p.pageName === "index");
    expect(indexPage).toBeDefined();
    expect(indexPage!.content).toContain("e2e-wiki");

    // ====== 验证 4: 最终状态 ======
    expect(result.success).toBe(true);
    expect(result.summary).toContain("wiki pages");

    // ====== 验证 5: step-hook KPI 采集 ======
    const allMetrics = ctx.kpiCollector.queryMetrics({ limit: 100 });
    expect(allMetrics.length).toBeGreaterThanOrEqual(5); // 5 nodes in B1 path

    // ====== 验证 6: step-hook lineage 记录 ======
    const lineageStats = ctx.lineageTracker.getStatistics();
    expect(lineageStats.total).toBeGreaterThanOrEqual(5);
  });

  it("B2: existing_project — incremental update", async () => {
    const graph = createChainBGraph(ctx, {
      exploreOverrides: {
        validateInput: async () => ({ currentIteration: 0, nextAction: "continue" }),
        decision: async () => ({
          pendingToolCalls: [{ tool: "list_files", args: { path: "." } }],
        }),
        executeTools: async () => ({
          toolResults: [{ tool: "list_files", result: "src/updated.ts" }],
          pendingToolCalls: [],
        }),
        accumulateFindings: async () => ({
          findings: [
            {
              type: "file_structure",
              content: "Updated module",
              source: "src/updated.ts",
              iteration: 0,
            },
          ],
          currentIteration: 1,
        }),
        checkCompletion: async () => ({ nextAction: "complete" as const }),
        finalize: async (state) => ({
          architectureSummary: "Incremental update: 1 file changed",
          keyFindings: ["Updated module"],
          success: true,
          stats: { iterations: 1, toolCallsCount: 1, findingsCount: 1 },
        }),
      },
    });

    const result = await graph.invoke({
      projectPath: dir,
      projectName: "e2e-wiki",
      mode: "existing_project",
      userInput: "更新项目文档",
      maxExplorationIterations: 1,
    });

    // B2 路径: 不生成 wiki，只更新 headers
    expect(result.fileAnnotations).toHaveLength(1);
    expect(result.fileAnnotations[0].symid).toBeTruthy();

    // B2 不走 synthesize_wiki，所以 wikiPages 为空
    expect(result.wikiPages?.length ?? 0).toBe(0);

    // 但仍然成功
    expect(result.success).toBe(true);
    expect(result.summary).toContain("incremental");
  });

  it("handles exploration error gracefully", async () => {
    const graph = createChainBGraph(ctx, {
      exploreOverrides: {
        validateInput: async () => ({ error: "Project path not found" }),
        // 其余节点不会被调用（error 会跳到 finalize）
        finalize: async (state) => ({
          architectureSummary: "",
          success: false,
          stats: { iterations: 0, toolCallsCount: 0, findingsCount: 0 },
        }),
      },
    });

    const result = await graph.invoke({
      projectPath: "/nonexistent",
      projectName: "e2e-fail",
      mode: "new_project",
      userInput: "探索不存在的项目",
    });

    expect(result.error).toBeDefined();
  });
});
