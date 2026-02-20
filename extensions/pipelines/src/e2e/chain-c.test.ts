/**
 * E2E 测试 — Chain C: 迭代链路
 *
 * 完整流程: collect_events → analyze_gaps → generate_patches → argue_review → emit_feedback → END
 *
 * 验证:
 * 1. 从 failure-collector / kpi-collector 采集事件
 * 2. 差距分析识别未解决的失败和 KPI 偏差
 * 3. 补丁生成并存入 patch-database
 * 4. Argue 审核高优先级补丁
 * 5. 反馈动作正确生成 (retry_step / apply_patch / escalate)
 * 6. 无差距时链路正常完成
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runIterationCycle } from "../chains/chain-c-iteration.js";
import {
  createChainContext,
  disposeChainContext,
  type ChainContext,
} from "../chains/chain-context.js";
import { ArgueManager } from "../self-iteration/argue-manager.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-chain-c-"));
}

describe("E2E: Chain C — 迭代链路", () => {
  let dir: string;
  let ctx: ChainContext;

  beforeEach(() => {
    dir = tmpDir();
    ctx = createChainContext({
      dbPath: path.join(dir, "pm.db"),
      projectRoot: dir,
      projectName: "e2e-iter",
      iterationDbDir: path.join(dir, "si"),
    });
  });

  afterEach(() => {
    disposeChainContext(ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects failures and generates patches with argue review", async () => {
    const workflowId = "wf-test-001";

    // 预置数据: 注入 2 个未解决的失败事件
    ctx.failureCollector.collectFailure({
      failureId: "fail-1",
      workflowId,
      nodeId: "execute_coder",
      failureType: "execution_error",
      severity: "high",
      errorMessage: "Compilation failed: missing import",
    });
    ctx.failureCollector.collectFailure({
      failureId: "fail-2",
      workflowId,
      nodeId: "evaluate_quality",
      failureType: "quality_gate",
      severity: "medium",
      errorMessage: "Quality score 0.3 < 0.7 threshold",
    });

    // 预置数据: 注入 KPI 指标 + 期望
    ctx.kpiCollector.collectMetric({
      metricId: "kpi-1",
      kpiType: "success_rate",
      value: 0.4,
      unit: "ratio",
      workflowId,
      nodeId: "execute_coder",
      timestamp: new Date().toISOString(),
      tags: {},
    });
    ctx.kpiCollector.setExpectation({
      expectationId: "exp-1",
      kpiType: "success_rate",
      targetValue: 0.8,
      operator: ">=",
      description: "Success rate should be >= 80%",
      level: "hard",
      flexibility: 0,
      active: true,
      createdAt: new Date().toISOString(),
    });

    // 配置 argue-manager: 接受所有 argue
    ctx.argueManager = new ArgueManager({
      evaluator: async (argue) => ({
        argueId: argue.argueId,
        accepted: true,
        feedback: "Auto-accepted for testing",
        reasoning: "Auto-accepted for testing",
        counterPoints: [],
        timestamp: new Date().toISOString(),
      }),
    });

    // ====== 执行 ======
    const result = await runIterationCycle(ctx, "A", workflowId);

    // ====== 验证 1: 失败事件被采集 ======
    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((f) => !f.resolved)).toBe(true);

    // ====== 验证 2: KPI 摘要 ======
    expect(Object.keys(result.kpiSummary).length).toBeGreaterThan(0);

    // ====== 验证 3: 差距分析 ======
    expect(result.lineageGaps.length).toBeGreaterThanOrEqual(2); // 2 failures + KPI gap
    expect(result.lineageGaps.some((g) => g.includes("unresolved failures"))).toBe(true);
    expect(result.lineageGaps.some((g) => g.includes("KPI gap"))).toBe(true);

    // ====== 验证 4: 补丁生成 ======
    expect(result.suggestedPatches.length).toBeGreaterThanOrEqual(2);
    // 补丁应该存入 patch-database
    for (const patch of result.suggestedPatches) {
      const stored = ctx.patchDb.getPatch(patch.patchId);
      expect(stored).toBeDefined();
    }

    // ====== 验证 5: Argue 审核 ======
    // 高优先级补丁 (priority <= 3) 应该有 argue 记录
    const highPriority = result.suggestedPatches.filter((p) => p.priority <= 3);
    expect(result.disputes.length).toBe(highPriority.length);
    // 所有 argue 都被接受
    expect(result.disputes.every((d) => d.response?.accepted)).toBe(true);

    // ====== 验证 6: 反馈动作 ======
    expect(result.feedback.targetChain).toBe("A");
    expect(result.feedback.adjustments.length).toBeGreaterThan(0);

    // 应该有 retry_step（来自未解决的失败）
    const retries = result.feedback.adjustments.filter((a) => a.type === "retry_step");
    expect(retries).toHaveLength(2);

    // 应该有 apply_patch（来自被接受的 argue）
    const patches = result.feedback.adjustments.filter((a) => a.type === "apply_patch");
    expect(patches.length).toBeGreaterThan(0);

    // ====== 验证 7: 最终状态 ======
    expect(result.success).toBe(true);
    expect(result.summary).toContain("failures");
    expect(result.summary).toContain("patches");
  });

  it("handles no-gap scenario gracefully", async () => {
    const workflowId = "wf-clean-001";

    // 不注入任何失败或 KPI 偏差
    const result = await runIterationCycle(ctx, "B", workflowId);

    // 无失败
    expect(result.failures).toHaveLength(0);

    // 无差距
    expect(result.lineageGaps).toHaveLength(0);

    // 无补丁
    expect(result.suggestedPatches).toHaveLength(0);

    // 无 argue
    expect(result.disputes).toHaveLength(0);

    // 反馈为空
    expect(result.feedback.targetChain).toBe("B");
    expect(result.feedback.adjustments).toHaveLength(0);

    // 成功
    expect(result.success).toBe(true);
  });

  it("escalates rejected argue disputes", async () => {
    const workflowId = "wf-reject-001";

    // 注入一个高优先级失败
    ctx.failureCollector.collectFailure({
      failureId: "fail-reject",
      workflowId,
      nodeId: "decompose",
      failureType: "input_validation",
      severity: "high",
      errorMessage: "Invalid requirement format",
    });

    // 配置 argue-manager: 拒绝所有 argue
    ctx.argueManager = new ArgueManager({
      evaluator: async (argue) => ({
        argueId: argue.argueId,
        accepted: false,
        feedback: "Patch is too risky",
        reasoning: "Patch is too risky to apply automatically",
        counterPoints: ["manual review required"],
        timestamp: new Date().toISOString(),
      }),
    });

    const result = await runIterationCycle(ctx, "A", workflowId);

    // 有失败 → 有差距 → 有补丁
    expect(result.suggestedPatches.length).toBeGreaterThan(0);

    // Argue 被拒绝
    const highPriority = result.suggestedPatches.filter((p) => p.priority <= 3);
    if (highPriority.length > 0) {
      expect(result.disputes.length).toBe(highPriority.length);
      expect(result.disputes.every((d) => !d.response?.accepted)).toBe(true);

      // 被拒绝的 → escalate
      const escalations = result.feedback.adjustments.filter((a) => a.type === "escalate");
      expect(escalations.length).toBe(highPriority.length);
    }

    // 仍然有 retry_step（来自未解决的失败）
    const retries = result.feedback.adjustments.filter((a) => a.type === "retry_step");
    expect(retries).toHaveLength(1);

    expect(result.success).toBe(true);
  });
});
