/**
 * Lineage 追踪器 (Lineage Tracker)
 *
 * 追踪工作流产物的来源和依赖关系，支持溯源查询。
 *
 * 源码参考: _personal_copilot/src/workflows/self_iteration/lineage_tracker.py
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Artifact, ArtifactType, LineageChain } from "./models.js";

// ============================================================================
// LineageTracker
// ============================================================================

export class LineageTracker {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? path.join(process.cwd(), ".openclaw", "self-iteration", "lineage.db");
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS lineage (
				artifact_id TEXT PRIMARY KEY,
				artifact_type TEXT NOT NULL,
				created_by TEXT NOT NULL,
				workflow_id TEXT NOT NULL,
				parent_artifacts TEXT,
				timestamp TEXT DEFAULT (datetime('now')),
				content_hash TEXT,
				content TEXT,
				metadata TEXT
			)
		`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_lineage_workflow ON lineage(workflow_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_lineage_created_by ON lineage(created_by)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_lineage_type ON lineage(artifact_type)");
  }

  /** 记录产物 */
  recordArtifact(artifact: Omit<Artifact, "timestamp" | "contentHash">): string {
    const contentHash = computeHash(artifact.content);
    const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO lineage (artifact_id, artifact_type, created_by, workflow_id, parent_artifacts, content_hash, content, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
    stmt.run(
      artifact.artifactId,
      artifact.artifactType,
      artifact.createdBy,
      artifact.workflowId,
      JSON.stringify(artifact.parentArtifacts ?? []),
      contentHash,
      JSON.stringify(artifact.content),
      JSON.stringify(artifact.metadata ?? {}),
    );
    return artifact.artifactId;
  }

  /** 获取产物 */
  getArtifact(artifactId: string): Artifact | undefined {
    const stmt = this.db.prepare("SELECT * FROM lineage WHERE artifact_id = ?");
    const row = stmt.get(artifactId) as RawRow | undefined;
    return row ? rowToArtifact(row) : undefined;
  }

  /** 溯源：追踪一个产物的完整来源链 */
  traceProvenance(artifactId: string): LineageChain {
    const chain: Array<Record<string, unknown>> = [];
    const visited = new Set<string>();
    let currentId: string | undefined = artifactId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const artifact = this.getArtifact(currentId);
      if (!artifact) break;

      chain.push({
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        createdBy: artifact.createdBy,
        workflowId: artifact.workflowId,
        contentHash: artifact.contentHash,
        timestamp: artifact.timestamp,
      });

      // 追踪第一个父产物
      currentId = artifact.parentArtifacts.length > 0 ? artifact.parentArtifacts[0] : undefined;
    }

    // 从根到当前（反转）
    chain.reverse();

    return {
      artifactId,
      chain,
      isComplete:
        chain.length > 0 && !(chain[0] as { parentArtifacts?: string[] }).parentArtifacts?.length,
      depth: chain.length,
    };
  }

  /** 查找相关产物（兄弟和子代） */
  findRelated(artifactId: string): Artifact[] {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) return [];

    const results: Artifact[] = [];
    const seen = new Set<string>([artifactId]);

    // 同父兄弟
    if (artifact.parentArtifacts.length > 0) {
      for (const parentId of artifact.parentArtifacts) {
        const stmt = this.db.prepare(
          "SELECT * FROM lineage WHERE parent_artifacts LIKE ? AND artifact_id != ?",
        );
        const siblings = (stmt.all(`%${parentId}%`, artifactId) as RawRow[]).map(rowToArtifact);
        for (const s of siblings) {
          if (!seen.has(s.artifactId)) {
            seen.add(s.artifactId);
            results.push(s);
          }
        }
      }
    }

    // 子代（当前产物是某个子产物的 parent）
    const childStmt = this.db.prepare("SELECT * FROM lineage WHERE parent_artifacts LIKE ?");
    const children = (childStmt.all(`%${artifactId}%`) as RawRow[]).map(rowToArtifact);
    for (const c of children) {
      if (!seen.has(c.artifactId)) {
        seen.add(c.artifactId);
        results.push(c);
      }
    }

    return results;
  }

  /** 统计 */
  getStatistics(): LineageStats {
    const total = (this.db.prepare("SELECT COUNT(*) as cnt FROM lineage").get() as { cnt: number })
      .cnt;

    const byType = this.db
      .prepare("SELECT artifact_type, COUNT(*) as cnt FROM lineage GROUP BY artifact_type")
      .all() as Array<{ artifact_type: string; cnt: number }>;

    const byWorkflow = this.db
      .prepare(
        "SELECT workflow_id, COUNT(*) as cnt FROM lineage GROUP BY workflow_id ORDER BY cnt DESC LIMIT 10",
      )
      .all() as Array<{ workflow_id: string; cnt: number }>;

    return {
      total,
      byType: Object.fromEntries(byType.map((r) => [r.artifact_type, r.cnt])),
      byWorkflow: Object.fromEntries(byWorkflow.map((r) => [r.workflow_id, r.cnt])),
    };
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// 内部工具
// ============================================================================

function computeHash(content: unknown): string {
  const str = typeof content === "string" ? content : JSON.stringify(content);
  return crypto.createHash("md5").update(str).digest("hex");
}

interface RawRow {
  artifact_id: string;
  artifact_type: string;
  created_by: string;
  workflow_id: string;
  parent_artifacts: string | null;
  timestamp: string;
  content_hash: string | null;
  content: string | null;
  metadata: string | null;
}

function rowToArtifact(row: RawRow): Artifact {
  return {
    artifactId: row.artifact_id,
    artifactType: row.artifact_type as ArtifactType,
    createdBy: row.created_by,
    workflowId: row.workflow_id,
    parentArtifacts: row.parent_artifacts ? (JSON.parse(row.parent_artifacts) as string[]) : [],
    timestamp: row.timestamp,
    contentHash: row.content_hash ?? "",
    content: row.content ? JSON.parse(row.content) : null,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
  };
}

export interface LineageStats {
  total: number;
  byType: Record<string, number>;
  byWorkflow: Record<string, number>;
}
