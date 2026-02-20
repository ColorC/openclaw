/**
 * 失败采集器 (Failure Collector)
 *
 * 采集、存储和查询工作流执行中的失败事件。
 * 使用 SQLite 持久化存储。
 *
 * 源码参考: _personal_copilot/src/workflows/self_iteration/failure_collector.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FailureEvent, FailureType, Severity } from "./models.js";

// ============================================================================
// FailureCollector
// ============================================================================

export class FailureCollector {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.join(process.cwd(), ".openclaw", "self-iteration", "failures.db");
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS failures (
				failure_id TEXT PRIMARY KEY,
				timestamp TEXT DEFAULT (datetime('now')),
				workflow_id TEXT NOT NULL,
				node_id TEXT NOT NULL,
				failure_type TEXT NOT NULL,
				severity TEXT NOT NULL,
				root_cause TEXT,
				input_snapshot TEXT,
				error_message TEXT NOT NULL,
				stack_trace TEXT,
				resolved INTEGER DEFAULT 0,
				resolved_at TEXT,
				resolution_method TEXT
			)
		`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_failures_workflow ON failures(workflow_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_failures_node ON failures(node_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_failures_timestamp ON failures(timestamp)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_failures_resolved ON failures(resolved)");
  }

  /** 采集一个失败事件 */
  collectFailure(event: Omit<FailureEvent, "timestamp" | "resolved">): string {
    const stmt = this.db.prepare(`
			INSERT INTO failures (failure_id, workflow_id, node_id, failure_type, severity, error_message, root_cause, input_snapshot, stack_trace)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      event.failureId,
      event.workflowId,
      event.nodeId,
      event.failureType,
      event.severity,
      event.errorMessage,
      event.rootCause ?? null,
      event.inputSnapshot ? JSON.stringify(event.inputSnapshot) : null,
      event.stackTrace ?? null,
    );
    return event.failureId;
  }

  /** 按时间范围查询 */
  queryByTimeRange(start: string, end: string): FailureEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM failures WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC",
    );
    return (stmt.all(start, end) as RawRow[]).map(rowToFailure);
  }

  /** 按工作流 ID 查询 */
  queryByWorkflow(workflowId: string): FailureEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM failures WHERE workflow_id = ? ORDER BY timestamp DESC",
    );
    return (stmt.all(workflowId) as RawRow[]).map(rowToFailure);
  }

  /** 按节点 ID 查询 */
  queryByNode(nodeId: string): FailureEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM failures WHERE node_id = ? ORDER BY timestamp DESC",
    );
    return (stmt.all(nodeId) as RawRow[]).map(rowToFailure);
  }

  /** 按失败类型查询 */
  queryByType(failureType: FailureType): FailureEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM failures WHERE failure_type = ? ORDER BY timestamp DESC",
    );
    return (stmt.all(failureType) as RawRow[]).map(rowToFailure);
  }

  /** 标记失败已解决 */
  resolveFailure(failureId: string, method: string): boolean {
    const stmt = this.db.prepare(`
			UPDATE failures SET resolved = 1, resolved_at = datetime('now'), resolution_method = ? WHERE failure_id = ?
		`);
    const result = stmt.run(method, failureId);
    return result.changes > 0;
  }

  /** 获取未解决的失败 */
  getUnresolved(limit = 50): FailureEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM failures WHERE resolved = 0 ORDER BY timestamp DESC LIMIT ?",
    );
    return (stmt.all(limit) as RawRow[]).map(rowToFailure);
  }

  /** 获取统计数据 */
  getStatistics(days = 7): FailureStats {
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const total = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM failures WHERE timestamp >= ?").get(since) as {
        cnt: number;
      }
    ).cnt;
    const unresolved = (
      this.db
        .prepare("SELECT COUNT(*) as cnt FROM failures WHERE timestamp >= ? AND resolved = 0")
        .get(since) as { cnt: number }
    ).cnt;

    const byType = this.db
      .prepare(
        "SELECT failure_type, COUNT(*) as cnt FROM failures WHERE timestamp >= ? GROUP BY failure_type",
      )
      .all(since) as Array<{ failure_type: string; cnt: number }>;

    const bySeverity = this.db
      .prepare(
        "SELECT severity, COUNT(*) as cnt FROM failures WHERE timestamp >= ? GROUP BY severity",
      )
      .all(since) as Array<{ severity: string; cnt: number }>;

    return {
      total,
      unresolved,
      resolved: total - unresolved,
      byType: Object.fromEntries(byType.map((r) => [r.failure_type, r.cnt])),
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r.cnt])),
      days,
    };
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// 内部工具
// ============================================================================

interface RawRow {
  failure_id: string;
  timestamp: string;
  workflow_id: string;
  node_id: string;
  failure_type: string;
  severity: string;
  root_cause: string | null;
  input_snapshot: string | null;
  error_message: string;
  stack_trace: string | null;
  resolved: number;
  resolved_at: string | null;
  resolution_method: string | null;
}

function rowToFailure(row: RawRow): FailureEvent {
  return {
    failureId: row.failure_id,
    timestamp: row.timestamp,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    failureType: row.failure_type as FailureType,
    severity: row.severity as Severity,
    errorMessage: row.error_message,
    rootCause: row.root_cause ?? undefined,
    inputSnapshot: row.input_snapshot
      ? (JSON.parse(row.input_snapshot) as Record<string, unknown>)
      : undefined,
    stackTrace: row.stack_trace ?? undefined,
    resolved: row.resolved === 1,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionMethod: row.resolution_method ?? undefined,
  };
}

export interface FailureStats {
  total: number;
  unresolved: number;
  resolved: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  days: number;
}
