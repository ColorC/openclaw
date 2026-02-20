/**
 * 知识层 → Wiki 适配器
 *
 * ProjectDoc + FileAnnotation → DocumentOrganization 输入 → Wiki 页面
 */

import type { ProjectDocManager } from "../knowledge/project-doc-manager.js";
import type { DiscoveredFile, DocumentType } from "../maintenance/states.js";
import type { FileAnnotation } from "./exploration-to-knowledge.js";

/** 将文件注解转换为 document-organization 的 DiscoveredFile[] */
export function annotationsToDiscoveredFiles(annotations: FileAnnotation[]): DiscoveredFile[] {
  return annotations.map((ann) => ({
    path: ann.filePath,
    filename: ann.filePath.split("/").pop() ?? ann.filePath,
    documentType: classifyByExtension(ann.filePath),
    size: ann.findings.length,
  }));
}

/** 从 project-doc-manager 的 wiki 页面列表生成 DiscoveredFile[] */
export function wikiPagesToDiscoveredFiles(docManager: ProjectDocManager): DiscoveredFile[] {
  const result = docManager.listWikiPages();
  if (!result.success || !result.data) return [];
  return result.data.map((pageName: string) => ({
    path: `wiki/${pageName}`,
    filename: `${pageName}.md`,
    documentType: "report" as DocumentType,
    size: 0,
  }));
}

/** 合成 wiki 页面 */
export function synthesizeWikiPages(
  docManager: ProjectDocManager,
  annotations: FileAnnotation[],
  projectName: string,
): Array<{ pageName: string; content: string }> {
  const pages: Array<{ pageName: string; content: string }> = [];

  // 索引页
  const indexLines = [
    `# ${projectName} Wiki`,
    "",
    "## Files",
    ...annotations.map((a) => `- [\`${a.symid}\`](${a.filePath})`),
  ];
  const indexPage = { pageName: "index", content: indexLines.join("\n") };
  pages.push(indexPage);
  docManager.saveWikiPage("index", indexPage.content);

  // 按文件类型分组页面
  const byType = new Map<string, FileAnnotation[]>();
  for (const ann of annotations) {
    const ext = ann.filePath.split(".").pop() ?? "other";
    if (!byType.has(ext)) byType.set(ext, []);
    byType.get(ext)!.push(ann);
  }

  for (const [ext, anns] of byType) {
    const lines = [
      `# ${ext.toUpperCase()} Files`,
      "",
      ...anns
        .map((a) => [
          `## ${a.filePath}`,
          `SymID: \`${a.symid}\``,
          ...a.findings.map((f) => `- ${f.content}`),
          "",
        ])
        .flat(),
    ];
    const page = { pageName: `files-${ext}`, content: lines.join("\n") };
    pages.push(page);
    docManager.saveWikiPage(page.pageName, page.content);
  }

  return pages;
}

// ============================================================================
// 内部工具
// ============================================================================

function classifyByExtension(filePath: string): DocumentType {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "md") return "report";
  if (ext === "json" || ext === "yaml" || ext === "yml") return "plan";
  return "other";
}
