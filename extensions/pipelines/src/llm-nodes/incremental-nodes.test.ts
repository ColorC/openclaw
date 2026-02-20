/**
 * Incremental Nodes Tests
 *
 * Unit tests for the 3 incremental workflow nodes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  ArchitectureSnapshot,
  ModuleDefinition,
  InterfaceDefinition,
  EntityDefinition,
} from "../workflows/states.js";
import { IncrementalDB } from "../pm/incremental-db.js";
import { applyDelta } from "./incremental-nodes.js";

function genProjectId(): string {
  return `proj_${crypto.randomUUID().slice(0, 8)}`;
}

describe("Incremental Nodes", () => {
  let tempDir: string;
  let db: IncrementalDB;
  let projectId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "incremental-nodes-test-"));
    db = new IncrementalDB(join(tempDir, "test.db"));
    const project = db.createProject({
      id: genProjectId(),
      name: "Test Project",
      projectRoot: "/test-project",
      openspecSchema: "spec-driven",
      currentVersion: 0,
      scenario: "modify_existing",
    });
    projectId = project.id;
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("applyDelta", () => {
    it("adds new modules", () => {
      const existing: ArchitectureSnapshot = {
        modules: [{ id: "auth", name: "Auth", description: "Authentication" }],
        interfaces: [],
        entities: [],
        apiEndpoints: [],
        domains: [],
      };

      const delta = {
        addedModules: [
          { id: "oauth", name: "OAuth", description: "OAuth Provider" } as ModuleDefinition,
        ],
        addedInterfaces: [],
        addedEntities: [],
        modifiedModules: [],
        modifiedInterfaces: [],
        modifiedEntities: [],
        removedModules: [],
        removedInterfaces: [],
        removedEntities: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.modules).toHaveLength(2);
      expect(result.modules.find((m) => m.id === "oauth")).toBeDefined();
    });

    it("modifies existing modules", () => {
      const existing: ArchitectureSnapshot = {
        modules: [
          { id: "auth", name: "Auth", description: "Authentication" },
        ] as ModuleDefinition[],
        interfaces: [],
        entities: [],
        apiEndpoints: [],
        domains: [],
      };

      const delta = {
        addedModules: [],
        addedInterfaces: [],
        addedEntities: [],
        modifiedModules: [
          {
            id: "auth",
            changes: { description: "Updated authentication with OAuth" },
            reason: "Add OAuth support",
          },
        ],
        modifiedInterfaces: [],
        modifiedEntities: [],
        removedModules: [],
        removedInterfaces: [],
        removedEntities: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].description).toBe("Updated authentication with OAuth");
    });

    it("removes modules", () => {
      const existing: ArchitectureSnapshot = {
        modules: [
          { id: "auth", name: "Auth", description: "Authentication" },
          { id: "legacy", name: "Legacy", description: "Old module" },
        ] as ModuleDefinition[],
        interfaces: [],
        entities: [],
        apiEndpoints: [],
        domains: [],
      };

      const delta = {
        addedModules: [],
        addedInterfaces: [],
        addedEntities: [],
        modifiedModules: [],
        modifiedInterfaces: [],
        modifiedEntities: [],
        removedModules: [{ id: "legacy", reason: "Deprecated" }],
        removedInterfaces: [],
        removedEntities: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.modules).toHaveLength(1);
      expect(result.modules.find((m) => m.id === "legacy")).toBeUndefined();
    });

    it("applies operations in correct order: remove → modify → add", () => {
      // This test ensures that if a module is both removed and re-added,
      // the final state reflects the new module
      const existing: ArchitectureSnapshot = {
        modules: [{ id: "auth", name: "Auth", description: "Old auth" }] as ModuleDefinition[],
        interfaces: [],
        entities: [],
        apiEndpoints: [],
        domains: [],
      };

      const delta = {
        addedModules: [
          { id: "auth", name: "New Auth", description: "New auth with OAuth" } as ModuleDefinition,
        ],
        addedInterfaces: [],
        addedEntities: [],
        modifiedModules: [],
        modifiedInterfaces: [],
        modifiedEntities: [],
        removedModules: [{ id: "auth", reason: "Replace with OAuth version" }],
        removedInterfaces: [],
        removedEntities: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].description).toBe("New auth with OAuth");
    });

    it("handles interfaces and entities", () => {
      const existing: ArchitectureSnapshot = {
        modules: [],
        interfaces: [
          { id: "iuser", name: "IUser", description: "User interface" },
        ] as InterfaceDefinition[],
        entities: [{ id: "user", name: "User", description: "User entity" }] as EntityDefinition[],
        apiEndpoints: [],
        domains: [],
      };

      const delta = {
        addedModules: [],
        addedInterfaces: [
          { id: "ioauth", name: "IOAuth", description: "OAuth interface" } as InterfaceDefinition,
        ],
        addedEntities: [
          { id: "token", name: "Token", description: "Auth token" } as EntityDefinition,
        ],
        modifiedModules: [],
        modifiedInterfaces: [
          { id: "iuser", changes: { description: "User with OAuth" }, reason: "Add OAuth" },
        ],
        modifiedEntities: [],
        removedEntities: [{ id: "user", reason: "Replace with OAuth user" }],
        removedModules: [],
        removedInterfaces: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.interfaces).toHaveLength(2);
      expect(result.interfaces.find((i) => i.id === "ioauth")).toBeDefined();
      expect(result.interfaces.find((i) => i.id === "iuser")?.description).toBe("User with OAuth");

      expect(result.entities).toHaveLength(1);
      expect(result.entities.find((e) => e.id === "token")).toBeDefined();
    });

    it("preserves other architecture fields", () => {
      const existing: ArchitectureSnapshot = {
        selectedPattern: "hexagonal",
        modules: [{ id: "core", name: "Core" }] as ModuleDefinition[],
        interfaces: [],
        entities: [],
        apiEndpoints: [],
        domains: [{ id: "auth", name: "Auth Domain" }],
        fileStructure: { src: { modules: ["core"] } },
      };

      const delta = {
        addedModules: [],
        addedInterfaces: [],
        addedEntities: [],
        modifiedModules: [],
        modifiedInterfaces: [],
        modifiedEntities: [],
        removedModules: [],
        removedInterfaces: [],
        removedEntities: [],
      };

      const result = applyDelta(existing, delta);

      expect(result.selectedPattern).toBe("hexagonal");
      expect(result.domains).toHaveLength(1);
      expect(result.fileStructure).toEqual({ src: { modules: ["core"] } });
    });
  });

  describe("database integration", () => {
    it("can create architecture snapshot and retrieve it", () => {
      const architectureJson: ArchitectureSnapshot = {
        selectedPattern: "layered",
        modules: [
          { id: "api", name: "API Layer" },
          { id: "service", name: "Service Layer" },
        ] as ModuleDefinition[],
        interfaces: [{ id: "irepo", name: "IRepository" } as InterfaceDefinition],
        entities: [],
        apiEndpoints: [],
        domains: [],
      };

      db.createSnapshot({
        projectId,
        version: 0,
        snapshotType: "architecture",
        contentHash: "v0-arch",
        architectureJson,
      });

      const snapshot = db.getLatestSnapshot(projectId, "architecture");
      expect(snapshot).toBeDefined();
      expect(snapshot?.architectureJson?.selectedPattern).toBe("layered");
      expect(snapshot?.architectureJson?.modules).toHaveLength(2);
    });

    it("can store and retrieve impact summary", () => {
      const change = db.createChangeRecord({
        projectId,
        changeName: "Add Feature",
        versionBefore: 0,
        status: "designing",
      });

      db.updateChangeImpact(change.id!, {
        affectedModules: ["api", "service"],
        affectedInterfaces: ["irepo"],
        affectedEntities: [],
        affectedEndpoints: [],
        affectedSpecs: [],
        impactLevel: "medium",
        reasoning: "API extension requires service changes",
      });

      const reloaded = db.getChangeRecord(change.id!);
      expect(reloaded?.impactSummary?.affectedModules).toContain("api");
      expect(reloaded?.impactSummary?.impactLevel).toBe("medium");
    });

    it("can store and retrieve delta summary", () => {
      const change = db.createChangeRecord({
        projectId,
        changeName: "Refactor Module",
        versionBefore: 0,
        status: "ready",
      });

      db.updateChangeDelta(change.id!, {
        added: [{ type: "module", id: "utils", description: "Utility functions" }],
        modified: [{ type: "module", id: "core", description: "Core", changes: "Extract utils" }],
        removed: [],
        renamed: [{ type: "module", from: "helpers", to: "utils" }],
      });

      const reloaded = db.getChangeRecord(change.id!);
      expect(reloaded?.deltaSummary?.added).toHaveLength(1);
      expect(reloaded?.deltaSummary?.renamed).toHaveLength(1);
    });
  });
});
