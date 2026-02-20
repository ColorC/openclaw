/**
 * 项目文档管理器 (Project Documentation Manager)
 *
 * 管理项目文档、规范、进度跟踪和历史记录的文件系统存储层。
 *
 * 目录结构:
 * <projectRoot>/
 * ├── files/           # 文件文档 (README.md per file/directory)
 * ├── standards/       # 规范文档 + version.json
 * ├── progress/        # file_progress.json, file_history.json, checkpoint.json
 * ├── plans/           # 活跃/已完成计划
 * │   └── completed/
 * └── wiki/            # 项目 Wiki 页面
 *
 * 源码参考: _personal_copilot/src/services/knowledge/project_doc_manager.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 类型定义
// ============================================================================

export interface OperationResult<T = Record<string, unknown>> {
  success: boolean;
  message: string;
  data: T | null;
  error?: string;
}

export interface FileProgressEntry {
  status: "pending" | "in_progress" | "completed" | "skipped";
  gitCommit?: string;
  notes?: string;
  updatedAt: string;
}

export interface FileHistoryEntry {
  action: "analyzed" | "updated" | "created" | "deleted" | string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface PlanProgress {
  planName: string;
  totalTasks: number;
  completedTasks: number;
  updatedAt: string;
  details?: Record<string, unknown>;
}

export interface CheckpointData {
  lastFile?: string;
  lastAction?: string;
  progress: Record<string, unknown>;
  savedAt: string;
}

// ============================================================================
// ProjectDocManager
// ============================================================================

export class ProjectDocManager {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly filesDir: string;
  readonly standardsDir: string;
  readonly progressDir: string;
  readonly plansDir: string;
  readonly completedPlansDir: string;
  readonly wikiDir: string;

  constructor(opts: { projectName: string; projectRoot?: string; autoCreateDirs?: boolean }) {
    this.projectName = opts.projectName;
    this.projectRoot =
      opts.projectRoot ??
      path.join(process.cwd(), ".openclaw", "knowledge", "projects", opts.projectName);

    this.filesDir = path.join(this.projectRoot, "files");
    this.standardsDir = path.join(this.projectRoot, "standards");
    this.progressDir = path.join(this.projectRoot, "progress");
    this.plansDir = path.join(this.projectRoot, "plans");
    this.completedPlansDir = path.join(this.plansDir, "completed");
    this.wikiDir = path.join(this.projectRoot, "wiki");

    if (opts.autoCreateDirs !== false) {
      this.ensureDirectories();
    }
  }

  private ensureDirectories(): void {
    for (const dir of [
      this.filesDir,
      this.standardsDir,
      this.progressDir,
      this.plansDir,
      this.completedPlansDir,
      this.wikiDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ==================== 文件文档管理 ====================

  /** 保存文件文档 */
  saveFileDoc(
    filePath: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): OperationResult {
    const parsed = path.parse(filePath);
    const docDir = parsed.ext
      ? path.join(this.filesDir, parsed.dir, parsed.name)
      : path.join(this.filesDir, filePath);

    fs.mkdirSync(docDir, { recursive: true });

    const header = `---\nfile_path: ${filePath}\ngenerated_at: ${new Date().toISOString()}\n${
      metadata
        ? Object.entries(metadata)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n") + "\n"
        : ""
    }---\n\n`;
    fs.writeFileSync(path.join(docDir, "README.md"), header + content, "utf-8");

    return {
      success: true,
      message: `成功保存文件文档: ${filePath}`,
      data: { filePath, docPath: path.relative(this.projectRoot, path.join(docDir, "README.md")) },
    };
  }

  /** 获取文件文档 */
  getFileDoc(
    filePath: string,
  ): OperationResult<{ filePath: string; content: string; docPath: string }> {
    const parsed = path.parse(filePath);
    const docFile = parsed.ext
      ? path.join(this.filesDir, parsed.dir, parsed.name, "README.md")
      : path.join(this.filesDir, filePath, "README.md");

    if (!fs.existsSync(docFile)) {
      return {
        success: false,
        message: `文件文档不存在: ${filePath}`,
        data: null,
        error: "DocNotFound",
      };
    }

    return {
      success: true,
      message: `成功获取文件文档: ${filePath}`,
      data: {
        filePath,
        content: fs.readFileSync(docFile, "utf-8"),
        docPath: path.relative(this.projectRoot, docFile),
      },
    };
  }

  // ==================== 规范管理 ====================

  /** 保存规范文档 */
  saveStandard(standardName: string, content: string, version = "1.0"): OperationResult {
    const stdFile = path.join(this.standardsDir, `${standardName}.md`);
    fs.writeFileSync(stdFile, content, "utf-8");

    // 更新版本信息
    const versionFile = path.join(this.standardsDir, "version.json");
    const versions = fs.existsSync(versionFile)
      ? (JSON.parse(fs.readFileSync(versionFile, "utf-8")) as Record<string, unknown>)
      : {};
    versions[standardName] = { version, updatedAt: new Date().toISOString() };
    fs.writeFileSync(versionFile, JSON.stringify(versions, null, 2), "utf-8");

    return {
      success: true,
      message: `成功保存规范: ${standardName}`,
      data: { standardName, version },
    };
  }

  /** 获取规范文档 */
  getStandard(
    standardName: string,
  ): OperationResult<{ standardName: string; content: string; version: string }> {
    const stdFile = path.join(this.standardsDir, `${standardName}.md`);
    if (!fs.existsSync(stdFile)) {
      return {
        success: false,
        message: `规范不存在: ${standardName}`,
        data: null,
        error: "StandardNotFound",
      };
    }

    const content = fs.readFileSync(stdFile, "utf-8");
    const versionFile = path.join(this.standardsDir, "version.json");
    const vInfo = fs.existsSync(versionFile)
      ? (JSON.parse(fs.readFileSync(versionFile, "utf-8")) as Record<string, { version: string }>)[
          standardName
        ]
      : undefined;

    return {
      success: true,
      message: `成功获取规范: ${standardName}`,
      data: { standardName, content, version: vInfo?.version ?? "unknown" },
    };
  }

  // ==================== 进度管理 ====================

  /** 标记文件分析进度 */
  markFileProgress(
    filePath: string,
    status: FileProgressEntry["status"],
    gitCommit?: string,
    notes?: string,
  ): OperationResult {
    const progFile = path.join(this.progressDir, "file_progress.json");
    const data = this.readJson<Record<string, FileProgressEntry>>(progFile) ?? {};

    data[filePath] = { status, gitCommit, notes, updatedAt: new Date().toISOString() };

    this.writeJson(progFile, data);

    return {
      success: true,
      message: `标记文件进度: ${filePath} → ${status}`,
      data: { filePath, status },
    };
  }

  /** 获取文件分析进度 */
  getFileProgress(filePath?: string): OperationResult<Record<string, FileProgressEntry>> {
    const progFile = path.join(this.progressDir, "file_progress.json");
    const data = this.readJson<Record<string, FileProgressEntry>>(progFile) ?? {};

    if (filePath) {
      if (data[filePath]) {
        return {
          success: true,
          message: `进度: ${filePath}`,
          data: { [filePath]: data[filePath] },
        };
      }
      return {
        success: false,
        message: `进度不存在: ${filePath}`,
        data: null,
        error: "ProgressNotFound",
      };
    }

    return { success: true, message: `全部进度（${Object.keys(data).length}个文件）`, data };
  }

  /** 获取未标记的文件 */
  getUnmarkedFiles(allFiles: string[], limit = 10): string[] {
    const progFile = path.join(this.progressDir, "file_progress.json");
    const progress = this.readJson<Record<string, FileProgressEntry>>(progFile) ?? {};
    return allFiles.filter((f) => !(f in progress)).slice(0, limit);
  }

  // ==================== 历史管理 ====================

  /** 记录文件历史 */
  recordFileHistory(
    filePath: string,
    action: FileHistoryEntry["action"],
    details: Record<string, unknown> = {},
  ): OperationResult {
    const histFile = path.join(this.progressDir, "file_history.json");
    const data = this.readJson<Record<string, FileHistoryEntry[]>>(histFile) ?? {};

    if (!data[filePath]) data[filePath] = [];
    data[filePath].push({ action, details, timestamp: new Date().toISOString() });

    this.writeJson(histFile, data);

    return {
      success: true,
      message: `记录历史: ${filePath} - ${action}`,
      data: { filePath, action },
    };
  }

  /** 获取文件历史 */
  getFileHistory(filePath: string): FileHistoryEntry[] {
    const histFile = path.join(this.progressDir, "file_history.json");
    const data = this.readJson<Record<string, FileHistoryEntry[]>>(histFile) ?? {};
    return data[filePath] ?? [];
  }

  // ==================== 计划管理 ====================

  /** 保存计划 */
  savePlan(planName: string, content: string): OperationResult {
    const planFile = path.join(this.plansDir, `${planName}.md`);
    fs.writeFileSync(planFile, content, "utf-8");
    return { success: true, message: `保存计划: ${planName}`, data: { planName } };
  }

  /** 获取计划 */
  getPlan(planName: string): OperationResult<{ planName: string; content: string }> {
    const planFile = path.join(this.plansDir, `${planName}.md`);
    if (!fs.existsSync(planFile)) {
      return {
        success: false,
        message: `计划不存在: ${planName}`,
        data: null,
        error: "PlanNotFound",
      };
    }
    return {
      success: true,
      message: `获取计划: ${planName}`,
      data: { planName, content: fs.readFileSync(planFile, "utf-8") },
    };
  }

  /** 归档计划（移动到 completed/ 目录） */
  archivePlan(planName: string): OperationResult {
    const src = path.join(this.plansDir, `${planName}.md`);
    if (!fs.existsSync(src)) {
      return {
        success: false,
        message: `计划不存在: ${planName}`,
        data: null,
        error: "PlanNotFound",
      };
    }

    const dst = path.join(this.completedPlansDir, `${planName}_${Date.now()}.md`);
    fs.renameSync(src, dst);

    return {
      success: true,
      message: `归档计划: ${planName}`,
      data: { planName, archivedTo: path.relative(this.projectRoot, dst) },
    };
  }

  /** 更新计划进度 */
  updatePlanProgress(
    planName: string,
    progress: Omit<PlanProgress, "planName" | "updatedAt">,
  ): OperationResult {
    const progFile = path.join(this.plansDir, "plan_progress.json");
    const data = this.readJson<Record<string, PlanProgress>>(progFile) ?? {};

    data[planName] = { planName, ...progress, updatedAt: new Date().toISOString() };
    this.writeJson(progFile, data);

    return { success: true, message: `更新计划进度: ${planName}`, data: data[planName] };
  }

  // ==================== Checkpoint（断点续做） ====================

  /** 保存 checkpoint */
  saveCheckpoint(checkpoint: Omit<CheckpointData, "savedAt">): OperationResult {
    const cpFile = path.join(this.progressDir, "checkpoint.json");
    this.writeJson(cpFile, { ...checkpoint, savedAt: new Date().toISOString() });
    return {
      success: true,
      message: "Checkpoint 已保存",
      data: { savedAt: new Date().toISOString() },
    };
  }

  /** 加载 checkpoint */
  loadCheckpoint(): CheckpointData | undefined {
    const cpFile = path.join(this.progressDir, "checkpoint.json");
    return this.readJson<CheckpointData>(cpFile) ?? undefined;
  }

  // ==================== Wiki ====================

  /** 保存 Wiki 页面 */
  saveWikiPage(pageName: string, content: string): OperationResult {
    fs.writeFileSync(path.join(this.wikiDir, `${pageName}.md`), content, "utf-8");
    return { success: true, message: `保存 Wiki: ${pageName}`, data: { pageName } };
  }

  /** 获取 Wiki 页面 */
  getWikiPage(pageName: string): string | undefined {
    const file = path.join(this.wikiDir, `${pageName}.md`);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
  }

  /** 列出所有 Wiki 页面 */
  listWikiPages(): string[] {
    if (!fs.existsSync(this.wikiDir)) return [];
    return fs
      .readdirSync(this.wikiDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  }

  // ==================== 内部工具 ====================

  private readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  private writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
