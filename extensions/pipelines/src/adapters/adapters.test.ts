/**
 * 适配器层测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { InvestScoreResult, SubRequirement } from "../maintenance/states.js";
import type { ExplorationFinding } from "../maintenance/states.js";
import type { CoderGraphState } from "../workflows/coder.js";
import { ProjectDocManager } from "../knowledge/project-doc-manager.js";
import { SemanticHeaderInjector } from "../knowledge/semantic-header.js";
import { SymidGenerator } from "../knowledge/symid-generator.js";
import { PMDatabase } from "../pm/database.js";
// architecture-to-tasks
import { modulesToTasks, moduleToTask, interfaceToTasks } from "./architecture-to-tasks.js";
// coder-to-quality
import { updateRequirementFromCoder } from "./coder-to-quality.js";
// decomposition-to-pm
import {
  convertInvestScore,
  subRequirementToCreateParams,
  importDecompositionResults,
} from "./decomposition-to-pm.js";
// exploration-to-knowledge
import { extractFilePaths, annotateDiscoveredFiles } from "./exploration-to-knowledge.js";
// knowledge-to-wiki
import { annotationsToDiscoveredFiles, synthesizeWikiPages } from "./knowledge-to-wiki.js";
// requirement-to-architecture
import {
  requirementTreeToText,
  decompositionToArchitectureInput,
} from "./requirement-to-architecture.js";
// status-enums
import {
  taskStatusToRequirementStatus,
  requirementStatusToTaskStatus,
  isTerminalStatus,
  needsIntervention,
} from "./status-enums.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adapter-test-"));
}

// ============================================================================
// status-enums
// ============================================================================

describe("status-enums", () => {
  it("maps TaskStatus to RequirementStatus", () => {
    expect(taskStatusToRequirementStatus("pending")).toBe("pending");
    expect(taskStatusToRequirementStatus("completed")).toBe("completed");
    expect(taskStatusToRequirementStatus("failed")).toBe("failed");
  });

  it("maps RequirementStatus to TaskStatus", () => {
    expect(requirementStatusToTaskStatus("pending")).toBe("pending");
    expect(requirementStatusToTaskStatus("argued")).toBe("blocked");
    expect(requirementStatusToTaskStatus("cancelled")).toBe("failed");
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
  });

  it("identifies intervention-needed statuses", () => {
    expect(needsIntervention("argued")).toBe(true);
    expect(needsIntervention("blocked")).toBe(true);
    expect(needsIntervention("pending")).toBe(false);
  });
});

// ============================================================================
// decomposition-to-pm
// ============================================================================

describe("decomposition-to-pm", () => {
  const sampleScore: InvestScoreResult = {
    independent: 0.8,
    negotiable: 0.7,
    valuable: 0.9,
    estimable: 0.6,
    small: 0.7,
    testable: 0.8,
    total: 0.75,
  };

  it("converts InvestScoreResult to InvestScore (drops total)", () => {
    const result = convertInvestScore(sampleScore);
    expect(result).toHaveProperty("independent", 0.8);
    expect(result).toHaveProperty("testable", 0.8);
    expect(result).not.toHaveProperty("total");
  });

  it("converts SubRequirement to createRequirement params", () => {
    const sub: SubRequirement = { id: "sub-1", description: "Test sub", category: "feature" };
    const params = subRequirementToCreateParams(sub, "parent-1", "proj-1", "high");
    expect(params.id).toBe("sub-1");
    expect(params.parentId).toBe("parent-1");
    expect(params.projectId).toBe("proj-1");
    expect(params.priority).toBe("high");
  });

  it("defaults priority to medium", () => {
    const sub: SubRequirement = { id: "sub-2", description: "Test", category: "task" };
    const params = subRequirementToCreateParams(sub, "parent-1");
    expect(params.priority).toBe("medium");
  });

  it("batch imports to PM database", () => {
    const dir = tmpDir();
    const db = new PMDatabase(path.join(dir, "pm.db"));
    // Create parent first
    db.createRequirement({ id: "parent-1", description: "Parent req" });

    const subs: SubRequirement[] = [
      { id: "sub-a", description: "Sub A", category: "feature" },
      { id: "sub-b", description: "Sub B", category: "bug" },
    ];
    const scores: InvestScoreResult[] = [sampleScore, sampleScore];

    const results = importDecompositionResults(db, subs, scores, "parent-1", "proj-1");
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("sub-a");
    expect(results[0].parentId).toBe("parent-1");

    // Verify in DB
    const fetched = db.getRequirement("sub-a");
    expect(fetched).toBeDefined();
    expect(fetched!.description).toBe("Sub A");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ============================================================================
// requirement-to-architecture
// ============================================================================

describe("requirement-to-architecture", () => {
  it("converts requirementTree to text", () => {
    const tree = {
      root: "实现用户管理",
      children: [
        { description: "用户注册", category: "feature" },
        { description: "用户登录", category: "feature" },
      ],
    };
    const text = requirementTreeToText(tree);
    expect(text).toContain("实现用户管理");
    expect(text).toContain("[feature] 用户注册");
  });

  it("handles empty tree", () => {
    expect(requirementTreeToText({})).toBe("");
  });

  it("builds architecture input from decomposition state", () => {
    const input = decompositionToArchitectureInput(
      {
        requirementDescription: "实现用户管理",
        requirementTree: { root: "实现用户管理", children: [] },
        subRequirements: [{ id: "s1", description: "Sub", category: "feature" }],
      },
      "new_project",
      "/tmp/project",
    );

    expect(input.requirement).toContain("实现用户管理");
    expect(input.scenario).toBe("new_project");
    expect(input.projectPath).toBe("/tmp/project");
    expect(input.projectContext.subRequirementCount).toBe(1);
  });
});

// ============================================================================
// architecture-to-tasks
// ============================================================================

describe("architecture-to-tasks", () => {
  const modules = [
    {
      id: "mod-1",
      name: "UserService",
      description: "User management",
      responsibilities: ["CRUD"],
      dependencies: [],
    },
  ];
  const interfaces = [
    {
      id: "iface-1",
      name: "IUserRepo",
      type: "repository" as const,
      methods: [
        { name: "findById", input: "string", output: "User", description: "Find user by ID" },
        { name: "save", input: "User", output: "void", description: "Save user" },
      ],
    },
  ];
  const opts = { requirementId: "req-1", projectId: "proj-1" };

  it("generates task from module", () => {
    const task = moduleToTask(modules[0], 0, opts);
    expect(task.taskId).toBe("task-mod-mod-1");
    expect(task.prompt).toContain("UserService");
    expect(task.requirementId).toBe("req-1");
  });

  it("generates tasks from interface methods", () => {
    const tasks = interfaceToTasks(interfaces[0], opts);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].prompt).toContain("findById");
  });

  it("generates all tasks from modules + interfaces", () => {
    const tasks = modulesToTasks(modules, interfaces, opts);
    expect(tasks).toHaveLength(3); // 1 module + 2 interface methods
  });

  it("handles empty inputs", () => {
    expect(modulesToTasks([], [], opts)).toHaveLength(0);
  });
});

// ============================================================================
// coder-to-quality
// ============================================================================

describe("coder-to-quality", () => {
  it("updates requirement status from coder result", () => {
    const dir = tmpDir();
    const db = new PMDatabase(path.join(dir, "pm.db"));
    db.createRequirement({ id: "req-1", description: "Test req" });

    const coderState = {
      success: true,
      qualityScore: 0.85,
      iterationCount: 3,
      modifiedFiles: ["file.ts"],
    } as unknown as CoderGraphState;

    const result = updateRequirementFromCoder(db, "req-1", coderState);
    expect(result).toBeDefined();
    expect(result!.status).toBe("completed");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks failed coder as failed", () => {
    const dir = tmpDir();
    const db = new PMDatabase(path.join(dir, "pm.db"));
    db.createRequirement({ id: "req-2", description: "Test req" });

    const coderState = {
      success: false,
      qualityScore: 0.3,
      iterationCount: 10,
      modifiedFiles: [],
    } as unknown as CoderGraphState;

    const result = updateRequirementFromCoder(db, "req-2", coderState);
    expect(result!.status).toBe("failed");

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ============================================================================
// exploration-to-knowledge
// ============================================================================

describe("exploration-to-knowledge", () => {
  const findings: ExplorationFinding[] = [
    { type: "tool_result", content: "Found module", source: "src/index.ts", iteration: 1 },
    { type: "tool_result", content: "Found config", source: "src/config.ts", iteration: 1 },
    { type: "tool_result", content: "More info", source: "src/index.ts", iteration: 2 },
  ];

  it("extracts unique file paths", () => {
    const paths = extractFilePaths(findings);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/config.ts");
  });

  it("annotates discovered files with symid and header", () => {
    const symidGen = new SymidGenerator("/tmp/project");
    const headerInjector = new SemanticHeaderInjector();

    const annotations = annotateDiscoveredFiles(symidGen, headerInjector, findings);
    expect(annotations).toHaveLength(2);
    expect(annotations[0].symid).toContain("FILE-");
    expect(annotations[0].header).toContain("[SEMANTIC_HEADER]");
    expect(annotations[0].findings).toHaveLength(2); // src/index.ts has 2 findings
  });
});

// ============================================================================
// knowledge-to-wiki
// ============================================================================

describe("knowledge-to-wiki", () => {
  it("converts annotations to DiscoveredFile[]", () => {
    const annotations = [
      { filePath: "src/index.ts", symid: "FILE-src-index", header: "", findings: [] },
      { filePath: "README.md", symid: "FILE-README", header: "", findings: [] },
    ];
    const files = annotationsToDiscoveredFiles(annotations);
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe("index.ts");
    expect(files[1].documentType).toBe("report"); // .md → report
  });

  it("synthesizes wiki pages", () => {
    const dir = tmpDir();
    const docManager = new ProjectDocManager({ projectName: "test", projectRoot: dir });
    const annotations = [
      {
        filePath: "src/app.ts",
        symid: "FILE-src-app",
        header: "",
        findings: [
          { type: "tool_result", content: "Main app", source: "src/app.ts", iteration: 1 },
        ],
      },
    ];

    const pages = synthesizeWikiPages(docManager, annotations, "TestProject");
    expect(pages.length).toBeGreaterThanOrEqual(2); // index + files-ts
    expect(pages[0].pageName).toBe("index");
    expect(pages[0].content).toContain("TestProject");

    // Verify saved to docManager
    const indexPage = docManager.getWikiPage("index");
    expect(indexPage).toBeDefined();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
