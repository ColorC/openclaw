/**
 * 需求分解 → PM 数据库适配器
 *
 * SubRequirement[] + InvestScoreResult[] → createRequirement() 参数
 */

import type { SubRequirement, InvestScoreResult } from "../maintenance/states.js";
import type { PMDatabase, InvestScore, RequirementData, Priority } from "../pm/database.js";

/** InvestScoreResult (7 字段含 total) → InvestScore (6 optional 字段) */
export function convertInvestScore(score: InvestScoreResult): InvestScore {
  return {
    independent: score.independent,
    negotiable: score.negotiable,
    valuable: score.valuable,
    estimable: score.estimable,
    small: score.small,
    testable: score.testable,
  };
}

/** SubRequirement → createRequirement() 参数 */
export function subRequirementToCreateParams(
  sub: SubRequirement,
  parentId: string,
  projectId?: string,
  priority?: Priority,
): Parameters<PMDatabase["createRequirement"]>[0] {
  return {
    id: sub.id,
    description: sub.description,
    category: sub.category,
    parentId,
    projectId,
    priority: priority ?? "medium",
    investScore: sub.investScore ? convertInvestScore(sub.investScore) : undefined,
  };
}

/** 批量导入分解结果到 PM 数据库 */
export function importDecompositionResults(
  db: PMDatabase,
  subRequirements: SubRequirement[],
  investScores: InvestScoreResult[],
  parentRequirementId: string,
  projectId?: string,
): RequirementData[] {
  return subRequirements.map((sub, i) => {
    const enriched: SubRequirement = {
      ...sub,
      investScore: investScores[i] ?? sub.investScore,
    };
    const params = subRequirementToCreateParams(enriched, parentRequirementId, projectId);
    return db.createRequirement(params);
  });
}
