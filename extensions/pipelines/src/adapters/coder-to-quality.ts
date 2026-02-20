/**
 * Coder 输出 → PM 更新 + 质量门禁适配器
 */

import type { PMDatabase, RequirementData } from "../pm/database.js";
import type { QualityGate, QualityResult } from "../pm/quality-gate.js";
import type { CoderGraphState } from "../workflows/coder.js";

/** 将 coder 执行结果更新到 PM 数据库 */
export function updateRequirementFromCoder(
  db: PMDatabase,
  requirementId: string,
  coderState: CoderGraphState,
): RequirementData | undefined {
  const status = coderState.success ? "completed" : "failed";
  const req = db.updateRequirementStatus(requirementId, status);
  if (!req) return undefined;

  // 记录性能指标
  db.logPerformance({
    requirementId,
    workflowName: "coder",
    agentName: "coder_agent",
    executionTimeSeconds: coderState.iterationCount * 10,
    qualityScore: coderState.qualityScore,
  });

  return req;
}

/** 更新 PM 并运行质量门禁 */
export function evaluateCoderResult(
  db: PMDatabase,
  gate: QualityGate,
  requirementId: string,
  coderState: CoderGraphState,
): { requirement: RequirementData | undefined; quality: QualityResult } {
  const requirement = updateRequirementFromCoder(db, requirementId, coderState);
  const quality = gate.evaluate(requirementId);
  return { requirement, quality };
}
