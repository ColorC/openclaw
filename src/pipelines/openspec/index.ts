/**
 * OpenSpec 集成模块
 *
 * 实现与 @fission-ai/openspec 兼容的规范驱动开发类型和解析器。
 * 为管线提供统一的规范文档处理能力。
 *
 * OpenSpec 格式说明：https://github.com/Fission-AI/OpenSpec
 */

import { z } from "zod";

// ============================================================================
// 核心类型定义
// ============================================================================

/**
 * Delta 操作类型
 */
export type DeltaOperation = "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";

/**
 * 场景（Gherkin 风格：GIVEN/WHEN/THEN）
 */
export interface Scenario {
  rawText: string;
}

/**
 * 需求
 */
export interface Requirement {
  text: string;
  scenarios: Scenario[];
}

/**
 * 规范文档
 */
export interface Spec {
  name: string;
  overview: string;
  requirements: Requirement[];
  metadata?: SpecMetadata;
}

/**
 * 规范元数据
 */
export interface SpecMetadata {
  version: string;
  format: "openspec";
  sourcePath?: string;
}

/**
 * Delta（变更单元）
 */
export interface Delta {
  spec: string;
  operation: DeltaOperation;
  description: string;
  requirement?: Requirement;
  requirements?: Requirement[];
  rename?: {
    from: string;
    to: string;
  };
}

/**
 * 变更文档
 */
export interface Change {
  name: string;
  why: string;
  whatChanges: string;
  deltas: Delta[];
  metadata?: ChangeMetadata;
}

/**
 * 变更元数据
 */
export interface ChangeMetadata {
  version: string;
  format: "openspec-change";
  sourcePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 任务状态
 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

/**
 * 任务
 */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  dependsOn?: string[];
}

/**
 * 任务组
 */
export interface TaskGroup {
  name: string;
  tasks: Task[];
}

/**
 * 变更提案（完整）
 */
export interface Proposal {
  change: Change;
  design?: string;
  tasks: TaskGroup[];
}

// ============================================================================
// Zod Schemas（用于验证）
// ============================================================================

export const ScenarioSchema = z.object({
  rawText: z.string(),
});

export const RequirementSchema = z.object({
  text: z.string(),
  scenarios: z.array(ScenarioSchema),
});

export const SpecMetadataSchema = z.object({
  version: z.string().default("1.0.0"),
  format: z.literal("openspec"),
  sourcePath: z.string().optional(),
});

export const SpecSchema = z.object({
  name: z.string(),
  overview: z.string(),
  requirements: z.array(RequirementSchema),
  metadata: SpecMetadataSchema.optional(),
});

export const DeltaOperationType = z.enum(["ADDED", "MODIFIED", "REMOVED", "RENAMED"]);

export const DeltaSchema = z.object({
  spec: z.string(),
  operation: DeltaOperationType,
  description: z.string().default(""),
  requirement: RequirementSchema.optional(),
  requirements: z.array(RequirementSchema).optional(),
  rename: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .optional(),
});

export const ChangeMetadataSchema = z.object({
  version: z.string().default("1.0.0"),
  format: z.literal("openspec-change"),
  sourcePath: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const ChangeSchema = z.object({
  name: z.string(),
  why: z.string(),
  whatChanges: z.string(),
  deltas: z.array(DeltaSchema),
  metadata: ChangeMetadataSchema.optional(),
});

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "blocked"]);

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: TaskStatusSchema.default("pending"),
  assignee: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const TaskGroupSchema = z.object({
  name: z.string(),
  tasks: z.array(TaskSchema),
});

export const ProposalSchema = z.object({
  change: ChangeSchema,
  design: z.string().optional(),
  tasks: z.array(TaskGroupSchema),
});

// ============================================================================
// Markdown 解析器
// ============================================================================

/**
 * Markdown 章节
 */
export interface Section {
  level: number;
  title: string;
  content: string;
  children: Section[];
}

/**
 * Markdown 解析器类
 */
export class MarkdownParser {
  protected lines: string[];
  protected currentLine: number = 0;

  constructor(content: string) {
    this.lines = content.split("\n");
  }

  /**
   * 解析 Spec 文档
   */
  parseSpec(name: string): Spec {
    const sections = this.parseSections();

    const overviewSection = findSection(sections, "Overview") || findSection(sections, "概述");
    const requirementsSection =
      findSection(sections, "Requirements") || findSection(sections, "需求");

    return {
      name,
      overview: overviewSection?.content.trim() || "",
      requirements: requirementsSection ? this.parseRequirements(requirementsSection) : [],
      metadata: {
        version: "1.0.0",
        format: "openspec",
      },
    };
  }

  /**
   * 解析 Change 文档
   */
  parseChange(name: string): Change {
    const sections = this.parseSections();

    const whySection = findSection(sections, "Why") || findSection(sections, "原因");
    const whatChangesSection =
      findSection(sections, "What Changes") || findSection(sections, "变更内容");
    const deltasSection = findSection(sections, "Deltas") || findSection(sections, "变更列表");

    return {
      name,
      why: whySection?.content.trim() || "",
      whatChanges: whatChangesSection?.content.trim() || "",
      deltas: deltasSection ? this.parseDeltas(deltasSection.content) : [],
      metadata: {
        version: "1.0.0",
        format: "openspec-change",
      },
    };
  }

