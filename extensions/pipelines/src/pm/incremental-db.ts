/**
 * 增量修改数据库
 *
 * 在 PMDatabase 基础上扩展 3 张表：projects、version_snapshots、change_records。
 * 支持需求/架构版本追踪、变更记录、影响分析。
 *
 * 与 OpenSpec 文件系统的关联：
 * - projects.project_root → 文件系统根目录
 * - change_records.change_dir → openspec/changes/{change_name}/
 * - version_snapshots.proposal_path → openspec proposal.md 路径
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ModuleDefinition,
  InterfaceDefinition,
  EntityDefinition,
  ApiEndpointDefinition,
  DomainDefinition,
  ArchitectureSnapshot,
  RequirementSnapshotSummary,
  ImpactSummary,
} from "../workflows/states.js";

// ============================================================================
// Types
// ============================================================================

export interface ProjectData {
  id: string;
  name: string;
  projectRoot: string;
  openspecSchema: string;
  currentVersion: number;
  scenario: "new_project" | "modify_existing";
  createdAt?: string;
  updatedAt?: string;
}

export type SnapshotType = "requirement" | "architecture";

// Re-export shared types from states.ts for convenience
export type {
  ArchitectureSnapshot,
  RequirementSnapshotSummary,
  ImpactSummary,
} from "../workflows/states.js";

export interface VersionSnapshotData {
  id?: number;
  projectId: string;
  version: number;
  snapshotType: SnapshotType;
  contentHash: string;
  /** OpenSpec proposal.md 路径 */
  proposalPath?: string;
  /** 需求摘要 */
  requirementSummary?: RequirementSnapshotSummary;
  /** 完整架构状态 */
  architectureJson?: ArchitectureSnapshot;
  /** OpenSpec design.md 路径 */
  designPath?: string;
  /** OpenSpec tasks.md 路径 */
  tasksPath?: string;
  /** OpenSpec spec 文件路径列表 */
  specPaths?: string[];
  createdAt?: string;
}

export type ChangeStatus = "pending" | "designing" | "ready" | "applied" | "failed";

export interface DeltaSummary {
  added: Array<{ type: string; id: string; description: string }>;
  modified: Array<{ type: string; id: string; description: string; changes: string }>;
  removed: Array<{ type: string; id: string; reason: string }>;
  renamed: Array<{ type: string; from: string; to: string }>;
}

export interface ChangeRecordData {
  id?: number;
  projectId: string;
  changeName: string;
  changeDir?: string;
  versionBefore: number;
  versionAfter?: number;
  status: ChangeStatus;
  changeDescription?: string;
  impactSummary?: ImpactSummary;
  deltaSummary?: DeltaSummary;
  requirementSnapshotId?: number;
  architectureSnapshotId?: number;
  createdAt?: string;
  appliedAt?: string;
}

// ============================================================================
// SQL Schema
// ============================================================================

const INCREMENTAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	project_root TEXT NOT NULL UNIQUE,
	openspec_schema TEXT DEFAULT 'spec-driven',
	current_version INTEGER DEFAULT 0,
	scenario TEXT DEFAULT 'new_project',
	created_at TEXT DEFAULT (datetime('now')),
	updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS version_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	snapshot_type TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	proposal_path TEXT,
	requirement_summary TEXT,
	architecture_json TEXT,
	design_path TEXT,
	tasks_path TEXT,
	spec_paths TEXT,
	created_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (project_id) REFERENCES projects(id),
	UNIQUE(project_id, version, snapshot_type)
);

