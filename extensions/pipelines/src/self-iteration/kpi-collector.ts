/**
 * KPI 采集器 (KPI Collector)
 *
 * 采集硬指标 (Metric)、软评估 (Evaluation)、期望阈值 (Expectation)
 * 和分类评估 (CategoricalAssessment)。
 *
 * 源码参考: _personal_copilot/src/workflows/self_iteration/kpi_collector.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Metric, Evaluation, Expectation, CategoricalAssessment, KPIType } from "./models.js";

// ============================================================================
// KPICollector
// ============================================================================

export class KPICollector {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.join(process.cwd(), ".openclaw", "self-iteration", "kpi.db");
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS metrics (
				metric_id TEXT PRIMARY KEY,
				kpi_type TEXT NOT NULL,
				value REAL NOT NULL,
				unit TEXT,
				workflow_id TEXT NOT NULL,
				node_id TEXT,
				timestamp TEXT DEFAULT (datetime('now')),
				tags TEXT
			)
		`);
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS evaluations (
				evaluation_id TEXT PRIMARY KEY,
				kpi_type TEXT NOT NULL,
				score REAL NOT NULL,
				workflow_id TEXT NOT NULL,
				node_id TEXT,
				evaluator TEXT,
				comment TEXT,
				criteria TEXT,
				timestamp TEXT DEFAULT (datetime('now'))
			)
		`);
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS expectations (
				expectation_id TEXT PRIMARY KEY,
				kpi_type TEXT NOT NULL,
				target_value REAL NOT NULL,
				operator TEXT NOT NULL,
				description TEXT,
				level TEXT,
				flexibility REAL,
				active INTEGER DEFAULT 1,
				created_at TEXT
			)
		`);
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS assessments (
				assessment_id TEXT PRIMARY KEY,
				level INTEGER NOT NULL,
				reasoning TEXT NOT NULL,
				workflow_id TEXT NOT NULL,
				node_id TEXT,
				evaluator TEXT,
				model_id TEXT,
				agent_id TEXT,
				unmet_requirements TEXT,
				inappropriate_approaches TEXT,
				recommendations TEXT,
				timestamp TEXT DEFAULT (datetime('now'))
			)
		`);
  }

  // ==================== Metric ====================

  collectMetric(metric: Metric): string {
    const stmt = this.db.prepare(`
			INSERT INTO metrics (metric_id, kpi_type, value, unit, workflow_id, node_id, tags)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      metric.metricId,
      metric.kpiType,
      metric.value,
      metric.unit ?? "",
      metric.workflowId,
      metric.nodeId ?? null,
      metric.tags ? JSON.stringify(metric.tags) : null,
    );
    return metric.metricId;
  }

  queryMetrics(opts?: { workflowId?: string; kpiType?: KPIType; limit?: number }): Metric[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.workflowId) {
      clauses.push("workflow_id = ?");
      params.push(opts.workflowId);
    }
    if (opts?.kpiType) {
      clauses.push("kpi_type = ?");
      params.push(opts.kpiType);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts?.limit ?? 100;
    const sql = `SELECT * FROM metrics ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    return (this.db.prepare(sql).all(...params) as RawMetricRow[]).map(rowToMetric);
  }

  // ==================== Evaluation ====================

  collectEvaluation(ev: Evaluation): string {
    const stmt = this.db.prepare(`
			INSERT INTO evaluations (evaluation_id, kpi_type, score, workflow_id, node_id, evaluator, comment, criteria)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      ev.evaluationId,
      ev.kpiType,
      ev.score,
      ev.workflowId,
      ev.nodeId ?? null,
      ev.evaluator ?? "system",
      ev.comment ?? "",
      ev.criteria ? JSON.stringify(ev.criteria) : null,
    );
    return ev.evaluationId;
  }

  queryEvaluations(opts?: {
    workflowId?: string;
    kpiType?: KPIType;
    limit?: number;
  }): Evaluation[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.workflowId) {
      clauses.push("workflow_id = ?");
      params.push(opts.workflowId);
    }
    if (opts?.kpiType) {
      clauses.push("kpi_type = ?");
      params.push(opts.kpiType);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts?.limit ?? 100;
    const sql = `SELECT * FROM evaluations ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    return (this.db.prepare(sql).all(...params) as RawEvaluationRow[]).map(rowToEvaluation);
  }

  // ==================== Expectation ====================

  setExpectation(exp: Expectation): string {
    const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO expectations (expectation_id, kpi_type, target_value, operator, description, level, flexibility, active, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      exp.expectationId,
      exp.kpiType,
      exp.targetValue,
      exp.operator,
      exp.description ?? "",
      exp.level ?? "hard",
      exp.flexibility ?? 0,
      exp.active !== false ? 1 : 0,
      exp.createdAt ?? new Date().toISOString(),
    );
    return exp.expectationId;
  }

  getActiveExpectations(kpiType?: KPIType): Expectation[] {
    if (kpiType) {
      const stmt = this.db.prepare("SELECT * FROM expectations WHERE active = 1 AND kpi_type = ?");
      return (stmt.all(kpiType) as RawExpectationRow[]).map(rowToExpectation);
    }
    const stmt = this.db.prepare("SELECT * FROM expectations WHERE active = 1");
    return (stmt.all() as RawExpectationRow[]).map(rowToExpectation);
  }

  // ==================== CategoricalAssessment ====================

  collectAssessment(a: CategoricalAssessment): string {
    if (!a.reasoning) throw new Error("Assessment reasoning is required");
    const stmt = this.db.prepare(`
			INSERT INTO assessments (assessment_id, level, reasoning, workflow_id, node_id, evaluator, model_id, agent_id, unmet_requirements, inappropriate_approaches, recommendations)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      a.assessmentId,
      a.level,
      a.reasoning,
      a.workflowId,
      a.nodeId ?? null,
      a.evaluator ?? "system",
      a.modelId ?? "",
      a.agentId ?? "",
      JSON.stringify(a.unmetRequirements ?? []),
      JSON.stringify(a.inappropriateApproaches ?? []),
      JSON.stringify(a.recommendations ?? []),
    );
    return a.assessmentId;
  }

  queryAssessments(opts?: {
    workflowId?: string;
    agentId?: string;
    modelId?: string;
    minLevel?: number;
    limit?: number;
  }): CategoricalAssessment[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.workflowId) {
      clauses.push("workflow_id = ?");
      params.push(opts.workflowId);
    }
    if (opts?.agentId) {
      clauses.push("agent_id = ?");
      params.push(opts.agentId);
    }
    if (opts?.modelId) {
      clauses.push("model_id = ?");
      params.push(opts.modelId);
    }
    if (opts?.minLevel) {
      clauses.push("level >= ?");
      params.push(opts.minLevel);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts?.limit ?? 10;
    const sql = `SELECT * FROM assessments ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    return (this.db.prepare(sql).all(...params) as RawAssessmentRow[]).map(rowToAssessment);
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Row 类型 & 转换
// ============================================================================

interface RawMetricRow {
  metric_id: string;
  kpi_type: string;
  value: number;
  unit: string | null;
  workflow_id: string;
  node_id: string | null;
  timestamp: string;
  tags: string | null;
}

function rowToMetric(r: RawMetricRow): Metric {
  return {
    metricId: r.metric_id,
    kpiType: r.kpi_type as KPIType,
    value: r.value,
    unit: r.unit ?? "",
    workflowId: r.workflow_id,
    nodeId: r.node_id ?? "",
    timestamp: r.timestamp,
    tags: r.tags ? (JSON.parse(r.tags) as Record<string, string>) : {},
  };
}

interface RawEvaluationRow {
  evaluation_id: string;
  kpi_type: string;
  score: number;
  workflow_id: string;
  node_id: string | null;
  evaluator: string | null;
  comment: string | null;
  criteria: string | null;
  timestamp: string;
}

function rowToEvaluation(r: RawEvaluationRow): Evaluation {
  return {
    evaluationId: r.evaluation_id,
    kpiType: r.kpi_type as KPIType,
    score: r.score,
    workflowId: r.workflow_id,
    nodeId: r.node_id ?? undefined,
    evaluator: r.evaluator ?? "system",
    comment: r.comment ?? "",
    criteria: r.criteria ? (JSON.parse(r.criteria) as Record<string, unknown>) : {},
    timestamp: r.timestamp,
  };
}

interface RawExpectationRow {
  expectation_id: string;
  kpi_type: string;
  target_value: number;
  operator: string;
  description: string | null;
  level: string | null;
  flexibility: number | null;
  active: number;
  created_at: string | null;
}

function rowToExpectation(r: RawExpectationRow): Expectation {
  return {
    expectationId: r.expectation_id,
    kpiType: r.kpi_type as KPIType,
    targetValue: r.target_value,
    operator: r.operator as Expectation["operator"],
    description: r.description ?? "",
    level: (r.level ?? "hard") as "hard" | "soft",
    flexibility: r.flexibility ?? 0,
    active: r.active === 1,
    createdAt: r.created_at ?? "",
  };
}

interface RawAssessmentRow {
  assessment_id: string;
  level: number;
  reasoning: string;
  workflow_id: string;
  node_id: string | null;
  evaluator: string | null;
  model_id: string | null;
  agent_id: string | null;
  unmet_requirements: string | null;
  inappropriate_approaches: string | null;
  recommendations: string | null;
  timestamp: string;
}

function rowToAssessment(r: RawAssessmentRow): CategoricalAssessment {
  return {
    assessmentId: r.assessment_id,
    level: r.level as CategoricalAssessment["level"],
    reasoning: r.reasoning,
    workflowId: r.workflow_id,
    nodeId: r.node_id ?? "",
    evaluator: r.evaluator ?? "system",
    modelId: r.model_id ?? "",
    agentId: r.agent_id ?? "",
    unmetRequirements: r.unmet_requirements ? (JSON.parse(r.unmet_requirements) as string[]) : [],
    inappropriateApproaches: r.inappropriate_approaches
      ? (JSON.parse(r.inappropriate_approaches) as string[])
      : [],
    recommendations: r.recommendations ? (JSON.parse(r.recommendations) as string[]) : [],
    timestamp: r.timestamp,
  };
}
