/**
 * OpenSpec 文档生成器
 *
 * 从架构设计工作流的 state 数据生成真实的 OpenSpec 文档内容：
 * - design.md: 完整技术设计文档
 * - tasks.md: 实现任务分解
 *
 * 对齐 Python 原版: _personal_copilot/src/workflows/nodes/architecture_design/generate_openspec_node.py
 */

import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import type {
  ModuleDefinition,
  InterfaceDefinition,
  ResponsibilityEntry,
} from "../workflows/states.js";

// ============================================================================
// design.md 生成
// ============================================================================

/**
 * 生成完整的 design.md 技术设计文档
 */
export function generateDesignMarkdown(
  state: Pick<
    ArchitectureDesignGraphState,
    | "requirement"
    | "requirementAnalysis"
    | "customArchitecture"
    | "selectedPattern"
    | "modules"
    | "interfaces"
    | "designReview"
    | "responsibilityMatrix"
    | "fileStructure"
  >,
): string {
  const lines: string[] = [];
  const analysis = state.requirementAnalysis;
  const arch = state.customArchitecture;

  // Title
  lines.push("# Technical Design Document", "");

  // Context
  lines.push("## Context", "");
  lines.push(state.requirement || "_No requirement specified_", "");

  // Goals / Non-Goals
  lines.push("## Goals / Non-Goals", "");
  lines.push("### Goals", "");
  if (analysis?.keyEntities?.length) {
    for (const entity of analysis.keyEntities) {
      lines.push(`- Implement ${entity}`);
    }
  } else {
    lines.push("- Implement the described functionality");
  }
  lines.push("");
  lines.push("### Non-Goals", "");
  lines.push("- Out of scope features not mentioned in requirements", "");

  // Requirements Analysis
  lines.push("## Requirements Analysis", "");
  if (analysis) {
    lines.push(`- **Scale**: ${analysis.scale}`);
    lines.push(`- **Complexity**: ${analysis.complexity}`);
    lines.push(`- **Domain**: ${analysis.domain}`);
    if (analysis.keyEntities?.length) {
      lines.push(`- **Key Entities**: ${analysis.keyEntities.join(", ")}`);
    }
  } else {
    lines.push("_Analysis not available_");
  }
  lines.push("");

  // Architecture Overview
  lines.push("## Architecture Overview", "");
  if (arch) {
    lines.push(`- **Architecture Name**: ${arch.name}`);
    lines.push(`- **Pattern**: ${arch.pattern}`);
    lines.push(`- **Description**: ${arch.description}`);
  } else if (state.selectedPattern) {
    lines.push(`- **Pattern**: ${state.selectedPattern}`);
  }
  lines.push("");

  // Module Design
  lines.push("## Module Design", "");
  if (state.modules?.length) {
    lines.push(`Total modules: ${state.modules.length}`, "");
    for (const mod of state.modules) {
      lines.push(`### ${mod.name} (\`${mod.id}\`)`, "");
      lines.push(mod.description, "");
      if (mod.responsibilities?.length) {
        lines.push("**Responsibilities:**");
        for (const r of mod.responsibilities) {
          lines.push(`- ${r}`);
        }
        lines.push("");
      }
      if (mod.dependencies?.length) {
        lines.push(`**Dependencies:** ${mod.dependencies.join(", ")}`);
        lines.push("");
      }
    }
  } else {
    lines.push("_No modules defined_", "");
  }

  // Interface Design
  lines.push("## Interface Design", "");
  if (state.interfaces?.length) {
    lines.push(`Total interfaces: ${state.interfaces.length}`, "");
    for (const iface of state.interfaces) {
      lines.push(`### ${iface.name} (\`${iface.id}\`)`, "");
      lines.push(`**Type:** ${iface.type}`, "");
      if (iface.methods?.length) {
        lines.push("| Method | Input | Output | Description |");
        lines.push("|--------|-------|--------|-------------|");
        for (const m of iface.methods) {
          lines.push(`| \`${m.name}\` | \`${m.input}\` | \`${m.output}\` | ${m.description} |`);
        }
        lines.push("");
      }
    }
  } else {
    lines.push("_No interfaces defined_", "");
  }

  // Design Review
  if (state.designReview) {
    lines.push("## Design Review", "");
    const review = state.designReview;
    if (review.omissions?.length) {
      lines.push("### Omissions");
      for (const o of review.omissions) {
        lines.push(`- ${o}`);
      }
      lines.push("");
    }
    if (review.couplingIssues?.length) {
      lines.push("### Coupling Issues");
      for (const c of review.couplingIssues) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }
    if (review.suggestions?.length) {
      lines.push("### Suggestions");
      for (const s of review.suggestions) {
        lines.push(`- ${s}`);
      }
      lines.push("");
    }
  }

  // Responsibility Matrix
  if (state.responsibilityMatrix?.length) {
    lines.push("## Responsibility Matrix", "");
    lines.push("| Module | Feature | Responsibility |");
    lines.push("|--------|---------|---------------|");
    for (const entry of state.responsibilityMatrix) {
      lines.push(`| ${entry.moduleId} | ${entry.featureId} | ${entry.responsibility} |`);
    }
    lines.push("");
  }

  // File Structure
  if (state.fileStructure && Object.keys(state.fileStructure).length > 0) {
    lines.push("## File Structure", "");
    lines.push("```");
    renderFileStructure(lines, state.fileStructure, 0);
    lines.push("```", "");
  }

  return lines.join("\n");
}

