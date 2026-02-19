/**
 * IncrementalDB Tests
 *
 * Tests for the 3 tables and CRUD operations of the incremental modification database.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IncrementalDB } from "./incremental-db.js";

function genProjectId(): string {
  return `proj_${crypto.randomUUID().slice(0, 8)}`;
}

describe("IncrementalDB", () => {
  let tempDir: string;
  let db: IncrementalDB;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "incremental-db-test-"));
    db = new IncrementalDB(join(tempDir, "test.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("projects table", () => {
    it("creates a project", () => {
      const project = db.createProject({
        id: genProjectId(),
        name: "Test Project",
        projectRoot: "/path/to/project",
        scenario: "new_project",
        openspecSchema: "spec-driven",
        currentVersion: 0,
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Test Project");
      expect(project.projectRoot).toBe("/path/to/project");
      expect(project.currentVersion).toBe(0);
      expect(project.scenario).toBe("new_project");
    });

    it("gets project by root", () => {
      db.createProject({
        id: genProjectId(),
        name: "Project A",
        projectRoot: "/path/a",
        openspecSchema: "spec-driven",
        currentVersion: 0,
        scenario: "new_project",
      });

      const found = db.getProjectByRoot("/path/a");
      expect(found?.name).toBe("Project A");

      const notFound = db.getProjectByRoot("/nonexistent");
      expect(notFound).toBeUndefined();
    });

    it("updates project version", () => {
      const project = db.createProject({
        id: genProjectId(),
        name: "Versioned Project",
        projectRoot: "/versioned",
        openspecSchema: "spec-driven",
        currentVersion: 0,
        scenario: "new_project",
      });

      db.updateProjectVersion(project.id, 2);

      const reloaded = db.getProjectByRoot("/versioned");
      expect(reloaded?.currentVersion).toBe(2);
    });

    it("enforces unique project root", () => {
      db.createProject({
        id: genProjectId(),
        name: "First",
        projectRoot: "/duplicate",
        openspecSchema: "spec-driven",
        currentVersion: 0,
        scenario: "new_project",
      });

      expect(() => {
        db.createProject({
          id: genProjectId(),
          name: "Second",
          projectRoot: "/duplicate",
          openspecSchema: "spec-driven",
          currentVersion: 0,
          scenario: "new_project",
        });
      }).toThrow();
    });

    it("gets or creates project", () => {
      const project1 = db.getOrCreateProject("/auto-create", "Auto Project");
      expect(project1.name).toBe("Auto Project");
      expect(project1.projectRoot).toBe("/auto-create");

      const project2 = db.getOrCreateProject("/auto-create");
      expect(project2.id).toBe(project1.id);
    });
  });

  describe("version_snapshots table", () => {
    let projectId: string;

    beforeEach(() => {
      const project = db.createProject({
        id: genProjectId(),
        name: "Snapshot Test",
        projectRoot: "/snapshot-test",
        openspecSchema: "spec-driven",
        currentVersion: 0,
        scenario: "new_project",
      });
      projectId = project.id;
    });

    it("creates a requirement snapshot", () => {
      const snapshot = db.createSnapshot({
        projectId,
        version: 1,
        snapshotType: "requirement",
        contentHash: "abc123",
      });

      expect(snapshot.id).toBeDefined();
      expect(snapshot.projectId).toBe(projectId);
      expect(snapshot.version).toBe(1);
      expect(snapshot.snapshotType).toBe("requirement");
    });

    it("creates an architecture snapshot", () => {
      const snapshot = db.createSnapshot({
        projectId,
        version: 1,
        snapshotType: "architecture",
        contentHash: "def456",
      });

      expect(snapshot.snapshotType).toBe("architecture");
    });

    it("gets latest snapshot", () => {
      db.createSnapshot({
        projectId,
        version: 1,
        snapshotType: "requirement",
        contentHash: "v1",
      });

      db.createSnapshot({
        projectId,
        version: 2,
        snapshotType: "requirement",
        contentHash: "v2",
      });

      const latest = db.getLatestSnapshot(projectId, "requirement");
      expect(latest?.version).toBe(2);
      expect(latest?.contentHash).toBe("v2");
    });

    it("returns undefined when no snapshot exists", () => {
      const latest = db.getLatestSnapshot(projectId, "architecture");
      expect(latest).toBeUndefined();
    });

    it("gets snapshot history in descending order", () => {
      db.createSnapshot({
        projectId,
        version: 1,
        snapshotType: "requirement",
        contentHash: "v1",
      });
      db.createSnapshot({
        projectId,
        version: 2,
        snapshotType: "requirement",
        contentHash: "v2",
      });
      db.createSnapshot({
        projectId,
        version: 3,
        snapshotType: "requirement",
        contentHash: "v3",
      });

      const history = db.getSnapshotHistory(projectId, "requirement");
      expect(history).toHaveLength(3);
      expect(history.map((s) => s.version)).toEqual([3, 2, 1]);
    });

    it("enforces unique project + version + type", () => {
      db.createSnapshot({
        projectId,
        version: 1,
        snapshotType: "requirement",
        contentHash: "v1",
      });

      expect(() => {
        db.createSnapshot({
          projectId,
          version: 1,
          snapshotType: "requirement",
          contentHash: "v2",
        });
      }).toThrow();
    });
  });

  describe("change_records table", () => {
    let projectId: string;

    beforeEach(() => {
      const project = db.createProject({
        id: genProjectId(),
        name: "Change Record Test",
        projectRoot: "/change-test",
        openspecSchema: "spec-driven",
        currentVersion: 0,
        scenario: "new_project",
      });
      projectId = project.id;
    });

    it("creates a change record", () => {
      const record = db.createChangeRecord({
        projectId,
        changeName: "Add User Authentication",
        versionBefore: 1,
        changeDescription: "Add OAuth2 login flow",
        status: "pending",
      });

      expect(record.id).toBeDefined();
      expect(record.changeName).toBe("Add User Authentication");
      expect(record.status).toBe("pending");
    });

    it("updates change status", () => {
      const record = db.createChangeRecord({
        projectId,
        changeName: "Test Change",
        versionBefore: 1,
        status: "pending",
      });

      db.updateChangeStatus(record.id!, "designing");
      const designing = db.getChangeRecord(record.id!);
      expect(designing?.status).toBe("designing");

      db.updateChangeStatus(record.id!, "applied", 2);
      const applied = db.getChangeRecord(record.id!);
      expect(applied?.status).toBe("applied");
      expect(applied?.versionAfter).toBe(2);
      expect(applied?.appliedAt).toBeDefined();
    });

    it("gets active changes (excludes applied and failed)", () => {
      db.createChangeRecord({
        projectId,
        changeName: "Pending Change",
        versionBefore: 1,
        status: "pending",
      });

      const appliedRecord = db.createChangeRecord({
        projectId,
        changeName: "Applied Change",
        versionBefore: 1,
        status: "pending",
      });
      db.updateChangeStatus(appliedRecord.id!, "applied", 2);

      const active = db.getActiveChanges(projectId);
      expect(active).toHaveLength(1);
      expect(active[0].changeName).toBe("Pending Change");
    });

    it("stores and retrieves impact/delta via update methods", () => {
      const record = db.createChangeRecord({
        projectId,
        changeName: "Complex Change",
        versionBefore: 1,
        status: "designing",
      });

      db.updateChangeImpact(record.id!, {
        affectedModules: ["auth", "user"],
        affectedInterfaces: [],
        affectedEntities: [],
        affectedEndpoints: [],
        affectedSpecs: [],
        impactLevel: "high",
        reasoning: "Auth module needs OAuth support",
      });

      db.updateChangeDelta(record.id!, {
        added: [{ type: "module", id: "session", description: "Session management" }],
        modified: [
          { type: "module", id: "user", description: "User module", changes: "Add OAuth fields" },
        ],
        removed: [],
        renamed: [],
      });

      const reloaded = db.getChangeRecord(record.id!);
      expect(reloaded?.impactSummary?.affectedModules).toContain("auth");
      expect(reloaded?.impactSummary?.impactLevel).toBe("high");
      expect(reloaded?.deltaSummary?.added).toHaveLength(1);
    });
  });

  describe("cross-table workflows", () => {
    it("supports full incremental modification workflow", () => {
      // 1. Create project
      const project = db.getOrCreateProject("/full-workflow", "Full Workflow Test");

      // 2. Create initial snapshots (v0)
      db.createSnapshot({
        projectId: project.id,
        version: 0,
        snapshotType: "requirement",
        contentHash: "initial-req",
      });

      db.createSnapshot({
        projectId: project.id,
        version: 0,
        snapshotType: "architecture",
        contentHash: "initial-arch",
      });

      // 3. Create change record
      const change = db.createChangeRecord({
        projectId: project.id,
        changeName: "Add OAuth Support",
        versionBefore: 0,
        changeDescription: "Add Google OAuth login",
        status: "designing",
      });

      // 4. Update change status to ready
      db.updateChangeStatus(change.id!, "ready");
      const readyChange = db.getChangeRecord(change.id!);
      expect(readyChange?.status).toBe("ready");

      // 5. Create new snapshots (v1)
      db.createSnapshot({
        projectId: project.id,
        version: 1,
        snapshotType: "requirement",
        contentHash: "v1-req",
      });

      db.createSnapshot({
        projectId: project.id,
        version: 1,
        snapshotType: "architecture",
        contentHash: "v1-arch",
      });

      // 6. Apply change
      db.updateChangeStatus(change.id!, "applied", 1);
      db.updateProjectVersion(project.id, 1);

      // 7. Verify final state
      const finalProject = db.getProjectByRoot("/full-workflow");
      expect(finalProject?.currentVersion).toBe(1);

      const latestReq = db.getLatestSnapshot(project.id, "requirement");
      expect(latestReq?.version).toBe(1);

      const history = db.getSnapshotHistory(project.id, "architecture");
      expect(history).toHaveLength(2);

      const activeChanges = db.getActiveChanges(project.id);
      expect(activeChanges).toHaveLength(0); // applied change is no longer active
    });
  });
});
