/**
 * 架构探索 → 知识层适配器
 *
 * ExplorationFinding[] → SymID + SemanticHeader + ProjectDoc
 */

import type { ProjectDocManager } from "../knowledge/project-doc-manager.js";
import type { SemanticHeaderInjector } from "../knowledge/semantic-header.js";
import type { SymidGenerator } from "../knowledge/symid-generator.js";
import type { ExplorationFinding, ArchitectureExplorationState } from "../maintenance/states.js";

export interface FileAnnotation {
  filePath: string;
  symid: string;
  header: string;
  findings: ExplorationFinding[];
}

/** 从探索发现中提取唯一文件路径 */
export function extractFilePaths(findings: ExplorationFinding[]): string[] {
  const paths = new Set<string>();
  for (const f of findings) {
    if (f.source && f.source !== "unknown") {
      paths.add(f.source);
    }
  }
  return [...paths];
}

/** 为发现的文件生成 SymID 和语义头 */
export function annotateDiscoveredFiles(
  symidGen: SymidGenerator,
  headerInjector: SemanticHeaderInjector,
  findings: ExplorationFinding[],
  opts?: { lifecycleStatus?: "experimental" | "stable" | "frozen" | "deprecated"; model?: string },
): FileAnnotation[] {
  const filePaths = extractFilePaths(findings);
  const findingsByFile = new Map<string, ExplorationFinding[]>();
  for (const f of findings) {
    const key = f.source || "unknown";
    if (!findingsByFile.has(key)) findingsByFile.set(key, []);
    findingsByFile.get(key)!.push(f);
  }

  return filePaths.map((filePath) => {
    const symid = symidGen.generateFileSymid(filePath);
    const fileFindings = findingsByFile.get(filePath) ?? [];
    const description = fileFindings
      .map((f) => f.content)
      .join("; ")
      .slice(0, 200);

    const header = headerInjector.generateSemanticHeader({
      symid,
      lifecycleStatus: opts?.lifecycleStatus ?? "experimental",
      description: description || `Discovered via architecture exploration`,
      provenance: opts?.model
        ? {
            model: opts.model,
            generatedAt: new Date().toISOString(),
            method: "architecture-exploration",
          }
        : undefined,
    });

    return { filePath, symid, header, findings: fileFindings };
  });
}

/** 将探索结果保存为项目文档 */
export function saveExplorationToProjectDocs(
  docManager: ProjectDocManager,
  explorationState: Pick<ArchitectureExplorationState, "architectureSummary" | "keyFindings">,
  annotations: FileAnnotation[],
): void {
  // 保存架构摘要为 wiki 页面
  if (explorationState.architectureSummary) {
    docManager.saveWikiPage("architecture-overview", explorationState.architectureSummary);
  }

  // 保存每个文件的文档
  for (const ann of annotations) {
    const content = [
      `# ${ann.filePath}`,
      "",
      `SymID: \`${ann.symid}\``,
      "",
      "## Findings",
      ...ann.findings.map((f) => `- [${f.type}] ${f.content}`),
    ].join("\n");
    docManager.saveFileDoc(ann.filePath, content);
  }
}
