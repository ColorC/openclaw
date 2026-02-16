/**
 * 引用格式化工具
 *
 * 将引用信息格式化为 PARSABLE 文档中的可读文本或 JSON 元数据。
 *
 * 源码参考: _personal_copilot/src/services/knowledge/reference_formatter.py
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface ReferenceBlock {
  type: "section" | "code_block" | "list" | "paragraph" | "table" | string;
  path: string;
  lineRange: [number, number];
  contentHash: string;
}

export interface References {
  document?: string;
  documentHash?: string;
  extractionDate?: string;
  blocks: ReferenceBlock[];
}

export interface ParsedReference {
  type: string;
  path: string;
  document: string;
  lineInfo: string;
  hash: string;
}

export interface ValidationResult {
  summary: { total: number; valid: number; invalid: number };
  results: Record<
    string,
    { status: "valid" | "invalid"; matchedBy?: string; confidence?: number; error?: string }
  >;
}

// ============================================================================
// 格式化
// ============================================================================

const TYPE_NAMES: Record<string, string> = {
  section: "章节",
  code_block: "代码示例",
  list: "列表",
  paragraph: "段落",
  table: "表格",
};

/**
 * 格式化为 PARSABLE 文档中的引用标记
 *
 * 生成 "📎 引用来源" 文本块
 */
export function formatReferencesForParsable(
  refs: References,
  maxBlocks = 5,
  compact = false,
): string {
  if (!refs?.blocks?.length) return "";

  const document = refs.document ?? "Unknown";
  const display = refs.blocks.slice(0, maxBlocks);
  const lines = ["", "**📎 引用来源**:"];

  for (const block of display) {
    const typeName = TYPE_NAMES[block.type] ?? "内容";
    const lineInfo =
      block.lineRange[0] > 0 ? `L${block.lineRange[0]}-${block.lineRange[1]}` : "位置未知";
    const displayPath = block.path.replace(/ > \[code_block:/g, " 中的代码块 #").replace(/\]/g, "");

    if (compact) {
      lines.push(`- ${typeName} "${displayPath}" (hash: ${block.contentHash.slice(0, 8)})`);
    } else {
      lines.push(
        `- ${typeName} "${displayPath}" (${document}#${lineInfo}, hash: ${block.contentHash})`,
      );
    }
  }

  if (refs.blocks.length > maxBlocks) {
    lines.push(`- ...还有 ${refs.blocks.length - maxBlocks} 个引用`);
  }

  return lines.join("\n");
}

/**
 * 格式化为 metadata JSON
 */
export function formatReferencesForMetadata(refs: References): { sourceReferences: References } {
  return { sourceReferences: refs };
}

/**
 * 格式化验证结果摘要
 */
export function formatValidationSummary(validation: ValidationResult, verbose = false): string {
  const { total, valid, invalid } = validation.summary;
  const lines: string[] = [];

  if (invalid === 0) {
    lines.push(`✅ 引用验证: ${valid}/${total} 全部有效`);
  } else {
    lines.push(`⚠️  引用验证: ${valid}/${total} 有效`);
  }

  if (verbose && validation.results) {
    lines.push("", "详细结果:");
    for (const [refId, result] of Object.entries(validation.results)) {
      if (result.status === "valid") {
        lines.push(
          `  ✅ ${refId}: 找到 (匹配方式: ${result.matchedBy}, 置信度: ${(result.confidence ?? 0).toFixed(2)})`,
        );
      } else {
        lines.push(`  ❌ ${refId}: ${result.error ?? "未知错误"}`);
      }
    }
  }

  if (invalid > 0) {
    const invalidRefs = Object.entries(validation.results)
      .filter(([, r]) => r.status === "invalid")
      .map(([id]) => id);
    lines.push(`❌ 失效引用: ${invalidRefs.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 从 PARSABLE 文档备注文本中反向解析引用
 */
export function parseReferencesFromParsable(
  text: string,
): { references: ParsedReference[] } | undefined {
  if (!text.includes("📎 引用来源")) return undefined;

  const refSection = text.split("📎 引用来源")[1];
  const re = /- (.+?) "(.+?)" \((.+?)#(L\d+-\d+), hash: ([a-f0-9]+)\)/g;

  const references: ParsedReference[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(refSection)) !== null) {
    references.push({
      type: m[1].trim(),
      path: m[2].trim(),
      document: m[3].trim(),
      lineInfo: m[4].trim(),
      hash: m[5].trim(),
    });
  }

  return references.length > 0 ? { references } : undefined;
}
