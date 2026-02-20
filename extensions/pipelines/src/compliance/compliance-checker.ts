/**
 * 架构合规检查器
 *
 * 静态分析项目结构和代码，检查是否违反架构规范。
 * 支持多个规则维度：目录结构、工具框架、LLM 访问控制等。
 *
 * 源码参考：_personal_copilot/src/services/compliance/compliance_checker.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 类型定义
// ============================================================================

export type Severity = "CRITICAL" | "ERROR" | "WARNING" | "INFO";

export interface Violation {
  severity: Severity;
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export interface ComplianceReport {
  violations: Violation[];
  filesScanned: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  passed: boolean;
}

export type CheckType = "all" | "structure" | "infra" | "tool" | "workflow";

export interface ComplianceRule {
  id: string;
  name: string;
  severity: Severity;
  checkType: CheckType;
  check: (filePath: string, content: string, relPath: string) => Violation[];
}

// ============================================================================
// 配置常量
// ============================================================================

/** src/ 允许的顶级目录 */
const ALLOWED_TOP_DIRS = new Set([
  "core",
  "agents",
  "workflows",
  "tools",
  "services",
  "models",
  "interfaces",
  "shared",
  "skills",
  "utils",
  "addons",
  "pipelines",
]);

/** src/ 禁止的目录 */
const FORBIDDEN_TOP_DIRS: Record<string, string> = {
  data: "Runtime data should be in repository root data/",
  tests: "Test code should be in repository root tests/",
};

/** LLM SDK 直接导入白名单 */
const LLM_SDK_WHITELIST = new Set([
  "src/services/llm",
  "src/services/clients",
  "src/interfaces/adapters",
  "src/core/telemetry",
]);

/** StateGraph 定义白名单 */
const WORKFLOW_GRAPH_WHITELIST = new Set(["src/workflows", "src/pipelines"]);

/** utils 文件数量上限 */
const UTILS_MAX_FILES = 10;

// ============================================================================
// 规则实现
// ============================================================================

