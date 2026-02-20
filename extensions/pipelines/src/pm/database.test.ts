/**
 * PMDatabase 单元测试
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PMDatabase } from "./database.js";

async function withTempDb(fn: (db: PMDatabase, dbPath: string) => Promise<void>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-db-"));
  const dbPath = path.join(tempDir, "pm.db");
  const db = new PMDatabase(dbPath);
  try {
    await fn(db, dbPath);
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("PMDatabase", () => {
  describe("Requirements CRUD", () => {
    it("creates a requirement", async () => {
      await withTempDb(async (db) => {
        const req = db.createRequirement({
          id: "req-001",
          description: "实现用户登录功能",
          category: "authentication",
          priority: "high",
        });

        expect(req.id).toBe("req-001");
        expect(req.description).toBe("实现用户登录功能");
        expect(req.category).toBe("authentication");
        expect(req.priority).toBe("high");
        expect(req.status).toBe("pending");
        expect(req.createdAt).toBeDefined();
      });
    });

    it("gets a requirement by id", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({
          id: "req-001",
          description: "Test requirement",
        });

        const req = db.getRequirement("req-001");
        expect(req).toBeDefined();
        expect(req?.description).toBe("Test requirement");
      });
    });

    it("returns undefined for non-existent requirement", async () => {
      await withTempDb(async (db) => {
        const req = db.getRequirement("non-existent");
        expect(req).toBeUndefined();
      });
    });

    it("lists all requirements with filters", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Task 1" });
        db.createRequirement({ id: "req-002", description: "Task 2" });
        db.createRequirement({ id: "req-003", description: "Task 3", projectId: "proj-1" });
        db.updateRequirementStatus("req-002", "in_progress");

        const all = db.getAllRequirements();
        expect(all.length).toBe(3);

        const pending = db.getAllRequirements({ status: "pending" });
        expect(pending.length).toBe(2);

        const proj1 = db.getAllRequirements({ projectId: "proj-1" });
        expect(proj1.length).toBe(1);
        expect(proj1[0].id).toBe("req-003");
      });
    });

    it("updates requirement status", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Task" });

        const updated = db.updateRequirementStatus("req-001", "in_progress", "agent-1");
        expect(updated?.status).toBe("in_progress");
        expect(updated?.assignedAgent).toBe("agent-1");
        expect(updated?.startTime).toBeDefined();

        const completed = db.updateRequirementStatus("req-001", "completed");
        expect(completed?.status).toBe("completed");
        expect(completed?.endTime).toBeDefined();
      });
    });

    it("updates requirement fields", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Original" });

        const updated = db.updateRequirement("req-001", {
          description: "Updated description",
          priority: "critical",
          estimate: 8,
          estimateUnit: "hours",
          tags: ["backend", "api"],
        });

        expect(updated?.description).toBe("Updated description");
        expect(updated?.priority).toBe("critical");
        expect(updated?.estimate).toBe(8);
        expect(updated?.tags).toEqual(["backend", "api"]);
      });
    });

    it("deletes a requirement", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "To delete" });

        expect(db.deleteRequirement("req-001")).toBe(true);
        expect(db.getRequirement("req-001")).toBeUndefined();
        expect(db.deleteRequirement("non-existent")).toBe(false);
      });
    });

    it("supports hierarchical requirements", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "parent", description: "Parent task" });
        db.createRequirement({ id: "child-1", description: "Child 1", parentId: "parent" });
        db.createRequirement({ id: "child-2", description: "Child 2", parentId: "parent" });

        const children = db.getAllRequirements({ parentId: "parent" });
        expect(children.length).toBe(2);

        const tree = db.getRequirementTree("parent");
        expect(tree.length).toBe(3); // parent + 2 children
      });
    });

    it("stores INVEST score and acceptance criteria", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({
          id: "req-001",
          description: "Story",
          investScore: { independent: 0.9, negotiable: 0.8, valuable: 1.0 },
          acceptanceCriteria: [
            { criterion: "User can login", status: "pending" },
            { criterion: "Session expires after 30 min", status: "pending" },
          ],
        });

        const req = db.getRequirement("req-001");
        expect(req?.investScore).toEqual({ independent: 0.9, negotiable: 0.8, valuable: 1.0 });
        expect(req?.acceptanceCriteria).toHaveLength(2);
        expect(req?.acceptanceCriteria?.[0].criterion).toBe("User can login");
      });
    });
  });

  describe("Dependencies", () => {
    it("creates and retrieves dependencies", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Task A" });
        db.createRequirement({ id: "req-002", description: "Task B" });

        const dep = db.createDependency("req-001", "req-002", "blocking");
        expect(dep.sourceRequirementId).toBe("req-001");
        expect(dep.targetRequirementId).toBe("req-002");
        expect(dep.dependencyType).toBe("blocking");

        const deps = db.getDependencies("req-001");
        expect(deps.blocking.length).toBe(1);
        expect(deps.blockedBy.length).toBe(0);

        const reverseDeps = db.getDependencies("req-002");
        expect(reverseDeps.blocking.length).toBe(0);
        expect(reverseDeps.blockedBy.length).toBe(1);
      });
    });

    it("deletes a dependency", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "A" });
        db.createRequirement({ id: "req-002", description: "B" });
        const dep = db.createDependency("req-001", "req-002");

        expect(db.deleteDependency(dep.id!)).toBe(true);
        expect(db.deleteDependency(999)).toBe(false);
      });
    });
  });

  describe("Argument History", () => {
    it("logs arguments between requirements", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "A" });
        db.createRequirement({ id: "req-002", description: "B" });

        const arg = db.logArgument({
          argueType: "intra_workflow",
          sourceRequirementId: "req-001",
          targetRequirementId: "req-002",
          argueReason: "Conflicting priorities",
          resolution: "escalate_to_user",
        });

        expect(arg.id).toBeDefined();
        expect(arg.argueReason).toBe("Conflicting priorities");

        const args = db.getArguments("req-001");
        expect(args.length).toBe(1);

        const req = db.getRequirement("req-001");
        expect(req?.argueCount).toBe(1);
      });
    });
  });

  describe("Performance Metrics", () => {
    it("logs and retrieves performance metrics", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Task" });

        const metric = db.logPerformance({
          requirementId: "req-001",
          workflowName: "generation",
          agentName: "claude",
          executionTimeSeconds: 45,
          totalTokens: 1500,
          llmCallsCount: 3,
          qualityScore: 0.85,
          testCoverage: 0.9,
        });

        expect(metric.id).toBeDefined();

        const metrics = db.getPerformanceMetrics("req-001");
        expect(metrics.length).toBe(1);
        expect(metrics[0].executionTimeSeconds).toBe(45);
        expect(metrics[0].totalTokens).toBe(1500);
      });
    });
  });

  describe("Documents", () => {
    it("upserts and retrieves documents", async () => {
      await withTempDb(async (db) => {
        const doc = db.upsertDocument({
          documentId: "doc-001",
          filePath: "/docs/spec.md",
          fileName: "spec.md",
          documentHash: "abc123",
          title: "API Specification",
          totalTasks: 5,
          completedTasks: 2,
        });

        expect(doc.documentId).toBe("doc-001");

        // Update existing document
        db.upsertDocument({
          documentId: "doc-001",
          filePath: "/docs/spec.md",
          fileName: "spec.md",
          documentHash: "def456",
          title: "API Specification v2",
          totalTasks: 6,
          completedTasks: 3,
        });

        const retrieved = db.getDocument("doc-001");
        expect(retrieved?.documentHash).toBe("def456");
        expect(retrieved?.totalTasks).toBe(6);
      });
    });
  });

  describe("Comments", () => {
    it("adds and retrieves comments", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "req-001", description: "Task" });

        const comment = db.addComment({
          requirementId: "req-001",
          comment: "This needs more detail",
          author: "user-1",
          commentType: "suggestion",
        });

        expect(comment.id).toBeDefined();

        const comments = db.getComments("req-001");
        expect(comments.length).toBe(1);
        expect(comments[0].author).toBe("user-1");
      });
    });
  });

  describe("Statistics", () => {
    it("returns correct statistics", async () => {
      await withTempDb(async (db) => {
        db.createRequirement({ id: "r1", description: "A" });
        db.createRequirement({ id: "r2", description: "B" });
        db.createRequirement({ id: "r3", description: "C" });
        db.updateRequirementStatus("r1", "in_progress");
        db.updateRequirementStatus("r2", "completed");
        db.updateRequirementStatus("r3", "failed");

        const stats = db.getStats();
        expect(stats.total).toBe(3);
        expect(stats.pending).toBe(0);
        expect(stats.inProgress).toBe(1);
        expect(stats.completed).toBe(1);
        expect(stats.failed).toBe(1);
      });
    });
  });
});
