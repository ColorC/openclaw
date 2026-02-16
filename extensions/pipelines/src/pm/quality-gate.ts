/**
 * 质量门禁
 *
 * 多维度质量评估：INVEST、SMART、覆盖率、性能、文档、契约。
 * 根据阈值判断需求是否通过质量关卡。
 *
 * 源码参考：_personal_copilot/src/services/pm/quality_gate.py
 */

import type {
  PMDatabase,
  RequirementData,
  AcceptanceCriterion,
  PerformanceMetric,
} from "./database.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface QualityThresholds {
  invest: number;
  smart: number;
  coverage: number;
  performance: number;
  documentation: number;
  contract: number;
}

export interface QualityScores {
  invest: number;
  smart: number;
  coverage: number;
  performance: number;
  documentation: number;
  contract: number;
}

export interface QualityResult {
  passed: boolean;
  scores: QualityScores;
  blockingIssues: string[];
  details: Record<string, string[]>;
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  invest: 0.7,
  smart: 0.7,
  coverage: 0.8,
  performance: 0.7,
  documentation: 0.8,
  contract: 0.9,
};

// ============================================================================
// QualityGate
// ============================================================================

export class QualityGate {
  private thresholds: QualityThresholds;

  constructor(
    private db: PMDatabase,
    thresholds?: Partial<QualityThresholds>,
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * 评估需求质量
   */
  evaluate(requirementId: string): QualityResult {
    const req = this.db.getRequirement(requirementId);
    if (!req) {
      return {
        passed: false,
        scores: { invest: 0, smart: 0, coverage: 0, performance: 0, documentation: 0, contract: 0 },
        blockingIssues: [`Requirement ${requirementId} not found`],
        details: {},
      };
    }

    const details: Record<string, string[]> = {};
    const scores: QualityScores = {
      invest: this.calculateInvestScore(req, details),
      smart: this.calculateSmartScore(req, details),
      coverage: this.calculateCoverageScore(req, requirementId, details),
      performance: this.calculatePerformanceScore(req, requirementId, details),
      documentation: this.calculateDocumentationScore(req, details),
      contract: this.calculateContractScore(req, requirementId, details),
    };

    const blockingIssues: string[] = [];
    for (const [dim, score] of Object.entries(scores)) {
      const threshold = this.thresholds[dim as keyof QualityThresholds];
      if (score < threshold) {
        blockingIssues.push(
          `${dim}: ${(score * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% threshold`,
        );
      }
    }

    return {
      passed: blockingIssues.length === 0,
      scores,
      blockingIssues,
      details,
    };
  }

  /**
   * 设置阈值
   */
  setThreshold(dimension: keyof QualityThresholds, value: number): void {
    this.thresholds[dimension] = Math.max(0, Math.min(1, value));
  }

  // ========================================================================
  // INVEST 评分
  // ========================================================================

  private calculateInvestScore(req: RequirementData, details: Record<string, string[]>): number {
    if (req.investScore) {
      const values = Object.values(req.investScore).filter((v): v is number => v != null);
      if (values.length > 0) {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    }

    // 基于可用数据推断
    const issues: string[] = [];
    let score = 0;
    let checks = 0;

    // Independent: 无依赖则加分
    const deps = this.db.getDependencies(req.id);
    checks++;
    if (deps.blockedBy.length === 0) {
      score += 1;
    } else {
      score += 0.5;
      issues.push(`Has ${deps.blockedBy.length} blocking dependencies`);
    }

    // Valuable: 有描述
    checks++;
    if (req.description && req.description.length > 20) {
      score += 1;
    } else {
      score += 0.3;
      issues.push("Description is too short");
    }

    // Estimable: 有估计
    checks++;
    if (req.estimate != null && req.estimate > 0) {
      score += 1;
    } else {
      score += 0.4;
      issues.push("No work estimate provided");
    }

    // Testable: 有验收标准
    checks++;
    if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) {
      score += 1;
    } else {
      score += 0.3;
      issues.push("No acceptance criteria defined");
    }

    if (issues.length > 0) details.invest = issues;
    return checks > 0 ? score / checks : 0;
  }

  // ========================================================================
  // SMART 评分
  // ========================================================================

  private calculateSmartScore(req: RequirementData, details: Record<string, string[]>): number {
    const issues: string[] = [];
    let score = 0;
    let checks = 0;

    // Specific: 描述足够具体
    checks++;
    if (req.description.length > 50) {
      score += 1;
    } else if (req.description.length > 20) {
      score += 0.6;
      issues.push("Description could be more specific");
    } else {
      score += 0.2;
      issues.push("Description is not specific enough");
    }

    // Measurable: 有验收标准
    checks++;
    if (req.acceptanceCriteria && req.acceptanceCriteria.length >= 2) {
      score += 1;
    } else if (req.acceptanceCriteria && req.acceptanceCriteria.length === 1) {
      score += 0.6;
      issues.push("Only one acceptance criterion");
    } else {
      score += 0.2;
      issues.push("No measurable acceptance criteria");
    }

    // Achievable: 有估计且合理
    checks++;
    if (req.estimate != null && req.estimate > 0 && req.estimate <= 40) {
      score += 1;
    } else if (req.estimate != null && req.estimate > 0) {
      score += 0.5;
      issues.push("Estimate may be too large, consider breaking down");
    } else {
      score += 0.4;
      issues.push("No work estimate");
    }

    // Relevant: 有 category
    checks++;
    if (req.category) {
      score += 1;
    } else {
      score += 0.5;
      issues.push("No category assigned");
    }

    // Time-bound: 有估计单位
    checks++;
    if (req.estimateUnit) {
      score += 1;
    } else {
      score += 0.4;
      issues.push("No time unit for estimate");
    }

    if (issues.length > 0) details.smart = issues;
    return checks > 0 ? score / checks : 0;
  }

  // ========================================================================
  // 覆盖率评分
  // ========================================================================

  private calculateCoverageScore(
    req: RequirementData,
    reqId: string,
    details: Record<string, string[]>,
  ): number {
    const issues: string[] = [];
    let score = 0.5; // 默认基础分

    // 验收标准通过率
    if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) {
      const passed = req.acceptanceCriteria.filter(
        (c: AcceptanceCriterion) => c.status === "passed",
      ).length;
      const ratio = passed / req.acceptanceCriteria.length;
      score = ratio;
      if (ratio < 1) {
        issues.push(`${passed}/${req.acceptanceCriteria.length} acceptance criteria passed`);
      }
    } else {
      score = 0.3;
      issues.push("No acceptance criteria to measure coverage");
    }

    // 子任务完成率
    const children = this.db.getAllRequirements({ parentId: reqId });
    if (children.length > 0) {
      const completed = children.filter((c: RequirementData) => c.status === "completed").length;
      const childScore = completed / children.length;
      score = (score + childScore) / 2;
      if (childScore < 1) {
        issues.push(`${completed}/${children.length} sub-tasks completed`);
      }
    }

    if (issues.length > 0) details.coverage = issues;
    return score;
  }

