/**
 * ProjectDocManager 单元测试
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectDocManager } from "./project-doc-manager.js";

async function withDocManager(fn: (mgr: ProjectDocManager, rootDir: string) => Promise<void>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdm-"));
  const mgr = new ProjectDocManager({
    projectName: "test-project",
    projectRoot: path.join(tempDir, "test-project"),
  });
  try {
    await fn(mgr, tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("ProjectDocManager", () => {
  describe("File Doc Management", () => {
    it("saves and retrieves file doc", async () => {
      await withDocManager(async (mgr) => {
        const save = mgr.saveFileDoc("src/main.ts", "# Main Module\nEntry point.", {
          author: "system",
        });
        expect(save.success).toBe(true);

        const get = mgr.getFileDoc("src/main.ts");
        expect(get.success).toBe(true);
        expect(get.data!.content).toContain("# Main Module");
        expect(get.data!.content).toContain("file_path: src/main.ts");
      });
    });

    it("saves directory doc", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveFileDoc("src/agents", "# Agents directory");
        const get = mgr.getFileDoc("src/agents");
        expect(get.success).toBe(true);
        expect(get.data!.content).toContain("# Agents directory");
      });
    });

    it("returns error for non-existent doc", async () => {
      await withDocManager(async (mgr) => {
        const result = mgr.getFileDoc("nonexistent.ts");
        expect(result.success).toBe(false);
        expect(result.error).toBe("DocNotFound");
      });
    });
  });

  describe("Standards Management", () => {
    it("saves and retrieves standard", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveStandard("agent_standard", "# Agent Standard\nRules...", "2.0");
        const result = mgr.getStandard("agent_standard");
        expect(result.success).toBe(true);
        expect(result.data!.content).toContain("# Agent Standard");
        expect(result.data!.version).toBe("2.0");
      });
    });

    it("returns error for non-existent standard", async () => {
      await withDocManager(async (mgr) => {
        const result = mgr.getStandard("nonexistent");
        expect(result.success).toBe(false);
        expect(result.error).toBe("StandardNotFound");
      });
    });

    it("updates standard version", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveStandard("tool_standard", "v1", "1.0");
        mgr.saveStandard("tool_standard", "v2", "2.0");
        const result = mgr.getStandard("tool_standard");
        expect(result.data!.version).toBe("2.0");
        expect(result.data!.content).toBe("v2");
      });
    });
  });

  describe("Progress Tracking", () => {
    it("marks and retrieves progress", async () => {
      await withDocManager(async (mgr) => {
        mgr.markFileProgress("src/a.ts", "completed", "abc123", "Done");
        mgr.markFileProgress("src/b.ts", "in_progress");

        const all = mgr.getFileProgress();
        expect(all.success).toBe(true);
        expect(Object.keys(all.data!)).toHaveLength(2);

        const one = mgr.getFileProgress("src/a.ts");
        expect(one.success).toBe(true);
        expect(one.data!["src/a.ts"].status).toBe("completed");
        expect(one.data!["src/a.ts"].gitCommit).toBe("abc123");
      });
    });

    it("returns error for non-existent progress", async () => {
      await withDocManager(async (mgr) => {
        const result = mgr.getFileProgress("nonexistent.ts");
        expect(result.success).toBe(false);
      });
    });

    it("finds unmarked files", async () => {
      await withDocManager(async (mgr) => {
        mgr.markFileProgress("a.ts", "completed");
        const unmarked = mgr.getUnmarkedFiles(["a.ts", "b.ts", "c.ts"], 5);
        expect(unmarked).toEqual(["b.ts", "c.ts"]);
      });
    });
  });

  describe("History", () => {
    it("records and retrieves history", async () => {
      await withDocManager(async (mgr) => {
        mgr.recordFileHistory("src/main.ts", "analyzed", { lines: 100 });
        mgr.recordFileHistory("src/main.ts", "updated", { commit: "def456" });

        const history = mgr.getFileHistory("src/main.ts");
        expect(history).toHaveLength(2);
        expect(history[0].action).toBe("analyzed");
        expect(history[1].action).toBe("updated");
      });
    });

    it("returns empty for no history", async () => {
      await withDocManager(async (mgr) => {
        expect(mgr.getFileHistory("nonexistent.ts")).toEqual([]);
      });
    });
  });

  describe("Plans", () => {
    it("saves and retrieves plan", async () => {
      await withDocManager(async (mgr) => {
        mgr.savePlan("migration_plan", "# Migration\n1. Phase 1\n2. Phase 2");
        const result = mgr.getPlan("migration_plan");
        expect(result.success).toBe(true);
        expect(result.data!.content).toContain("# Migration");
      });
    });

    it("archives plan", async () => {
      await withDocManager(async (mgr) => {
        mgr.savePlan("old_plan", "Old content");
        const archiveResult = mgr.archivePlan("old_plan");
        expect(archiveResult.success).toBe(true);

        // Original should no longer exist
        expect(mgr.getPlan("old_plan").success).toBe(false);
      });
    });

    it("returns error for non-existent plan", async () => {
      await withDocManager(async (mgr) => {
        expect(mgr.getPlan("nonexistent").success).toBe(false);
        expect(mgr.archivePlan("nonexistent").success).toBe(false);
      });
    });

    it("updates plan progress", async () => {
      await withDocManager(async (mgr) => {
        mgr.updatePlanProgress("plan_1", { totalTasks: 10, completedTasks: 3 });
        mgr.updatePlanProgress("plan_1", { totalTasks: 10, completedTasks: 7 });

        // Verify by reading the JSON directly
        const progFile = path.join(mgr.plansDir, "plan_progress.json");
        const data = JSON.parse(await fs.readFile(progFile, "utf-8"));
        expect(data.plan_1.completedTasks).toBe(7);
      });
    });
  });

  describe("Checkpoint", () => {
    it("saves and loads checkpoint", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveCheckpoint({ lastFile: "src/a.ts", lastAction: "analyze", progress: { done: 5 } });
        const cp = mgr.loadCheckpoint();
        expect(cp).toBeDefined();
        expect(cp!.lastFile).toBe("src/a.ts");
        expect(cp!.progress).toEqual({ done: 5 });
        expect(cp!.savedAt).toBeDefined();
      });
    });

    it("returns undefined when no checkpoint", async () => {
      await withDocManager(async (mgr) => {
        expect(mgr.loadCheckpoint()).toBeUndefined();
      });
    });
  });

  describe("Wiki", () => {
    it("saves and retrieves wiki page", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveWikiPage("architecture", "# Architecture\nOverview...");
        const content = mgr.getWikiPage("architecture");
        expect(content).toContain("# Architecture");
      });
    });

    it("lists wiki pages", async () => {
      await withDocManager(async (mgr) => {
        mgr.saveWikiPage("arch", "# Arch");
        mgr.saveWikiPage("api_ref", "# API");
        const pages = mgr.listWikiPages();
        expect(pages).toContain("arch");
        expect(pages).toContain("api_ref");
        expect(pages).toHaveLength(2);
      });
    });

    it("returns undefined for non-existent page", async () => {
      await withDocManager(async (mgr) => {
        expect(mgr.getWikiPage("nonexistent")).toBeUndefined();
      });
    });
  });
});
