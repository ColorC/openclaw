/**
 * 补丁数据库 (Patch Database)
 *
 * 管理补丁的持久化存储、状态流转、效果追踪和审核记录。
 *
 * 源码参考: _personal_copilot/src/workflows/self_iteration/patch_database.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Patch, PatchStatus, PatchType, PatchEffect, PatchReview } from "./models.js";

// ============================================================================
// PatchDatabase
// ============================================================================

export class PatchDatabase {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.join(process.cwd(), ".openclaw", "self-iteration", "patches.db");
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS patches (
				patch_id TEXT PRIMARY KEY,
				patch_type TEXT NOT NULL,
				target TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT,
				rationale TEXT,
				suggested_attribution_id TEXT,
				priority INTEGER DEFAULT 5,
				estimated_effort TEXT,
				status TEXT DEFAULT 'suggested',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				applied_at TEXT,
				applied_by TEXT,
				patch_data TEXT NOT NULL,
				metadata TEXT
			)
		`);
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS patch_effects (
				effect_id TEXT PRIMARY KEY,
				patch_id TEXT NOT NULL,
				workflow_id TEXT,
				node_id TEXT,
				effect_type TEXT NOT NULL,
				metric_name TEXT NOT NULL,
				metric_value_before REAL,
				metric_value_after REAL,
				improvement_pct REAL,
				measured_at TEXT NOT NULL,
				notes TEXT,
				FOREIGN KEY (patch_id) REFERENCES patches (patch_id)
			)
		`);
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS patch_reviews (
				review_id TEXT PRIMARY KEY,
				patch_id TEXT NOT NULL,
				reviewer TEXT NOT NULL,
				decision TEXT NOT NULL,
				comments TEXT,
				reviewed_at TEXT NOT NULL,
				FOREIGN KEY (patch_id) REFERENCES patches (patch_id)
			)
		`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_patches_status ON patches(status)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_patches_type ON patches(patch_type)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_patches_target ON patches(target)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_patch_effects_patch ON patch_effects(patch_id)");
  }

  // ==================== Patch CRUD ====================

  /** 保存补丁 */
  savePatch(patch: Patch): string {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO patches (patch_id, patch_type, target, title, description, rationale, suggested_attribution_id, priority, estimated_effort, status, created_at, updated_at, patch_data)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      patch.patchId,
      patch.patchType,
      patch.target,
      patch.title,
      patch.description ?? "",
      patch.rationale ?? "",
      patch.suggestedAttributionId ?? null,
      patch.priority ?? 5,
      patch.estimatedEffort ?? "",
      patch.status ?? "suggested",
      now,
      now,
      JSON.stringify(patch),
    );
    return patch.patchId;
  }

  /** 获取补丁 */
  getPatch(patchId: string): Patch | undefined {
    const stmt = this.db.prepare("SELECT * FROM patches WHERE patch_id = ?");
    const row = stmt.get(patchId) as RawPatchRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.patch_data) as Patch;
  }

  /** 查询补丁 */
  queryPatches(opts?: {
    status?: PatchStatus;
    patchType?: PatchType;
    target?: string;
    limit?: number;
  }): Patch[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts?.patchType) {
      clauses.push("patch_type = ?");
      params.push(opts.patchType);
    }
    if (opts?.target) {
      clauses.push("target = ?");
      params.push(opts.target);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = opts?.limit ?? 50;
    params.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM patches ${where} ORDER BY priority ASC, created_at DESC LIMIT ?`)
      .all(...params) as RawPatchRow[];
    return rows.map((r) => JSON.parse(r.patch_data) as Patch);
  }

  /** 更新补丁状态 */
  updateStatus(patchId: string, status: PatchStatus, appliedBy?: string): boolean {
    const now = new Date().toISOString();
    let sql = "UPDATE patches SET status = ?, updated_at = ?";
    const params: unknown[] = [status, now];
    if (status === "applied") {
      sql += ", applied_at = ?, applied_by = ?";
      params.push(now, appliedBy ?? "system");
    }
    sql += " WHERE patch_id = ?";
    params.push(patchId);
    const result = this.db.prepare(sql).run(...params);
    return result.changes > 0;
  }

  /** 获取待处理补丁 */
  getPending(limit = 50): Patch[] {
    return this.queryPatches({ status: "suggested", limit });
  }

  /** 获取已应用补丁 */
  getApplied(limit = 50): Patch[] {
    return this.queryPatches({ status: "applied", limit });
  }

  /** 按归因 ID 查询补丁 */
  getByAttribution(attributionId: string): Patch[] {
    const rows = this.db
      .prepare("SELECT * FROM patches WHERE suggested_attribution_id = ? ORDER BY created_at DESC")
      .all(attributionId) as RawPatchRow[];
    return rows.map((r) => JSON.parse(r.patch_data) as Patch);
  }

  // ==================== Effects ====================

  /** 记录补丁效果 */
  recordEffect(effect: PatchEffect): string {
    const improvementPct =
      effect.metricValueBefore != null &&
      effect.metricValueAfter != null &&
      effect.metricValueBefore !== 0
        ? ((effect.metricValueAfter - effect.metricValueBefore) /
            Math.abs(effect.metricValueBefore)) *
          100
        : null;
    const stmt = this.db.prepare(`
			INSERT INTO patch_effects (effect_id, patch_id, workflow_id, node_id, effect_type, metric_name, metric_value_before, metric_value_after, improvement_pct, measured_at, notes)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      effect.effectId,
      effect.patchId,
      effect.workflowId ?? null,
      effect.nodeId ?? null,
      effect.effectType,
      effect.metricName,
      effect.metricValueBefore ?? null,
      effect.metricValueAfter ?? null,
      improvementPct,
      effect.measuredAt,
      effect.notes ?? null,
    );
    return effect.effectId;
  }

  /** 获取补丁效果 */
  getEffects(patchId: string): PatchEffect[] {
    const rows = this.db
      .prepare("SELECT * FROM patch_effects WHERE patch_id = ?")
      .all(patchId) as RawEffectRow[];
    return rows.map(rowToEffect);
  }

  // ==================== Reviews ====================

  /** 添加审核记录 */
  addReview(review: PatchReview): string {
    const stmt = this.db.prepare(`
			INSERT INTO patch_reviews (review_id, patch_id, reviewer, decision, comments, reviewed_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      review.reviewId,
      review.patchId,
      review.reviewer,
      review.decision,
      review.comments ?? null,
      review.reviewedAt,
    );
    return review.reviewId;
  }

  /** 获取审核记录 */
  getReviews(patchId: string): PatchReview[] {
    const rows = this.db
      .prepare("SELECT * FROM patch_reviews WHERE patch_id = ? ORDER BY reviewed_at DESC")
      .all(patchId) as RawReviewRow[];
    return rows.map(rowToReview);
  }

  // ==================== Statistics ====================

  getStatistics(): PatchStats {
    const total = (this.db.prepare("SELECT COUNT(*) as cnt FROM patches").get() as { cnt: number })
      .cnt;

    const byStatus = this.db
      .prepare("SELECT status, COUNT(*) as cnt FROM patches GROUP BY status")
      .all() as Array<{ status: string; cnt: number }>;

    const byType = this.db
      .prepare("SELECT patch_type, COUNT(*) as cnt FROM patches GROUP BY patch_type")
      .all() as Array<{ patch_type: string; cnt: number }>;

    const applied = byStatus.find((r) => r.status === "applied")?.cnt ?? 0;

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.cnt])),
      byType: Object.fromEntries(byType.map((r) => [r.patch_type, r.cnt])),
      applicationRate: total > 0 ? applied / total : 0,
    };
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Row 类型
// ============================================================================

interface RawPatchRow {
  patch_id: string;
  patch_type: string;
  target: string;
  title: string;
  description: string | null;
  rationale: string | null;
  suggested_attribution_id: string | null;
  priority: number;
  estimated_effort: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  applied_by: string | null;
  patch_data: string;
  metadata: string | null;
}

interface RawEffectRow {
  effect_id: string;
  patch_id: string;
  workflow_id: string | null;
  node_id: string | null;
  effect_type: string;
  metric_name: string;
  metric_value_before: number | null;
  metric_value_after: number | null;
  improvement_pct: number | null;
  measured_at: string;
  notes: string | null;
}

function rowToEffect(r: RawEffectRow): PatchEffect {
  return {
    effectId: r.effect_id,
    patchId: r.patch_id,
    workflowId: r.workflow_id ?? undefined,
    nodeId: r.node_id ?? undefined,
    effectType: r.effect_type,
    metricName: r.metric_name,
    metricValueBefore: r.metric_value_before ?? undefined,
    metricValueAfter: r.metric_value_after ?? undefined,
    improvementPct: r.improvement_pct ?? undefined,
    measuredAt: r.measured_at,
    notes: r.notes ?? undefined,
  };
}

interface RawReviewRow {
  review_id: string;
  patch_id: string;
  reviewer: string;
  decision: string;
  comments: string | null;
  reviewed_at: string;
}

function rowToReview(r: RawReviewRow): PatchReview {
  return {
    reviewId: r.review_id,
    patchId: r.patch_id,
    reviewer: r.reviewer,
    decision: r.decision,
    comments: r.comments ?? undefined,
    reviewedAt: r.reviewed_at,
  };
}

export interface PatchStats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  applicationRate: number;
}
