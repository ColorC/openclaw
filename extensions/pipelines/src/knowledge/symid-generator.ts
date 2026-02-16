/**
 * 稳定语义标识（Symid）生成器
 *
 * 为文件、类、函数、子流程生成稳定的语义标识符。
 * symid 是项目语义治理的核心坐标系，确保重命名/重构后仍能追踪同一语义实体。
 *
 * 格式:
 * - 文件: FILE-src-agents-project_analyze_agent
 * - 类:   CLASS-FILE-src-agents-test-MyClass
 * - 函数: FUNC-CLASS-...-MyClass-process-a1b2c3d4
 * - 子流程: SUBFLOW-FUNC-...-process-a1b2c3d4-file_scan
 *
 * 源码参考: _personal_copilot/src/services/knowledge/symid_generator.py
 */

import { createHash } from "node:crypto";
import * as path from "node:path";

export type SymidType = "FILE" | "CLASS" | "FUNC" | "SUBFLOW" | "UNKNOWN";

export interface ParsedSymid {
  type: SymidType;
  parentType?: SymidType | null;
  path?: string;
  name?: string;
  hash?: string | null;
  error?: string;
}

export class SymidGenerator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /** 生成文件级 symid: `FILE-src-agents-project_analyze_agent` */
  generateFileSymid(filePath: string): string {
    let relPath: string;
    if (path.isAbsolute(filePath)) {
      relPath = path.relative(this.projectRoot, filePath);
    } else {
      relPath = filePath;
    }
    return `FILE-${SymidGenerator.normalizePath(relPath)}`;
  }

  /** 生成类级 symid: `CLASS-FILE-...-ClassName` */
  generateClassSymid(fileSymid: string, className: string): string {
    if (!fileSymid.startsWith("FILE-")) {
      throw new Error(`Invalid file_symid: ${fileSymid}`);
    }
    if (!className) {
      throw new Error("className cannot be empty");
    }
    return `CLASS-${fileSymid}-${className}`;
  }

  /** 生成函数级 symid: `FUNC-...-func_name[-hash8]` */
  generateFuncSymid(parentSymid: string, funcName: string, includeHash = true): string {
    if (!parentSymid.startsWith("FILE-") && !parentSymid.startsWith("CLASS-")) {
      throw new Error(`Invalid parent_symid: ${parentSymid}`);
    }
    if (!funcName) {
      throw new Error("funcName cannot be empty");
    }
    const base = `FUNC-${parentSymid}-${funcName}`;
    if (includeHash) {
      return `${base}-${SymidGenerator.shortHash(base)}`;
    }
    return base;
  }

  /** 生成子流程 symid: `SUBFLOW-FUNC-...-subflow_name` */
  generateSubflowSymid(funcSymid: string, subflowName: string): string {
    if (!funcSymid.startsWith("FUNC-")) {
      throw new Error(`Invalid func_symid: ${funcSymid}`);
    }
    if (!subflowName) {
      throw new Error("subflowName cannot be empty");
    }
    return `SUBFLOW-${funcSymid}-${subflowName}`;
  }

  /**
   * 标准化路径为 symid 格式
   *
   * 规则: 反斜杠→正斜杠, 移除扩展名, 特殊字符→连字符, 转小写
   */
  static normalizePath(p: string): string {
    let normalized = p.replace(/\\/g, "/");

    // 移除最后的文件扩展名
    const lastDotIdx = normalized.lastIndexOf(".");
    if (lastDotIdx > 0 && !normalized.substring(lastDotIdx).includes("/")) {
      normalized = normalized.substring(0, lastDotIdx);
    }

    // 特殊字符替换
    normalized = normalized.replace(/\//g, "-").replace(/\./g, "-");
    normalized = normalized.replace(/[^a-zA-Z0-9\-_]/g, "-");

    // 去重连字符、去首尾
    normalized = normalized.replace(/-+/g, "-").replace(/^-|-$/g, "");

    return normalized.toLowerCase();
  }

  /** SHA256 短哈希 */
  static shortHash(content: string, length = 8): string {
    return createHash("sha256").update(content).digest("hex").slice(0, length);
  }

  /** 解析 symid 为结构化信息 */
  parseSymid(symid: string): ParsedSymid {
    const parts = symid.split("-");
    if (parts.length === 0) {
      return { type: "UNKNOWN", error: "Empty symid" };
    }

    const type = parts[0] as SymidType;

    switch (type) {
      case "FILE":
        return { type: "FILE", path: parts.slice(1).join("-"), parentType: null };

      case "CLASS":
        if (parts.length < 3) return { type: "CLASS", error: "Invalid CLASS symid" };
        return { type: "CLASS", parentType: "FILE", name: parts[parts.length - 1] };

      case "FUNC": {
        if (parts.length < 3) return { type: "FUNC", error: "Invalid FUNC symid" };
        const last = parts[parts.length - 1];
        const hasHash = last.length === 8 && /^[0-9a-f]+$/.test(last);
        return {
          type: "FUNC",
          parentType: (parts[1] as SymidType) ?? null,
          name: hasHash ? parts[parts.length - 2] : last,
          hash: hasHash ? last : null,
        };
      }

      case "SUBFLOW":
        if (parts.length < 3) return { type: "SUBFLOW", error: "Invalid SUBFLOW symid" };
        return { type: "SUBFLOW", parentType: "FUNC", name: parts[parts.length - 1] };

      default:
        return { type: "UNKNOWN", error: `Unknown symid type: ${type}` };
    }
  }
}
