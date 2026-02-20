/**
 * 语义头注入器 (Semantic Header Injector)
 *
 * 生成和管理代码文件的语义头部元数据 ([SEMANTIC_HEADER] YAML 块)。
 * 支持注入/提取/更新 TypeScript、Python、Markdown 文件的语义头。
 *
 * 语义头格式:
 * ```
 * [SEMANTIC_HEADER]
 * symid: FILE-src-agents-test
 * lastUpdated: '2026-01-27T03:00:00Z'
 * lifecycleStatus: stable
 * provenance:
 *   model: Claude 4.5 Sonnet
 *   generatedAt: '2026-01-27T03:00:00Z'
 * [/SEMANTIC_HEADER]
 * ```
 *
 * 源码参考: _personal_copilot/src/services/knowledge/semantic_header_injector.py
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface SemanticHeaderData {
  symid: string;
  semanticHash?: string;
  lastUpdated: string;
  lifecycleStatus: "experimental" | "stable" | "frozen" | "deprecated";
  terminologyCompliant?: boolean;
  provenance: {
    model: string;
    generatedAt: string;
    method?: string;
  };
  dependencies?: string[];
  description?: string;
  architectureMappings?: Array<{
    view: string;
    path: string;
    nodeName: string;
    matchReason: string;
  }>;
  [key: string]: unknown;
}

export interface InjectionResult {
  success: boolean;
  message: string;
  backupPath?: string;
}

// ============================================================================
// 序列化（简易 YAML，不依赖外部库）
// ============================================================================

function toSimpleYaml(data: Record<string, unknown>, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      lines.push(`${pad}${key}: '${value}'`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${pad}${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (typeof value[0] === "string") {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          lines.push(`${pad}- '${item}'`);
        }
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          const objLines = toSimpleYaml(item as Record<string, unknown>, indent + 1);
          const firstLine = objLines.split("\n")[0];
          lines.push(`${pad}- ${firstLine.trim()}`);
          for (const rest of objLines.split("\n").slice(1)) {
            lines.push(`${pad}  ${rest.trimStart() ? rest : ""}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(toSimpleYaml(value as Record<string, unknown>, indent + 1));
    }
  }

  return lines.join("\n");
}

function fromSimpleYaml(text: string): Record<string, unknown> {
  // 简单 YAML 解析器，覆盖语义头的子集
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentKey: string | undefined;
  let currentObj: Record<string, unknown> | undefined;
  let currentList: unknown[] | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // key: value
    const kvMatch = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (kvMatch && !line.startsWith("  ") && !line.startsWith("-")) {
      if (currentKey && currentObj) result[currentKey] = currentObj;
      if (currentKey && currentList) result[currentKey] = currentList;
      currentObj = undefined;
      currentList = undefined;
      const [, key, rawVal] = kvMatch;
      result[key] = parseYamlValue(rawVal);
      currentKey = key;
      continue;
    }

    // Top-level key with no value (start of object or list)
    const keyOnly = trimmed.match(/^(\w[\w_-]*)\s*:$/);
    if (keyOnly && !line.startsWith("  ")) {
      if (currentKey && currentObj) result[currentKey] = currentObj;
      if (currentKey && currentList) result[currentKey] = currentList;
      currentKey = keyOnly[1];
      currentObj = undefined;
      currentList = undefined;
      continue;
    }

    // Sub-key: value (nested object)
    const subKv = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (subKv && line.startsWith("  ") && currentKey && !trimmed.startsWith("-")) {
      if (!currentObj) currentObj = {};
      currentObj[subKv[1]] = parseYamlValue(subKv[2]);
      continue;
    }

    // List item: - value
    const listItem = trimmed.match(/^-\s+(.+)$/);
    if (listItem && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(parseYamlValue(listItem[1]));
      continue;
    }
  }

  if (currentKey && currentObj) result[currentKey] = currentObj;
  if (currentKey && currentList) result[currentKey] = currentList;

  return result;
}

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();
  // Quoted string
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

// ============================================================================
// SemanticHeaderInjector
// ============================================================================

const HEADER_RE = /\[SEMANTIC_HEADER\]\n([\s\S]*?)\[\/SEMANTIC_HEADER\]/;

export class SemanticHeaderInjector {
  /**
   * 生成语义头 YAML 字符串
   */
  generateSemanticHeader(opts: {
    symid: string;
    semanticHash?: string;
    lifecycleStatus?: "experimental" | "stable" | "frozen" | "deprecated";
    terminologyCompliant?: boolean;
    provenance?: { model: string; generatedAt: string; method?: string };
    dependencies?: string[];
    description?: string;
    [key: string]: unknown;
  }): string {
    const data: Record<string, unknown> = {
      symid: opts.symid,
      lastUpdated: new Date().toISOString(),
      lifecycleStatus: opts.lifecycleStatus ?? "stable",
    };

    if (opts.semanticHash) data.semanticHash = opts.semanticHash;
    if (opts.terminologyCompliant !== undefined)
      data.terminologyCompliant = opts.terminologyCompliant;

    data.provenance = opts.provenance ?? {
      model: "Claude 4.5 Sonnet",
      generatedAt: new Date().toISOString(),
    };

    if (opts.dependencies) data.dependencies = opts.dependencies;
    if (opts.description) data.description = opts.description;

    // 其他自定义字段
    for (const [k, v] of Object.entries(opts)) {
      if (
        ![
          "symid",
          "semanticHash",
          "lifecycleStatus",
          "terminologyCompliant",
          "provenance",
          "dependencies",
          "description",
        ].includes(k)
      ) {
        data[k] = v;
      }
    }

    const yaml = toSimpleYaml(data);
    return `[SEMANTIC_HEADER]\n${yaml}\n[/SEMANTIC_HEADER]`;
  }

  /**
   * 从文本内容中提取语义头
   */
  extractFromContent(content: string): SemanticHeaderData | undefined {
    const match = content.match(HEADER_RE);
    if (!match) return undefined;
    return fromSimpleYaml(match[1]) as unknown as SemanticHeaderData;
  }

  /**
   * 从文本中移除语义头块（用于 body hashing）
   */
  stripHeader(content: string): string {
    return content.replace(/\[SEMANTIC_HEADER\][\s\S]*?\[\/SEMANTIC_HEADER\]\n*/g, "");
  }

  /**
   * 在内容中注入或替换语义头
   *
   * - Markdown: 在 `position` 位置插入
   * - TypeScript/Python: 在文件顶部注释块后插入
   */
  injectIntoContent(content: string, header: string, position: "top" | "bottom" = "top"): string {
    // 移除旧的语义头
    const cleaned = content.replace(/\[SEMANTIC_HEADER\][\s\S]*?\[\/SEMANTIC_HEADER\]\n*/g, "");

    if (position === "bottom") {
      return `${cleaned.trimEnd()}\n\n${header}\n`;
    }

    return `${header}\n\n${cleaned.trimStart()}`;
  }

  /**
   * 更新已有语义头中的字段
   */
  updateInContent(content: string, updates: Partial<SemanticHeaderData>): string {
    const existing = this.extractFromContent(content);
    if (!existing) return content;

    const merged = { ...existing, ...updates, lastUpdated: new Date().toISOString() };
    const newHeader = this.generateSemanticHeader(
      merged as Parameters<SemanticHeaderInjector["generateSemanticHeader"]>[0],
    );

    return content.replace(/\[SEMANTIC_HEADER\][\s\S]*?\[\/SEMANTIC_HEADER\]/, newHeader);
  }
}