  // ========================================================================
  // 性能评分
  // ========================================================================

  private calculatePerformanceScore(
    req: RequirementData,
    reqId: string,
    details: Record<string, string[]>,
  ): number {
    const issues: string[] = [];
    const metrics = this.db.getPerformanceMetrics(reqId);

    if (metrics.length === 0) {
      issues.push("No performance metrics recorded");
      details.performance = issues;
      return 0.5;
    }

    let score = 1.0;

    // 争议次数
    const totalArgues = metrics.reduce(
      (sum: number, m: PerformanceMetric) => sum + (m.argueCount ?? 0),
      0,
    );
    if (totalArgues > 5) {
      score -= 0.3;
      issues.push(`High argue count: ${totalArgues}`);
    } else if (totalArgues > 2) {
      score -= 0.1;
      issues.push(`${totalArgues} argues recorded`);
    }

    // 断路器触发
    const cbTriggered = metrics.some((m: PerformanceMetric) => m.circuitBreakerTriggered);
    if (cbTriggered) {
      score -= 0.2;
      issues.push("Circuit breaker was triggered");
    }

    // 质量分数
    const avgQuality = metrics
      .filter((m: PerformanceMetric) => m.qualityScore != null)
      .reduce(
        (sum: number, m: PerformanceMetric, _: number, arr: PerformanceMetric[]) =>
          sum + (m.qualityScore ?? 0) / arr.length,
        0,
      );
    if (avgQuality > 0 && avgQuality < 0.7) {
      score -= 0.2;
      issues.push(`Low average quality score: ${(avgQuality * 100).toFixed(0)}%`);
    }

    if (issues.length > 0) details.performance = issues;
    return Math.max(0, score);
  }

  // ========================================================================
  // 文档评分
  // ========================================================================

  private calculateDocumentationScore(
    req: RequirementData,
    details: Record<string, string[]>,
  ): number {
    const issues: string[] = [];
    let score = 0;
    let checks = 0;

    // 描述长度
    checks++;
    if (req.description.length > 100) {
      score += 1;
    } else if (req.description.length > 50) {
      score += 0.7;
    } else {
      score += 0.3;
      issues.push("Description is too brief");
    }

    // 有 metadata
    checks++;
    if (req.metadata && Object.keys(req.metadata).length > 0) {
      score += 1;
    } else {
      score += 0.3;
      issues.push("No metadata provided");
    }

    // 有验收标准
    checks++;
    if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) {
      score += 1;
    } else {
      score += 0.2;
      issues.push("No acceptance criteria documented");
    }

    // 有 tags
    checks++;
    if (req.tags && req.tags.length > 0) {
      score += 1;
    } else {
      score += 0.5;
      issues.push("No tags assigned");
    }

    if (issues.length > 0) details.documentation = issues;
    return checks > 0 ? score / checks : 0;
  }

  // ========================================================================
  // 契约评分
  // ========================================================================

  private calculateContractScore(
    req: RequirementData,
    reqId: string,
    details: Record<string, string[]>,
  ): number {
    const issues: string[] = [];
    let score = 1.0;

    // 验收标准完整性
    if (!req.acceptanceCriteria || req.acceptanceCriteria.length === 0) {
      score -= 0.4;
      issues.push("No acceptance criteria (contract missing)");
    } else {
      const failedCriteria = req.acceptanceCriteria.filter(
        (c: AcceptanceCriterion) => c.status === "failed",
      );
      if (failedCriteria.length > 0) {
        score -= 0.3;
        issues.push(`${failedCriteria.length} failed acceptance criteria`);
      }
    }

    // 依赖满足
    const deps = this.db.getDependencies(reqId);
    for (const dep of deps.blockedBy) {
      if (dep.dependencyType === "blocking") {
        const depReq = this.db.getRequirement(dep.sourceRequirementId);
        if (depReq && depReq.status !== "completed") {
          score -= 0.2;
          issues.push(`Blocking dependency ${dep.sourceRequirementId} not completed`);
        }
      }
    }

    if (issues.length > 0) details.contract = issues;
    return Math.max(0, score);
  }
}
