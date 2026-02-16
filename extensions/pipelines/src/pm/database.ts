/**
 * PM 数据库服务
 *
 * SQLite 数据库，管理需求、依赖、争议历史、性能指标等。
 * 对应 Python 版 PMDatabase，所有任务统一存储在 requirements 表。
 *
 * 源码参考：_personal_copilot/src/services/pm/database.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

// ============================================================================
// 类型定义
// ============================================================================

export type RequirementStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "argued"
  | "blocked"
  | "failed"
  | "cancelled";
export type Priority = "critical" | "high" | "medium" | "low";
export type DependencyType = "blocking" | "related" | "optional";
export type ExecutorType = "user" | "claude_code" | "internal";
export type FeatureType = "mature" | "innovative" | "mixed";
export type CommentType = "general" | "question" | "suggestion" | "issue" | "resolution";
export type ArgueType = "intra_workflow" | "cross_workflow";
export type ArgueResolution =
  | "jump_to_node"
  | "reschedule_requirement"
  | "arbitration_needed"
  | "escalate_to_user";

export interface InvestScore {
  independent?: number;
  negotiable?: number;
  valuable?: number;
  estimable?: number;
  small?: number;
  testable?: number;
}

export interface AcceptanceCriterion {
  criterion: string;
  status: "pending" | "passed" | "failed";
}

export interface RequirementData {
  id: string;
  parentId?: string;
  documentId?: string;
  description: string;
  category?: string;
  workflowTemplate?: string;
  investScore?: InvestScore;
  acceptanceCriteria?: AcceptanceCriterion[];
  status: RequirementStatus;
  assignedAgent?: string;
  priority: Priority;
  reporter?: string;
  startTime?: string;
  endTime?: string;
  totalTokens?: number;
  argueCount?: number;
  qualityScore?: number;
  estimate?: number;
  estimateUnit?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  queuePosition?: number;
  executorType?: ExecutorType;
  executorConfig?: Record<string, unknown>;
  executionResult?: Record<string, unknown>;
  executionError?: string;
  executionTimeSeconds?: number;
  projectId?: string;
  sourceFile?: string;
  featureType?: FeatureType;
  stage?: number;
  referenceProject?: string;
  anchorStandard?: string;
  requirementSourceId?: string;
  gitCommits?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DependencyData {
  id?: number;
  sourceRequirementId: string;
  targetRequirementId: string;
  dependencyType: DependencyType;
  createdAt?: string;
}

export interface ArgumentData {
  id?: number;
  argueType: ArgueType;
  sourceRequirementId: string;
  targetRequirementId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  argueReason: string;
  resolution?: ArgueResolution;
  resolutionDetails?: Record<string, unknown>;
  createdAt?: string;
}

export interface PerformanceMetric {
  id?: number;
  requirementId: string;
  workflowName: string;
  agentName: string;
  executionTimeSeconds?: number;
  totalTokens?: number;
  llmCallsCount?: number;
  qualityScore?: number;
  testCoverage?: number;
  reviewPassed?: boolean;
  argueCount?: number;
  circuitBreakerTriggered?: boolean;
  createdAt?: string;
}

export interface DocumentData {
  documentId: string;
  filePath: string;
  fileName: string;
  documentHash: string;
  title?: string;
  format?: "PARSABLE" | "MINIMAL" | "HUMAN_READABLE" | "UNKNOWN";
  totalTasks?: number;
  completedTasks?: number;
  docCreatedAt?: string;
  docUpdatedAt?: string;
  docStatus?: string;
  sourceDir?: string;
  importedAt?: string;
  lastCheckedAt?: string;
  isModified?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CommentData {
  id?: number;
  requirementId: string;
  comment: string;
  author: string;
  commentType: CommentType;
  parentCommentId?: number;
  isResolved?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// SQL Schema
// ============================================================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS requirements (
	id TEXT PRIMARY KEY,
	parent_id TEXT,
	document_id TEXT,
	description TEXT NOT NULL,
	category TEXT,
	workflow_template TEXT,
	invest_score TEXT,
	acceptance_criteria TEXT,
	status TEXT DEFAULT 'pending',
	assigned_agent TEXT,
	priority TEXT DEFAULT 'medium',
	reporter TEXT,
	start_time TEXT,
	end_time TEXT,
	total_tokens INTEGER,
	argue_count INTEGER DEFAULT 0,
	quality_score REAL,
	estimate REAL,
	estimate_unit TEXT,
	tags TEXT,
	metadata TEXT,
	queue_position INTEGER,
	executor_type TEXT,
	executor_config TEXT,
	execution_result TEXT,
	execution_error TEXT,
	execution_time_seconds REAL,
	project_id TEXT,
	source_file TEXT,
	feature_type TEXT,
	stage INTEGER,
	reference_project TEXT,
	anchor_standard TEXT,
	requirement_source_id TEXT,
	git_commits TEXT,
	created_at TEXT DEFAULT (datetime('now')),
	updated_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (parent_id) REFERENCES requirements(id),
	FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

CREATE TABLE IF NOT EXISTS dependencies (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source_requirement_id TEXT NOT NULL,
	target_requirement_id TEXT NOT NULL,
	dependency_type TEXT NOT NULL DEFAULT 'blocking',
	created_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (source_requirement_id) REFERENCES requirements(id),
	FOREIGN KEY (target_requirement_id) REFERENCES requirements(id)
);

CREATE TABLE IF NOT EXISTS argument_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	argue_type TEXT NOT NULL,
	source_requirement_id TEXT NOT NULL,
	target_requirement_id TEXT NOT NULL,
	source_node_id TEXT,
	target_node_id TEXT,
	argue_reason TEXT NOT NULL,
	resolution TEXT,
	resolution_details TEXT,
	created_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (source_requirement_id) REFERENCES requirements(id),
	FOREIGN KEY (target_requirement_id) REFERENCES requirements(id)
);

CREATE TABLE IF NOT EXISTS performance_metrics (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	requirement_id TEXT NOT NULL,
	workflow_name TEXT NOT NULL,
	agent_name TEXT NOT NULL,
	execution_time_seconds REAL,
	total_tokens INTEGER,
	llm_calls_count INTEGER,
	quality_score REAL,
	test_coverage REAL,
	review_passed INTEGER,
	argue_count INTEGER DEFAULT 0,
	circuit_breaker_triggered INTEGER DEFAULT 0,
	created_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (requirement_id) REFERENCES requirements(id)
);

CREATE TABLE IF NOT EXISTS documents (
	document_id TEXT PRIMARY KEY,
	file_path TEXT NOT NULL,
	file_name TEXT NOT NULL,
	document_hash TEXT NOT NULL,
	title TEXT,
	format TEXT,
	total_tasks INTEGER DEFAULT 0,
	completed_tasks INTEGER DEFAULT 0,
	doc_created_at TEXT,
	doc_updated_at TEXT,
	doc_status TEXT,
	source_dir TEXT,
	imported_at TEXT DEFAULT (datetime('now')),
	last_checked_at TEXT,
	is_modified INTEGER DEFAULT 0,
	created_at TEXT DEFAULT (datetime('now')),
	updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requirement_comments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	requirement_id TEXT NOT NULL,
	comment TEXT NOT NULL,
	author TEXT NOT NULL,
	comment_type TEXT DEFAULT 'general',
	parent_comment_id INTEGER,
	is_resolved INTEGER DEFAULT 0,
	created_at TEXT DEFAULT (datetime('now')),
	updated_at TEXT DEFAULT (datetime('now')),
	FOREIGN KEY (requirement_id) REFERENCES requirements(id),
	FOREIGN KEY (parent_comment_id) REFERENCES requirement_comments(id)
);

CREATE INDEX IF NOT EXISTS idx_requirements_status ON requirements(status);
CREATE INDEX IF NOT EXISTS idx_requirements_parent ON requirements(parent_id);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_requirements_queue ON requirements(queue_position);
CREATE INDEX IF NOT EXISTS idx_dependencies_source ON dependencies(source_requirement_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_target ON dependencies(target_requirement_id);
CREATE INDEX IF NOT EXISTS idx_argument_history_source ON argument_history(source_requirement_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_req ON performance_metrics(requirement_id);
CREATE INDEX IF NOT EXISTS idx_comments_req ON requirement_comments(requirement_id);
`;

// ============================================================================
// PMDatabase
// ============================================================================

export class PMDatabase {
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
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  // ========================================================================
  // Requirements CRUD
  // ========================================================================

  createRequirement(data: {
    id: string;
    description: string;
    category?: string;
    parentId?: string;
    workflowTemplate?: string;
    investScore?: InvestScore;
    acceptanceCriteria?: AcceptanceCriterion[];
    metadata?: Record<string, unknown>;
    projectId?: string;
    featureType?: FeatureType;
    stage?: number;
    referenceProject?: string;
    anchorStandard?: string;
    requirementSourceId?: string;
    priority?: Priority;
    executorType?: ExecutorType;
    executorConfig?: Record<string, unknown>;
  }): RequirementData {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
			INSERT INTO requirements (
				id, description, category, parent_id, workflow_template,
				invest_score, acceptance_criteria, metadata,
				project_id, feature_type, stage, reference_project,
				anchor_standard, requirement_source_id, priority,
				executor_type, executor_config, created_at, updated_at
			) VALUES (
				@id, @description, @category, @parentId, @workflowTemplate,
				@investScore, @acceptanceCriteria, @metadata,
				@projectId, @featureType, @stage, @referenceProject,
				@anchorStandard, @requirementSourceId, @priority,
				@executorType, @executorConfig, @createdAt, @updatedAt
			)
		`);

    stmt.run({
      id: data.id,
      description: data.description,
      category: data.category ?? null,
      parentId: data.parentId ?? null,
      workflowTemplate: data.workflowTemplate ?? null,
      investScore: data.investScore ? JSON.stringify(data.investScore) : null,
      acceptanceCriteria: data.acceptanceCriteria ? JSON.stringify(data.acceptanceCriteria) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      projectId: data.projectId ?? null,
      featureType: data.featureType ?? null,
      stage: data.stage ?? null,
      referenceProject: data.referenceProject ?? null,
      anchorStandard: data.anchorStandard ?? null,
      requirementSourceId: data.requirementSourceId ?? null,
      priority: data.priority ?? "medium",
      executorType: data.executorType ?? null,
      executorConfig: data.executorConfig ? JSON.stringify(data.executorConfig) : null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getRequirement(data.id)!;
  }

  getRequirement(reqId: string): RequirementData | undefined {
    const row = this.db.prepare("SELECT * FROM requirements WHERE id = ?").get(reqId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRequirement(row) : undefined;
  }

  getAllRequirements(filter?: {
    status?: RequirementStatus;
    projectId?: string;
    parentId?: string;
    executorType?: ExecutorType;
    limit?: number;
  }): RequirementData[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.parentId) {
      conditions.push("parent_id = ?");
      params.push(filter.parentId);
    }
    if (filter?.executorType) {
      conditions.push("executor_type = ?");
      params.push(filter.executorType);
    }

    let sql = "SELECT * FROM requirements";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY queue_position ASC, created_at DESC";

    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRequirement(r));
  }

  getRequirementTree(rootId?: string): RequirementData[] {
    if (rootId) {
      const rows = this.db
        .prepare(`
				WITH RECURSIVE tree AS (
					SELECT * FROM requirements WHERE id = ?
					UNION ALL
					SELECT r.* FROM requirements r
					JOIN tree t ON r.parent_id = t.id
				)
				SELECT * FROM tree ORDER BY parent_id, queue_position
			`)
        .all(rootId) as Record<string, unknown>[];
      return rows.map((r) => this.rowToRequirement(r));
    }
    // 返回所有根节点及其子树
    const rows = this.db
      .prepare(`
			SELECT * FROM requirements ORDER BY parent_id NULLS FIRST, queue_position, created_at
		`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToRequirement(r));
  }

  updateRequirementStatus(
    reqId: string,
    status: RequirementStatus,
    assignedAgent?: string,
  ): RequirementData | undefined {
    const now = new Date().toISOString();
    const updates: string[] = ["status = @status", "updated_at = @updatedAt"];
    const params: Record<string, unknown> = { id: reqId, status, updatedAt: now };

    if (assignedAgent !== undefined) {
      updates.push("assigned_agent = @assignedAgent");
      params.assignedAgent = assignedAgent;
    }
    if (status === "in_progress") {
      updates.push("start_time = COALESCE(start_time, @startTime)");
      params.startTime = now;
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.push("end_time = @endTime");
      params.endTime = now;
    }

    this.db.prepare(`UPDATE requirements SET ${updates.join(", ")} WHERE id = @id`).run(params);
    return this.getRequirement(reqId);
  }

  updateRequirement(
    reqId: string,
    data: Partial<Omit<RequirementData, "id" | "createdAt">>,
  ): RequirementData | undefined {
    const now = new Date().toISOString();
    const updates: string[] = ["updated_at = @updatedAt"];
    const params: Record<string, unknown> = { id: reqId, updatedAt: now };

    const fieldMap: Record<string, string> = {
      description: "description",
      category: "category",
      parentId: "parent_id",
      workflowTemplate: "workflow_template",
      priority: "priority",
      reporter: "reporter",
      estimate: "estimate",
      estimateUnit: "estimate_unit",
      assignedAgent: "assigned_agent",
      executorType: "executor_type",
      projectId: "project_id",
      sourceFile: "source_file",
      featureType: "feature_type",
      stage: "stage",
      referenceProject: "reference_project",
      anchorStandard: "anchor_standard",
      requirementSourceId: "requirement_source_id",
      queuePosition: "queue_position",
      qualityScore: "quality_score",
      executionError: "execution_error",
      executionTimeSeconds: "execution_time_seconds",
      totalTokens: "total_tokens",
      argueCount: "argue_count",
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in data) {
        updates.push(`${col} = @${key}`);
        params[key] = (data as Record<string, unknown>)[key] ?? null;
      }
    }

    // JSON fields
    const jsonFields: Record<string, string> = {
      investScore: "invest_score",
      acceptanceCriteria: "acceptance_criteria",
      metadata: "metadata",
      tags: "tags",
      executorConfig: "executor_config",
      executionResult: "execution_result",
      gitCommits: "git_commits",
    };
    for (const [key, col] of Object.entries(jsonFields)) {
      if (key in data) {
        updates.push(`${col} = @${key}`);
        const val = (data as Record<string, unknown>)[key];
        params[key] = val != null ? JSON.stringify(val) : null;
      }
    }

    if (updates.length <= 1) return this.getRequirement(reqId);

    this.db.prepare(`UPDATE requirements SET ${updates.join(", ")} WHERE id = @id`).run(params);
    return this.getRequirement(reqId);
  }

  deleteRequirement(reqId: string): boolean {
    const result = this.db.prepare("DELETE FROM requirements WHERE id = ?").run(reqId);
    return result.changes > 0;
  }

  // ========================================================================
  // Dependencies
  // ========================================================================

  createDependency(
    source: string,
    target: string,
    type: DependencyType = "blocking",
  ): DependencyData {
    const stmt = this.db.prepare(`
			INSERT INTO dependencies (source_requirement_id, target_requirement_id, dependency_type)
			VALUES (?, ?, ?)
		`);
    const result = stmt.run(source, target, type);
    return {
      id: Number(result.lastInsertRowid),
      sourceRequirementId: source,
      targetRequirementId: target,
      dependencyType: type,
    };
  }

  getDependencies(reqId: string): { blocking: DependencyData[]; blockedBy: DependencyData[] } {
    const blocking = this.db
      .prepare("SELECT * FROM dependencies WHERE source_requirement_id = ?")
      .all(reqId) as Record<string, unknown>[];

    const blockedBy = this.db
      .prepare("SELECT * FROM dependencies WHERE target_requirement_id = ?")
      .all(reqId) as Record<string, unknown>[];

    return {
      blocking: blocking.map(this.rowToDependency),
      blockedBy: blockedBy.map(this.rowToDependency),
    };
  }

  deleteDependency(id: number): boolean {
    return this.db.prepare("DELETE FROM dependencies WHERE id = ?").run(id).changes > 0;
  }

  // ========================================================================
  // Argument History
  // ========================================================================

  logArgument(data: Omit<ArgumentData, "id" | "createdAt">): ArgumentData {
    const stmt = this.db.prepare(`
			INSERT INTO argument_history (
				argue_type, source_requirement_id, target_requirement_id,
				source_node_id, target_node_id, argue_reason,
				resolution, resolution_details
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
    const result = stmt.run(
      data.argueType,
      data.sourceRequirementId,
      data.targetRequirementId,
      data.sourceNodeId ?? null,
      data.targetNodeId ?? null,
      data.argueReason,
      data.resolution ?? null,
      data.resolutionDetails ? JSON.stringify(data.resolutionDetails) : null,
    );

    // 增加争议计数
    this.db
      .prepare("UPDATE requirements SET argue_count = COALESCE(argue_count, 0) + 1 WHERE id = ?")
      .run(data.sourceRequirementId);

    return {
      id: Number(result.lastInsertRowid),
      ...data,
    };
  }

  getArguments(reqId: string): ArgumentData[] {
    const rows = this.db
      .prepare(`
			SELECT * FROM argument_history
			WHERE source_requirement_id = ? OR target_requirement_id = ?
			ORDER BY created_at DESC
		`)
      .all(reqId, reqId) as Record<string, unknown>[];

    return rows.map(this.rowToArgument);
  }

  // ========================================================================
  // Performance Metrics
  // ========================================================================

  logPerformance(data: Omit<PerformanceMetric, "id" | "createdAt">): PerformanceMetric {
    const stmt = this.db.prepare(`
			INSERT INTO performance_metrics (
				requirement_id, workflow_name, agent_name,
				execution_time_seconds, total_tokens, llm_calls_count,
				quality_score, test_coverage, review_passed,
				argue_count, circuit_breaker_triggered
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    const result = stmt.run(
      data.requirementId,
      data.workflowName,
      data.agentName,
      data.executionTimeSeconds ?? null,
      data.totalTokens ?? null,
      data.llmCallsCount ?? null,
      data.qualityScore ?? null,
      data.testCoverage ?? null,
      data.reviewPassed != null ? (data.reviewPassed ? 1 : 0) : null,
      data.argueCount ?? 0,
      data.circuitBreakerTriggered ? 1 : 0,
    );
    return { id: Number(result.lastInsertRowid), ...data };
  }

  getPerformanceMetrics(reqId: string): PerformanceMetric[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM performance_metrics WHERE requirement_id = ? ORDER BY created_at DESC",
      )
      .all(reqId) as Record<string, unknown>[];

    return rows.map(this.rowToMetric);
  }

  // ========================================================================
  // Documents
  // ========================================================================

  upsertDocument(data: DocumentData): DocumentData {
    const now = new Date().toISOString();
    this.db
      .prepare(`
			INSERT INTO documents (
				document_id, file_path, file_name, document_hash, title, format,
				total_tasks, completed_tasks, doc_created_at, doc_updated_at,
				doc_status, source_dir, imported_at, last_checked_at, is_modified
			) VALUES (
				@documentId, @filePath, @fileName, @documentHash, @title, @format,
				@totalTasks, @completedTasks, @docCreatedAt, @docUpdatedAt,
				@docStatus, @sourceDir, @importedAt, @lastCheckedAt, @isModified
			) ON CONFLICT(document_id) DO UPDATE SET
				file_path = @filePath, document_hash = @documentHash,
				title = @title, format = @format, total_tasks = @totalTasks,
				completed_tasks = @completedTasks, doc_updated_at = @docUpdatedAt,
				doc_status = @docStatus, last_checked_at = @lastCheckedAt,
				is_modified = @isModified, updated_at = @updatedAt
		`)
      .run({
        documentId: data.documentId,
        filePath: data.filePath,
        fileName: data.fileName,
        documentHash: data.documentHash,
        title: data.title ?? null,
        format: data.format ?? null,
        totalTasks: data.totalTasks ?? 0,
        completedTasks: data.completedTasks ?? 0,
        docCreatedAt: data.docCreatedAt ?? null,
        docUpdatedAt: data.docUpdatedAt ?? null,
        docStatus: data.docStatus ?? null,
        sourceDir: data.sourceDir ?? null,
        importedAt: data.importedAt ?? now,
        lastCheckedAt: data.lastCheckedAt ?? now,
        isModified: data.isModified ? 1 : 0,
        updatedAt: now,
      });
    return data;
  }

  getDocument(docId: string): DocumentData | undefined {
    const row = this.db.prepare("SELECT * FROM documents WHERE document_id = ?").get(docId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToDocument(row) : undefined;
  }

  // ========================================================================
  // Comments
  // ========================================================================

  addComment(data: Omit<CommentData, "id" | "createdAt" | "updatedAt">): CommentData {
    const stmt = this.db.prepare(`
			INSERT INTO requirement_comments (
				requirement_id, comment, author, comment_type, parent_comment_id, is_resolved
			) VALUES (?, ?, ?, ?, ?, ?)
		`);
    const result = stmt.run(
      data.requirementId,
      data.comment,
      data.author,
      data.commentType ?? "general",
      data.parentCommentId ?? null,
      data.isResolved ? 1 : 0,
    );
    return { id: Number(result.lastInsertRowid), ...data };
  }

  getComments(reqId: string): CommentData[] {
    const rows = this.db
      .prepare("SELECT * FROM requirement_comments WHERE requirement_id = ? ORDER BY created_at")
      .all(reqId) as Record<string, unknown>[];

    return rows.map(this.rowToComment);
  }

  // ========================================================================
  // Statistics
  // ========================================================================

  getStats(projectId?: string): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    blocked: number;
    argued: number;
  } {
    const where = projectId ? "WHERE project_id = ?" : "";
    const params = projectId ? [projectId] : [];

    const row = this.db
      .prepare(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
				SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
				SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
				SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
				SUM(CASE WHEN status = 'argued' THEN 1 ELSE 0 END) as argued
			FROM requirements ${where}
		`)
      .get(...params) as Record<string, number>;

    return {
      total: row.total ?? 0,
      pending: row.pending ?? 0,
      inProgress: row.in_progress ?? 0,
      completed: row.completed ?? 0,
      failed: row.failed ?? 0,
      blocked: row.blocked ?? 0,
      argued: row.argued ?? 0,
    };
  }

  // ========================================================================
  // Row Mapping Helpers
  // ========================================================================

  private rowToRequirement(row: Record<string, unknown>): RequirementData {
    return {
      id: row.id as string,
      parentId: row.parent_id as string | undefined,
      documentId: row.document_id as string | undefined,
      description: row.description as string,
      category: row.category as string | undefined,
      workflowTemplate: row.workflow_template as string | undefined,
      investScore: row.invest_score ? JSON.parse(row.invest_score as string) : undefined,
      acceptanceCriteria: row.acceptance_criteria
        ? JSON.parse(row.acceptance_criteria as string)
        : undefined,
      status: (row.status as RequirementStatus) ?? "pending",
      assignedAgent: row.assigned_agent as string | undefined,
      priority: (row.priority as Priority) ?? "medium",
      reporter: row.reporter as string | undefined,
      startTime: row.start_time as string | undefined,
      endTime: row.end_time as string | undefined,
      totalTokens: row.total_tokens as number | undefined,
      argueCount: row.argue_count as number | undefined,
      qualityScore: row.quality_score as number | undefined,
      estimate: row.estimate as number | undefined,
      estimateUnit: row.estimate_unit as string | undefined,
      tags: row.tags ? JSON.parse(row.tags as string) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      queuePosition: row.queue_position as number | undefined,
      executorType: row.executor_type as ExecutorType | undefined,
      executorConfig: row.executor_config ? JSON.parse(row.executor_config as string) : undefined,
      executionResult: row.execution_result
        ? JSON.parse(row.execution_result as string)
        : undefined,
      executionError: row.execution_error as string | undefined,
      executionTimeSeconds: row.execution_time_seconds as number | undefined,
      projectId: row.project_id as string | undefined,
      sourceFile: row.source_file as string | undefined,
      featureType: row.feature_type as FeatureType | undefined,
      stage: row.stage as number | undefined,
      referenceProject: row.reference_project as string | undefined,
      anchorStandard: row.anchor_standard as string | undefined,
      requirementSourceId: row.requirement_source_id as string | undefined,
      gitCommits: row.git_commits ? JSON.parse(row.git_commits as string) : undefined,
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }

  private rowToDependency(row: Record<string, unknown>): DependencyData {
    return {
      id: row.id as number,
      sourceRequirementId: row.source_requirement_id as string,
      targetRequirementId: row.target_requirement_id as string,
      dependencyType: row.dependency_type as DependencyType,
      createdAt: row.created_at as string,
    };
  }

  private rowToArgument(row: Record<string, unknown>): ArgumentData {
    return {
      id: row.id as number,
      argueType: row.argue_type as ArgueType,
      sourceRequirementId: row.source_requirement_id as string,
      targetRequirementId: row.target_requirement_id as string,
      sourceNodeId: row.source_node_id as string | undefined,
      targetNodeId: row.target_node_id as string | undefined,
      argueReason: row.argue_reason as string,
      resolution: row.resolution as ArgueResolution | undefined,
      resolutionDetails: row.resolution_details
        ? JSON.parse(row.resolution_details as string)
        : undefined,
      createdAt: row.created_at as string,
    };
  }

  private rowToMetric(row: Record<string, unknown>): PerformanceMetric {
    return {
      id: row.id as number,
      requirementId: row.requirement_id as string,
      workflowName: row.workflow_name as string,
      agentName: row.agent_name as string,
      executionTimeSeconds: row.execution_time_seconds as number | undefined,
      totalTokens: row.total_tokens as number | undefined,
      llmCallsCount: row.llm_calls_count as number | undefined,
      qualityScore: row.quality_score as number | undefined,
      testCoverage: row.test_coverage as number | undefined,
      reviewPassed: row.review_passed != null ? Boolean(row.review_passed) : undefined,
      argueCount: row.argue_count as number | undefined,
      circuitBreakerTriggered: Boolean(row.circuit_breaker_triggered),
      createdAt: row.created_at as string,
    };
  }

  private rowToDocument(row: Record<string, unknown>): DocumentData {
    return {
      documentId: row.document_id as string,
      filePath: row.file_path as string,
      fileName: row.file_name as string,
      documentHash: row.document_hash as string,
      title: row.title as string | undefined,
      format: row.format as DocumentData["format"],
      totalTasks: row.total_tasks as number,
      completedTasks: row.completed_tasks as number,
      docCreatedAt: row.doc_created_at as string | undefined,
      docUpdatedAt: row.doc_updated_at as string | undefined,
      docStatus: row.doc_status as string | undefined,
      sourceDir: row.source_dir as string | undefined,
      importedAt: row.imported_at as string | undefined,
      lastCheckedAt: row.last_checked_at as string | undefined,
      isModified: Boolean(row.is_modified),
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }

  private rowToComment(row: Record<string, unknown>): CommentData {
    return {
      id: row.id as number,
      requirementId: row.requirement_id as string,
      comment: row.comment as string,
      author: row.author as string,
      commentType: (row.comment_type as CommentType) ?? "general",
      parentCommentId: row.parent_comment_id as number | undefined,
      isResolved: Boolean(row.is_resolved),
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }
}