/** RULE-INFRA-001: LLM SDK 直接访问检查 */
function checkLlmBypass(filePath: string, content: string, relPath: string): Violation[] {
  const violations: Violation[] = [];

  // 检查是否在白名单目录
  const inWhitelist = Array.from(LLM_SDK_WHITELIST).some((dir) => relPath.startsWith(dir));
  if (inWhitelist) return violations;

  const llmPatterns = [
    /import\s+.*from\s+['"]openai['"]/,
    /import\s+.*from\s+['"]anthropic['"]/,
    /import\s+.*from\s+['"]@anthropic-ai\/sdk['"]/,
    /require\s*\(\s*['"]openai['"]\s*\)/,
    /require\s*\(\s*['"]anthropic['"]\s*\)/,
  ];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of llmPatterns) {
      if (pattern.test(lines[i])) {
        violations.push({
          severity: "ERROR",
          rule: "RULE-INFRA-001",
          file: relPath,
          line: i + 1,
          message: `Direct LLM SDK import detected. Use the centralized LLM service instead.`,
        });
      }
    }
  }

  return violations;
}

/** RULE-INFRA-003: Workflow 定义位置检查 */
function checkWorkflowLocation(filePath: string, content: string, relPath: string): Violation[] {
  const violations: Violation[] = [];

  const inWhitelist = Array.from(WORKFLOW_GRAPH_WHITELIST).some((dir) => relPath.startsWith(dir));
  if (inWhitelist) return violations;

  const patterns = [/new\s+StateGraph\s*\(/, /StateGraph\.from/, /createWorkflowGraph\s*\(/];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) {
        violations.push({
          severity: "WARNING",
          rule: "RULE-INFRA-003",
          file: relPath,
          line: i + 1,
          message: `Workflow graph definition should be in src/workflows/ or src/pipelines/`,
        });
      }
    }
  }

  return violations;
}

/** RULE-INFRA-005: Logging 绕过检查 */
function checkLoggingBypass(filePath: string, content: string, relPath: string): Violation[] {
  const violations: Violation[] = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /console\.(log|warn|error|debug)\s*\(/.test(lines[i]) &&
      !/\/\//.test(lines[i].split("console")[0])
    ) {
      violations.push({
        severity: "INFO",
        rule: "RULE-INFRA-005",
        file: relPath,
        line: i + 1,
        message: "Direct console usage detected. Use the logger service instead.",
      });
    }
  }

  return violations;
}

// ============================================================================
// ComplianceChecker
// ============================================================================

export class ComplianceChecker {
  private projectRoot: string;
  private customRules: ComplianceRule[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * 注册自定义规则
   */
  registerRule(rule: ComplianceRule): void {
    this.customRules.push(rule);
  }

  /**
   * 运行合规检查
   */
  run(options?: { checkType?: CheckType; targetFile?: string; quick?: boolean }): ComplianceReport {
    const { checkType = "all", targetFile, quick = false } = options ?? {};
    const violations: Violation[] = [];
    let filesScanned = 0;

    if (targetFile) {
      // 检查单个文件
      const fullPath = path.resolve(this.projectRoot, targetFile);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath, "utf-8");
        violations.push(...this.checkFile(fullPath, content, targetFile, checkType, quick));
        filesScanned = 1;
      }
    } else {
      // 检查目录结构
      if (checkType === "all" || checkType === "structure") {
        violations.push(...this.checkDirStructure());
      }

      // 扫描所有 .ts/.js 文件
      const srcDir = path.join(this.projectRoot, "src");
      if (fs.existsSync(srcDir)) {
        const files = this.walkDir(srcDir, [".ts", ".js"]);
        for (const file of files) {
          const relPath = path.relative(this.projectRoot, file);
          const content = fs.readFileSync(file, "utf-8");
          violations.push(...this.checkFile(file, content, relPath, checkType, quick));
          filesScanned++;
        }
      }
    }

    // 执行自定义规则
    if (!targetFile) {
      for (const rule of this.customRules) {
        if (checkType !== "all" && rule.checkType !== checkType) continue;
        if (quick && rule.severity !== "CRITICAL") continue;

        const srcDir = path.join(this.projectRoot, "src");
        if (fs.existsSync(srcDir)) {
          const files = this.walkDir(srcDir, [".ts", ".js"]);
          for (const file of files) {
            const relPath = path.relative(this.projectRoot, file);
            const content = fs.readFileSync(file, "utf-8");
            violations.push(...rule.check(file, content, relPath));
          }
        }
      }
    }

    const criticalCount = violations.filter((v) => v.severity === "CRITICAL").length;
    const errorCount = violations.filter((v) => v.severity === "ERROR").length;
    const warningCount = violations.filter((v) => v.severity === "WARNING").length;
    const infoCount = violations.filter((v) => v.severity === "INFO").length;

    return {
      violations,
      filesScanned,
      criticalCount,
      errorCount,
      warningCount,
      infoCount,
      passed: criticalCount === 0 && errorCount === 0,
    };
  }

  /**
   * 格式化报告为文本
   */
  formatReport(report: ComplianceReport): string {
    const lines: string[] = [
      `Compliance Report`,
      `  Files scanned: ${report.filesScanned}`,
      `  CRITICAL: ${report.criticalCount}  ERROR: ${report.errorCount}  WARNING: ${report.warningCount}  INFO: ${report.infoCount}`,
      `  Result: ${report.passed ? "PASSED" : "FAILED"}`,
      "",
    ];

    if (report.violations.length > 0) {
      lines.push("Violations:");
      for (const v of report.violations) {
        const loc = v.line ? `${v.file}:${v.line}` : v.file;
        lines.push(`  [${v.severity}] ${v.rule} ${loc}: ${v.message}`);
      }
    }

    return lines.join("\n");
  }

  // ========================================================================
  // 内部方法
  // ========================================================================

  private checkFile(
    filePath: string,
    content: string,
    relPath: string,
    checkType: CheckType,
    quick: boolean,
  ): Violation[] {
    const violations: Violation[] = [];

    if (checkType === "all" || checkType === "infra") {
      violations.push(...checkLlmBypass(filePath, content, relPath));
      violations.push(...checkWorkflowLocation(filePath, content, relPath));
      if (!quick) {
        violations.push(...checkLoggingBypass(filePath, content, relPath));
      }
    }

    return violations;
  }

  private checkDirStructure(): Violation[] {
    const violations: Violation[] = [];
    const srcDir = path.join(this.projectRoot, "src");

    if (!fs.existsSync(srcDir)) return violations;

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;

      // 检查禁止的目录
      if (dirName in FORBIDDEN_TOP_DIRS) {
        violations.push({
          severity: "ERROR",
          rule: "RULE-STRUCT-001",
          file: `src/${dirName}/`,
          message: `Forbidden directory: ${FORBIDDEN_TOP_DIRS[dirName]}`,
        });
      }

      // 检查未知目录
      if (!ALLOWED_TOP_DIRS.has(dirName) && !(dirName in FORBIDDEN_TOP_DIRS)) {
        violations.push({
          severity: "WARNING",
          rule: "RULE-STRUCT-002",
          file: `src/${dirName}/`,
          message: `Unknown top-level directory. Allowed: ${Array.from(ALLOWED_TOP_DIRS).join(", ")}`,
        });
      }
    }

    // 检查 utils 膨胀
    const utilsDir = path.join(srcDir, "utils");
    if (fs.existsSync(utilsDir)) {
      const utilsFiles = this.walkDir(utilsDir, [".ts", ".js"]);
      if (utilsFiles.length > UTILS_MAX_FILES) {
        violations.push({
          severity: "WARNING",
          rule: "RULE-STRUCT-003",
          file: "src/utils/",
          message: `Utils has ${utilsFiles.length} files (limit: ${UTILS_MAX_FILES}). Consider refactoring.`,
        });
      }
    }

    return violations;
  }

  private walkDir(dir: string, extensions: string[]): string[] {
    const results: string[] = [];

    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        results.push(...this.walkDir(fullPath, extensions));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }
}