/**
 * 递归渲染文件结构为树形文本
 */
function renderFileStructure(
  lines: string[],
  structure: Record<string, unknown>,
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  for (const [key, value] of Object.entries(structure)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${indent}${key}/`);
      renderFileStructure(lines, value as Record<string, unknown>, depth + 1);
    } else if (typeof value === "string") {
      lines.push(`${indent}${key} — ${value}`);
    } else {
      lines.push(`${indent}${key}`);
    }
  }
}

// ============================================================================
// tasks.md 生成
// ============================================================================

/**
 * 生成完整的 tasks.md 任务分解文档
 */
export function generateArchitectureTasksMarkdown(
  state: Pick<ArchitectureDesignGraphState, "modules" | "interfaces">,
): string {
  const lines: string[] = [];
  const modules = state.modules ?? [];
  const interfaces = state.interfaces ?? [];

  lines.push("# Implementation Tasks", "");

  // 1. Module Implementation Tasks
  lines.push("## 1. Module Implementation", "");
  if (modules.length) {
    for (const mod of modules) {
      lines.push(`### ${mod.name}`, "");
      lines.push(`- [ ] Create module \`${mod.id}\``);
      for (const r of mod.responsibilities ?? []) {
        lines.push(`- [ ] Implement: ${r}`);
      }
      if (mod.dependencies?.length) {
        lines.push(`- [ ] Wire dependencies: ${mod.dependencies.join(", ")}`);
      }
      lines.push("");
    }
  } else {
    lines.push("_No modules to implement_", "");
  }

  // 2. Interface Definition Tasks
  lines.push("## 2. Interface Definitions", "");
  if (interfaces.length) {
    for (const iface of interfaces) {
      lines.push(`### ${iface.name}`, "");
      lines.push(`- [ ] Define interface \`${iface.id}\` (type: ${iface.type})`);
      for (const m of iface.methods ?? []) {
        lines.push(`- [ ] Implement \`${m.name}(${m.input}): ${m.output}\``);
      }
      lines.push("");
    }
  } else {
    lines.push("_No interfaces to define_", "");
  }

  // 3. Testing & Verification Tasks
  lines.push("## 3. Testing & Verification", "");
  for (const mod of modules) {
    lines.push(`- [ ] Unit tests for ${mod.name}`);
  }
  for (const iface of interfaces) {
    lines.push(`- [ ] Contract tests for ${iface.name}`);
  }
  if (modules.length === 0 && interfaces.length === 0) {
    lines.push("_No tests needed_");
  }
  lines.push("");

  // Statistics Summary
  const totalMethods = interfaces.reduce((sum, iface) => sum + (iface.methods?.length ?? 0), 0);
  lines.push("## Statistics", "");
  lines.push(`- **Modules**: ${modules.length}`);
  lines.push(`- **Interfaces**: ${interfaces.length}`);
  lines.push(`- **Total methods**: ${totalMethods}`);
  lines.push("");

  return lines.join("\n");
}