CREATE TABLE IF NOT EXISTS change_records (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL,
	change_name TEXT NOT NULL,
	change_dir TEXT,
	version_before INTEGER NOT NULL,
	version_after INTEGER,
	status TEXT DEFAULT 'pending',
	change_description TEXT,
	impact_summary TEXT,
	delta_summary TEXT,
	requirement_snapshot_id INTEGER,
	architecture_snapshot_id INTEGER,
	created_at TEXT DEFAULT (datetime('now')),
	applied_at TEXT,
	FOREIGN KEY (project_id) REFERENCES projects(id),
	FOREIGN KEY (requirement_snapshot_id) REFERENCES version_snapshots(id),
	FOREIGN KEY (architecture_snapshot_id) REFERENCES version_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project_version
	ON version_snapshots(project_id, version);
CREATE INDEX IF NOT EXISTS idx_snapshots_type
	ON version_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_changes_project
	ON change_records(project_id);
CREATE INDEX IF NOT EXISTS idx_changes_status
	ON change_records(status);
CREATE INDEX IF NOT EXISTS idx_changes_name
	ON change_records(project_id, change_name);
`;

// ============================================================================
// IncrementalDB
// ============================================================================

export class IncrementalDB {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(INCREMENTAL_SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ========================================================================
  // Projects
  // ========================================================================

  createProject(data: Omit<ProjectData, "createdAt" | "updatedAt">): ProjectData {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, project_root, openspec_schema, current_version, scenario, created_at, updated_at)
			VALUES (@id, @name, @projectRoot, @openspecSchema, @currentVersion, @scenario, @createdAt, @updatedAt)`,
      )
      .run({
        id: data.id,
        name: data.name,
        projectRoot: data.projectRoot,
        openspecSchema: data.openspecSchema ?? "spec-driven",
        currentVersion: data.currentVersion ?? 0,
        scenario: data.scenario ?? "new_project",
        createdAt: now,
        updatedAt: now,
      });
    return this.getProject(data.id)!;
  }

  getProject(projectId: string): ProjectData | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToProject(row) : undefined;
  }

  getProjectByRoot(projectRoot: string): ProjectData | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE project_root = ?").get(projectRoot) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToProject(row) : undefined;
  }

  /**
   * 获取或创建项目。如果项目不存在，自动创建。
   */
  getOrCreateProject(projectRoot: string, name?: string): ProjectData {
    const existing = this.getProjectByRoot(projectRoot);
    if (existing) return existing;

    const id = `proj_${crypto.randomUUID().slice(0, 8)}`;
    return this.createProject({
      id,
      name: name ?? path.basename(projectRoot),
      projectRoot,
      openspecSchema: "spec-driven",
      currentVersion: 0,
      scenario: "new_project",
    });
  }

  updateProjectVersion(projectId: string, version: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ?")
      .run(version, now, projectId);
  }

  updateProjectScenario(projectId: string, scenario: "new_project" | "modify_existing"): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE projects SET scenario = ?, updated_at = ? WHERE id = ?")
      .run(scenario, now, projectId);
  }

  listProjects(): ProjectData[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToProject(r));
  }

  // ========================================================================
  // Version Snapshots
  // ========================================================================

  createSnapshot(data: Omit<VersionSnapshotData, "id" | "createdAt">): VersionSnapshotData {
    const result = this.db
      .prepare(
        `INSERT INTO version_snapshots (
				project_id, version, snapshot_type, content_hash,
				proposal_path, requirement_summary, architecture_json,
				design_path, tasks_path, spec_paths
			) VALUES (
				@projectId, @version, @snapshotType, @contentHash,
				@proposalPath, @requirementSummary, @architectureJson,
				@designPath, @tasksPath, @specPaths
			)`,
      )
      .run({
        projectId: data.projectId,
        version: data.version,
        snapshotType: data.snapshotType,
        contentHash: data.contentHash,
        proposalPath: data.proposalPath ?? null,
        requirementSummary: data.requirementSummary
          ? JSON.stringify(data.requirementSummary)
          : null,
        architectureJson: data.architectureJson ? JSON.stringify(data.architectureJson) : null,
        designPath: data.designPath ?? null,
        tasksPath: data.tasksPath ?? null,
        specPaths: data.specPaths ? JSON.stringify(data.specPaths) : null,
      });
    return this.getSnapshot(Number(result.lastInsertRowid))!;
  }

  getSnapshot(id: number): VersionSnapshotData | undefined {
    const row = this.db.prepare("SELECT * FROM version_snapshots WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToSnapshot(row) : undefined;
  }

  getLatestSnapshot(projectId: string, type: SnapshotType): VersionSnapshotData | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM version_snapshots
			WHERE project_id = ? AND snapshot_type = ?
			ORDER BY version DESC LIMIT 1`,
      )
      .get(projectId, type) as Record<string, unknown> | undefined;
    return row ? this.rowToSnapshot(row) : undefined;
  }

  getSnapshotsByVersion(projectId: string, version: number): VersionSnapshotData[] {
    const rows = this.db
      .prepare("SELECT * FROM version_snapshots WHERE project_id = ? AND version = ?")
      .all(projectId, version) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSnapshot(r));
  }

  getSnapshotHistory(projectId: string, type: SnapshotType, limit = 20): VersionSnapshotData[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM version_snapshots
			WHERE project_id = ? AND snapshot_type = ?
			ORDER BY version DESC LIMIT ?`,
      )
      .all(projectId, type, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSnapshot(r));
  }

  // ========================================================================
  // Change Records
  // ========================================================================

  createChangeRecord(data: Omit<ChangeRecordData, "id" | "createdAt">): ChangeRecordData {
    const result = this.db
      .prepare(
        `INSERT INTO change_records (
				project_id, change_name, change_dir,
				version_before, version_after, status,
				change_description, impact_summary, delta_summary,
				requirement_snapshot_id, architecture_snapshot_id
			) VALUES (
				@projectId, @changeName, @changeDir,
				@versionBefore, @versionAfter, @status,
				@changeDescription, @impactSummary, @deltaSummary,
				@requirementSnapshotId, @architectureSnapshotId
			)`,
      )
      .run({
        projectId: data.projectId,
        changeName: data.changeName,
        changeDir: data.changeDir ?? null,
        versionBefore: data.versionBefore,
        versionAfter: data.versionAfter ?? null,
        status: data.status ?? "pending",
        changeDescription: data.changeDescription ?? null,
        impactSummary: data.impactSummary ? JSON.stringify(data.impactSummary) : null,
        deltaSummary: data.deltaSummary ? JSON.stringify(data.deltaSummary) : null,
        requirementSnapshotId: data.requirementSnapshotId ?? null,
        architectureSnapshotId: data.architectureSnapshotId ?? null,
      });
    return this.getChangeRecord(Number(result.lastInsertRowid))!;
  }

  getChangeRecord(id: number): ChangeRecordData | undefined {
    const row = this.db.prepare("SELECT * FROM change_records WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToChange(row) : undefined;
  }

  getChangeByName(projectId: string, changeName: string): ChangeRecordData | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM change_records WHERE project_id = ? AND change_name = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, changeName) as Record<string, unknown> | undefined;
    return row ? this.rowToChange(row) : undefined;
  }

  updateChangeStatus(id: number, status: ChangeStatus, versionAfter?: number): void {
    const updates = ["status = ?"];
    const params: (string | number)[] = [status];

    if (versionAfter !== undefined) {
      updates.push("version_after = ?");
      params.push(versionAfter);
    }
    if (status === "applied") {
      updates.push("applied_at = datetime('now')");
    }

    params.push(id);
    this.db.prepare(`UPDATE change_records SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  updateChangeImpact(id: number, impact: ImpactSummary): void {
    this.db
      .prepare("UPDATE change_records SET impact_summary = ? WHERE id = ?")
      .run(JSON.stringify(impact), id);
  }

  updateChangeDelta(id: number, delta: DeltaSummary): void {
    this.db
      .prepare("UPDATE change_records SET delta_summary = ? WHERE id = ?")
      .run(JSON.stringify(delta), id);
  }

  updateChangeSnapshots(id: number, reqSnapshotId?: number, archSnapshotId?: number): void {
    const updates: string[] = [];
    const params: number[] = [];

    if (reqSnapshotId !== undefined) {
      updates.push("requirement_snapshot_id = ?");
      params.push(reqSnapshotId);
    }
    if (archSnapshotId !== undefined) {
      updates.push("architecture_snapshot_id = ?");
      params.push(archSnapshotId);
    }
    if (updates.length === 0) return;

    params.push(id);
    this.db.prepare(`UPDATE change_records SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  getActiveChanges(projectId: string): ChangeRecordData[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM change_records
			WHERE project_id = ? AND status NOT IN ('applied', 'failed')
			ORDER BY created_at DESC`,
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChange(r));
  }

  getChangeHistory(projectId: string, limit = 20): ChangeRecordData[] {
    const rows = this.db
      .prepare("SELECT * FROM change_records WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChange(r));
  }

  // ========================================================================
  // Utility: Content Hash
  // ========================================================================

  /**
   * 计算内容的 SHA256 哈希，用于变更检测。
   */
  static contentHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  // ========================================================================
  // Row Mapping Helpers
  // ========================================================================

  private rowToProject(row: Record<string, unknown>): ProjectData {
    return {
      id: row.id as string,
      name: row.name as string,
      projectRoot: row.project_root as string,
      openspecSchema: (row.openspec_schema as string) ?? "spec-driven",
      currentVersion: (row.current_version as number) ?? 0,
      scenario: (row.scenario as ProjectData["scenario"]) ?? "new_project",
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }

  private rowToSnapshot(row: Record<string, unknown>): VersionSnapshotData {
    return {
      id: row.id as number,
      projectId: row.project_id as string,
      version: row.version as number,
      snapshotType: row.snapshot_type as SnapshotType,
      contentHash: row.content_hash as string,
      proposalPath: row.proposal_path as string | undefined,
      requirementSummary: row.requirement_summary
        ? (JSON.parse(row.requirement_summary as string) as RequirementSnapshotSummary)
        : undefined,
      architectureJson: row.architecture_json
        ? (JSON.parse(row.architecture_json as string) as ArchitectureSnapshot)
        : undefined,
      designPath: row.design_path as string | undefined,
      tasksPath: row.tasks_path as string | undefined,
      specPaths: row.spec_paths ? (JSON.parse(row.spec_paths as string) as string[]) : undefined,
      createdAt: row.created_at as string | undefined,
    };
  }

  private rowToChange(row: Record<string, unknown>): ChangeRecordData {
    return {
      id: row.id as number,
      projectId: row.project_id as string,
      changeName: row.change_name as string,
      changeDir: row.change_dir as string | undefined,
      versionBefore: row.version_before as number,
      versionAfter: row.version_after as number | undefined,
      status: (row.status as ChangeStatus) ?? "pending",
      changeDescription: row.change_description as string | undefined,
      impactSummary: row.impact_summary
        ? (JSON.parse(row.impact_summary as string) as ImpactSummary)
        : undefined,
      deltaSummary: row.delta_summary
        ? (JSON.parse(row.delta_summary as string) as DeltaSummary)
        : undefined,
      requirementSnapshotId: row.requirement_snapshot_id as number | undefined,
      architectureSnapshotId: row.architecture_snapshot_id as number | undefined,
      createdAt: row.created_at as string | undefined,
      appliedAt: row.applied_at as string | undefined,
    };
  }
}
