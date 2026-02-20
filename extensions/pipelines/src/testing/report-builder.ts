/**
 * ReportBuilder - Incremental UX test report builder
 *
 * Provides set_field / get_fields / generate API for the UX Agent
 * to build reports incrementally. Generates 8-section Markdown reports
 * matching the Python ReportGeneratorTool format.
 *
 * Source: _personal_copilot/src/tools/user_experience/report_generator_tool.py
 */

import type { FailureCollector } from "../self-iteration/failure-collector.js";
import type { KPICollector } from "../self-iteration/kpi-collector.js";

// ============================================================================
// Types
// ============================================================================

export interface UXReportFields {
  // Section 1: Basic Info
  testTarget: string;
  testGoal: string;
  sessionId: string;
  testTime: string;

  // Section 2: Execution Stats
  totalRuntime: string;
  inputCount: number;
  outputLineCount: number;
  exitStatus: string;

  // Section 3: I/O Log
  interactions: Array<{ input: string; output: string }>;

  // Section 4: Requirement Match
  requirementUnderstanding: boolean;
  requirementFormatCompliant: boolean;
  requirementCompleteness: string;

  // Section 5: Usability
  scriptUsability: string;
  interactionFluency: string;

  // Section 6: Output Quality
  outputQuality: string;

  // Section 7: Parameter Flexibility
  parameterFlexibility: string;

  // Section 8: Suggestions
  suggestions: string[];

  // Assessment
  assessmentLevel: number; // 1=Perfect, 2=Excellent, 3=Acceptable, 4=Unacceptable, 5=Failed
  assessmentReason: string;
}

/** Fields that are considered "required" for completion tracking */
const REQUIRED_FIELDS: Array<keyof UXReportFields> = [
  "testTarget",
  "testGoal",
  "sessionId",
  "exitStatus",
  "requirementUnderstanding",
  "requirementFormatCompliant",
  "requirementCompleteness",
  "scriptUsability",
  "interactionFluency",
  "assessmentLevel",
  "assessmentReason",
];

/** All settable field names */
const ALL_FIELDS: Array<keyof UXReportFields> = [
  "testTarget",
  "testGoal",
  "sessionId",
  "testTime",
  "totalRuntime",
  "inputCount",
  "outputLineCount",
  "exitStatus",
  "interactions",
  "requirementUnderstanding",
  "requirementFormatCompliant",
  "requirementCompleteness",
  "scriptUsability",
  "interactionFluency",
  "outputQuality",
  "parameterFlexibility",
  "suggestions",
  "assessmentLevel",
  "assessmentReason",
];

// ============================================================================
// ReportBuilder
// ============================================================================

export class ReportBuilder {
  private fields: Partial<UXReportFields>;
  private workflowId: string;

  constructor(testGoal: string, sessionId?: string) {
    this.workflowId = sessionId ?? `ux_${Date.now()}`;
    this.fields = {
      testGoal,
      sessionId: this.workflowId,
      testTime: new Date().toISOString().replace("T", " ").slice(0, 19),
      interactions: [],
      suggestions: [],
    };
  }

  /**
   * Set a single report field.
   */
  setField(field: string, value: unknown): { success: true; field: string } {
    const key = field as keyof UXReportFields;

    if (!ALL_FIELDS.includes(key)) {
      // Accept unknown fields gracefully — store them anyway
      (this.fields as Record<string, unknown>)[field] = value;
    } else if (key === "interactions") {
      // Interactions can be set as array or appended
      if (Array.isArray(value)) {
        this.fields.interactions = value as Array<{ input: string; output: string }>;
      }
    } else if (key === "suggestions") {
      if (Array.isArray(value)) {
        this.fields.suggestions = value as string[];
      } else if (typeof value === "string") {
        if (!this.fields.suggestions) this.fields.suggestions = [];
        this.fields.suggestions.push(value);
      }
    } else {
      (this.fields as Record<string, unknown>)[key] = value;
    }

    return { success: true, field };
  }

  /**
   * Get current values of specified fields (or all if not specified).
   */
  getFields(fieldNames?: string[]): Record<string, unknown> {
    if (!fieldNames || fieldNames.length === 0) {
      return { ...this.fields };
    }
    const result: Record<string, unknown> = {};
    for (const name of fieldNames) {
      result[name] = (this.fields as Record<string, unknown>)[name];
    }
    return result;
  }

  /**
   * Get completion status: how many required fields are filled.
   */
  getCompletionStatus(): { total: number; filled: number; missing: string[] } {
    const missing: string[] = [];
    let filled = 0;

    for (const field of REQUIRED_FIELDS) {
      const value = (this.fields as Record<string, unknown>)[field];
      if (value !== undefined && value !== null && value !== "") {
        filled++;
      } else {
        missing.push(field);
      }
    }

    return {
      total: REQUIRED_FIELDS.length,
      filled,
      missing,
    };
  }

  /**
   * Add an interaction record.
   */
  addInteraction(input: string, output: string): void {
    if (!this.fields.interactions) {
      this.fields.interactions = [];
    }
    this.fields.interactions.push({ input, output });
  }

