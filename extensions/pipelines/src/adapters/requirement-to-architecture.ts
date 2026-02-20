/**
 * 需求分解结果 → 架构设计输入适配器
 *
 * requirementTree → { requirement, projectContext, scenario }
 */

import type { ReqDecompGraphState } from "../maintenance/requirement-decomposition.js";

/** 从 requirementTree 提取架构设计所需的需求文本 */
export function requirementTreeToText(tree: Record<string, unknown>): string {
  const root = tree.root as string | undefined;
  const children = tree.children as Array<{ description?: string; category?: string }> | undefined;

  if (!root) return "";

  const lines = [`# ${root}`];
  if (children?.length) {
    lines.push("");
    for (const child of children) {
      lines.push(`- [${child.category ?? "general"}] ${child.description ?? ""}`);
    }
  }
  return lines.join("\n");
}

/** 将分解结果转换为架构设计工作流的输入 */
export function decompositionToArchitectureInput(
  decompState: Pick<
    ReqDecompGraphState,
    "requirementDescription" | "requirementTree" | "subRequirements"
  >,
  scenario: "new_project" | "modify_existing" = "new_project",
  projectPath?: string,
): {
  requirement: string;
  projectContext: Record<string, unknown>;
  scenario: "new_project" | "modify_existing";
  projectPath?: string;
} {
  const requirement =
    requirementTreeToText(decompState.requirementTree) || decompState.requirementDescription;

  const projectContext: Record<string, unknown> = {
    decomposedFrom: decompState.requirementDescription,
    subRequirementCount: (decompState.subRequirements ?? []).length,
    subRequirements: (decompState.subRequirements ?? []).map((s) => ({
      id: s.id,
      description: s.description,
      category: s.category,
    })),
  };

  return { requirement, projectContext, scenario, projectPath };
}