  /**
   * 解析章节
   */
  protected parseSections(): Section[] {
    const sections: Section[] = [];
    let currentSection: Section | null = null;
    let currentContent: string[] = [];

    for (const line of this.lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (currentSection) {
          currentSection.content = currentContent.join("\n").trim();
          sections.push(currentSection);
        }
        currentSection = {
          level: headerMatch[1].length,
          title: headerMatch[2].trim(),
          content: "",
          children: [],
        };
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    if (currentSection) {
      currentSection.content = currentContent.join("\n").trim();
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * 解析需求列表
   */
  protected parseRequirements(section: Section): Requirement[] {
    const requirements: Requirement[] = [];
    const lines = section.content.split("\n");

    let currentText: string[] = [];
    let currentScenarios: Scenario[] = [];
    let inRequirement = false;

    for (const line of lines) {
      // 需求标题：### REQ-xxx 或 **REQ-xxx** 或 - REQ-xxx
      const reqMatch = line.match(/^(?:###\s+|\*\*|-)\s*(REQ-[^\s*]+|\d+\.\s*[^*\n]+)/);
      if (reqMatch) {
        // 保存前一个需求
        if (inRequirement && currentText.length > 0) {
          requirements.push({
            text: currentText.join("\n").trim(),
            scenarios: currentScenarios,
          });
        }
        inRequirement = true;
        currentText = [
          reqMatch[1]
            .replace(/^\d+\.\s*/, "")
            .replace(/\*\*/g, "")
            .trim(),
        ];
        currentScenarios = [];
      }
      // 场景：**GIVEN** / **WHEN** / **THEN** / **AND**
      else if (/\*\*(GIVEN|WHEN|THEN|AND)\*\*/.test(line)) {
        currentScenarios.push({ rawText: line.trim() });
      }
      // 场景块（列表形式）
      else if (/^-\s+\*\*(GIVEN|WHEN|THEN|AND)\*\*/.test(line)) {
        currentScenarios.push({ rawText: line.replace(/^-\s+/, "").trim() });
      }
      // 续行
      else if (inRequirement && line.trim()) {
        currentText.push(line.trim());
      }
    }

    // 最后一项
    if (inRequirement && currentText.length > 0) {
      requirements.push({
        text: currentText.join("\n").trim(),
        scenarios: currentScenarios,
      });
    }

    return requirements;
  }

  /**
   * 解析 Delta 列表
   */
  protected parseDeltas(content: string): Delta[] {
    const deltas: Delta[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      // ADDED / MODIFIED / REMOVED / RENAMED 标记
      const deltaMatch = line.match(/^-\s*\*\*(ADDED|MODIFIED|REMOVED|RENAMED)\*\*\s*(.+)$/);
      if (deltaMatch) {
        deltas.push({
          spec: deltaMatch[2].trim(),
          operation: deltaMatch[1] as DeltaOperation,
          description: "",
        });
      }
    }

    return deltas;
  }
}

/**
 * 查找章节
 */
function findSection(sections: Section[], title: string): Section | undefined {
  return sections.find((s) => s.title.toLowerCase() === title.toLowerCase());
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 解析 Spec Markdown 文档
 */
export function parseSpecMarkdown(content: string, name: string): Spec {
  const parser = new MarkdownParser(content);
  return parser.parseSpec(name);
}

/**
 * 解析 Change Markdown 文档
 */
export function parseChangeMarkdown(content: string, name: string): Change {
  const parser = new MarkdownParser(content);
  return parser.parseChange(name);
}

/**
 * 验证 Spec 文档
 */
export function validateSpec(spec: unknown): Spec {
  return SpecSchema.parse(spec);
}

/**
 * 验证 Change 文档
 */
export function validateChange(change: unknown): Change {
  return ChangeSchema.parse(change);
}

/**
 * 验证 Proposal 文档
 */
export function validateProposal(proposal: unknown): Proposal {
  return ProposalSchema.parse(proposal);
}

// ============================================================================
// 生成函数
// ============================================================================

/**
 * 生成 Spec Markdown
 */
export function generateSpecMarkdown(spec: Spec): string {
  const lines: string[] = [
    `# ${spec.name}`,
    "",
    "## Overview",
    "",
    spec.overview,
    "",
    "## Requirements",
    "",
  ];

  for (const req of spec.requirements) {
    lines.push(`### ${req.text}`, "");
    for (const scenario of req.scenarios) {
      lines.push(scenario.rawText);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 生成 Change Markdown
 */
export function generateChangeMarkdown(change: Change): string {
  const lines: string[] = [
    `# ${change.name}`,
    "",
    "## Why",
    "",
    change.why,
    "",
    "## What Changes",
    "",
    change.whatChanges,
    "",
    "## Deltas",
    "",
  ];

  for (const delta of change.deltas) {
    lines.push(`- **${delta.operation}** ${delta.spec}`);
    if (delta.description) {
      lines.push(`  ${delta.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * 生成 Proposal Markdown（tasks.md）
 */
export function generateTasksMarkdown(tasks: TaskGroup[]): string {
  const lines: string[] = ["# Tasks", ""];

  for (const group of tasks) {
    lines.push(`## ${group.name}`, "");
    for (const task of group.tasks) {
      const status = task.status === "completed" ? "x" : task.status === "in_progress" ? ">" : " ";
      lines.push(`- [${status}] ${task.id}: ${task.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