  /**
   * Generate the complete Markdown report.
   */
  generate(): string {
    const f = this.fields;
    const lines: string[] = [];

    // Title
    lines.push("# 用户体验测试报告");
    lines.push("");

    // Section 1: Basic Info
    lines.push("## 1. 基本信息");
    lines.push("");
    lines.push(`- **测试时间**: ${f.testTime ?? "N/A"}`);
    lines.push(`- **测试目标**: ${f.testTarget ?? "N/A"}`);
    lines.push(`- **需求文档**: ${f.testGoal ?? "N/A"}`);
    lines.push(`- **会话ID**: ${f.sessionId ?? "N/A"}`);
    lines.push("");

    // Section 2: Execution Stats
    lines.push("## 2. 执行统计");
    lines.push("");
    lines.push(`- **总运行时间**: ${f.totalRuntime ?? "N/A"}`);
    lines.push(`- **输入次数**: ${f.inputCount ?? "N/A"}次`);
    lines.push(`- **输出总行数**: ${f.outputLineCount ?? "N/A"}行`);
    lines.push(`- **退出状态**: ${f.exitStatus ?? "N/A"}`);
    lines.push("");

    // Section 3: I/O Log
    lines.push("## 3. 输入输出记录");
    lines.push("");
    if (f.interactions && f.interactions.length > 0) {
      for (let i = 0; i < f.interactions.length; i++) {
        const entry = f.interactions[i];
        lines.push(`### 交互 ${i + 1}`);
        lines.push("");
        lines.push(`**输入**: ${entry.input}`);
        lines.push("");
        lines.push(`**输出**: ${entry.output}`);
        lines.push("");
      }
    } else {
      lines.push("*无交互记录*");
      lines.push("");
    }

    // Section 4: Requirement Match
    lines.push("## 4. 需求匹配度评价");
    lines.push("");
    const understanding = f.requirementUnderstanding;
    const format = f.requirementFormatCompliant;
    lines.push(
      `- ${understanding ? "✅" : "❌"} **需求理解正确**: ${understanding === undefined ? "未评价" : understanding ? "是" : "否"}`,
    );
    lines.push(
      `- ${format ? "✅" : "❌"} **输出格式符合**: ${format === undefined ? "未评价" : format ? "是" : "否"}`,
    );
    lines.push(`- ⚠️ **功能完整性**: ${f.requirementCompleteness ?? "未评价"}`);
    lines.push("");

    // Section 5: Usability
    lines.push("## 5. 易用性评价");
    lines.push("");
    lines.push(`- **脚本易用性**: ${f.scriptUsability ?? "未评价"}`);
    lines.push("");
    lines.push(`- **交互流畅度**: ${f.interactionFluency ?? "未评价"}`);
    lines.push("");

    // Section 6: Output Quality
    lines.push("## 6. 输出质量评价");
    lines.push("");
    lines.push(f.outputQuality ?? "*未提供输出质量评价*");
    lines.push("");

    // Section 7: Parameter Flexibility
    lines.push("## 7. 参数灵活性评价");
    lines.push("");
    lines.push(f.parameterFlexibility ?? "*未提供参数灵活性评价*");
    lines.push("");

    // Section 8: Suggestions
    lines.push("## 8. 改进建议");
    lines.push("");
    if (f.suggestions && f.suggestions.length > 0) {
      for (let i = 0; i < f.suggestions.length; i++) {
        lines.push(`${i + 1}. ${f.suggestions[i]}`);
      }
    } else {
      lines.push("*无改进建议*");
    }
    lines.push("");

    // Footer
    lines.push("---");
    lines.push("");
    lines.push("*本报告由 UX Agent v1.0 (TypeScript) 自动生成*");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Collect instrumentation data into KPI/Failure collectors.
   *
   * Assessment levels:
   * - 1 (Perfect): record metric only
   * - 2 (Excellent): record metric only
   * - 3 (Acceptable): record metric + assessment
   * - 4 (Unacceptable): record metric + assessment
   * - 5 (Failed): record metric + assessment + failure event
   */
  collectInstrumentation(kpiCollector?: KPICollector, failureCollector?: FailureCollector): void {
    const level = this.fields.assessmentLevel;
    if (level === undefined) return;

    // Record assessment in KPI collector
    if (kpiCollector) {
      kpiCollector.collectAssessment({
        assessmentId: `ux_assess_${this.workflowId}`,
        level: level as 1 | 2 | 3 | 4 | 5,
        reasoning: this.fields.assessmentReason ?? "No reason provided",
        workflowId: this.workflowId,
        nodeId: "ux-agent",
        evaluator: "ux-agent",
        agentId: "ux-agent",
        recommendations: this.fields.suggestions ?? [],
      });
    }

    // Record failure for level >= 5
    if (failureCollector && level >= 5) {
      failureCollector.collectFailure({
        failureId: `ux_fail_${this.workflowId}`,
        workflowId: this.workflowId,
        nodeId: "ux-agent",
        failureType: "quality_issue" as any,
        severity: "high" as any,
        errorMessage: this.fields.assessmentReason ?? "UX test failed",
        rootCause: `Assessment level ${level}: ${this.fields.assessmentReason ?? "unknown"}`,
      });
    }
  }
}
