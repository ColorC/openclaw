/**
 * Architecture LLM Nodes — 测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import { MockModelProvider, mockToolCallResponse } from "../llm/mock-model-provider.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import {
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
} from "./architecture-nodes.js";

// ============================================================================
// Helpers
// ============================================================================

function makeState(
  overrides: Partial<ArchitectureDesignGraphState> = {},
): ArchitectureDesignGraphState {
  return {
    requirement: "构建一个在线商城系统",
    projectContext: {},
    scenario: "new_project",
    projectPath: undefined,
    requirementAnalysis: undefined,
    userFacingFeatures: [],
    internalFeatures: [],
    infrastructureDependencies: [],
    customArchitecture: undefined,
    selectedPattern: undefined,
    modules: [],
    interfaces: [],
    responsibilityMatrix: [],
    needsRefinement: false,
    refinementIteration: 0,
    refinementHistory: [],
    designReview: undefined,
    fileStructure: undefined,
    openspecFiles: [],
    openspecDocuments: {},
    success: false,
    error: undefined,
    ...overrides,
  };
}

// ============================================================================
// analyzeRequirement
// ============================================================================

describe("createAnalyzeRequirementNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should analyze requirement via tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("analyze_requirement", {
        scale: "large",
        complexity: "high",
        domain: "e-commerce",
        keyEntities: ["User", "Product", "Order"],
      }),
    ]);
    const node = createAnalyzeRequirementNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.requirementAnalysis).toBeDefined();
    expect(result.requirementAnalysis!.scale).toBe("large");
    expect(result.requirementAnalysis!.complexity).toBe("high");
    expect(result.requirementAnalysis!.domain).toBe("e-commerce");
    expect(result.requirementAnalysis!.keyEntities).toEqual(["User", "Product", "Order"]);
  });

  it("should fallback to defaults when LLM does not call tool", async () => {
    const mp = new MockModelProvider([{ content: "no tool call" }]);
    const node = createAnalyzeRequirementNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.requirementAnalysis!.scale).toBe("medium");
    expect(result.requirementAnalysis!.complexity).toBe("medium");
  });
});

// ============================================================================
// listFeatures
// ============================================================================

describe("createListFeaturesNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should categorize features by type", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("list_features", {
        features: [
          {
            id: "f-cart",
            name: "Shopping Cart",
            description: "Add/remove items",
            type: "user_facing",
          },
          { id: "f-cache", name: "Cache Layer", description: "Redis caching", type: "internal" },
          { id: "f-db", name: "Database", description: "PostgreSQL", type: "infrastructure" },
        ],
      }),
    ]);
    const node = createListFeaturesNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        requirementAnalysis: {
          scale: "medium",
          complexity: "medium",
          domain: "web",
          keyEntities: [],
        },
      }),
    );

    expect(result.userFacingFeatures).toHaveLength(1);
    expect(result.userFacingFeatures![0].id).toBe("f-cart");
    expect(result.internalFeatures).toHaveLength(1);
    expect(result.infrastructureDependencies).toHaveLength(1);
  });
});

// ============================================================================
// selectPattern
// ============================================================================

describe("createSelectPatternNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should select pattern via tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("select_pattern", {
        pattern: "modular_monolith",
        name: "Modular Monolith",
        description: "Clear module boundaries",
      }),
    ]);
    const node = createSelectPatternNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.selectedPattern).toBe("modular_monolith");
    expect(result.customArchitecture!.name).toBe("Modular Monolith");
  });

  it("should fallback to layered when no tool call", async () => {
    const mp = new MockModelProvider([{ content: "text only" }]);
    const node = createSelectPatternNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.selectedPattern).toBe("layered");
  });
});

// ============================================================================
// designModules
// ============================================================================

describe("createDesignModulesNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return modules from tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("design_modules", {
        modules: [
          {
            id: "mod-auth",
            name: "AuthModule",
            description: "Authentication",
            responsibilities: ["login", "register"],
            dependencies: [],
          },
          {
            id: "mod-api",
            name: "ApiGateway",
            description: "API routing",
            responsibilities: ["routing"],
            dependencies: ["mod-auth"],
          },
        ],
      }),
    ]);
    const node = createDesignModulesNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState({ selectedPattern: "layered" }));

    expect(result.modules).toHaveLength(2);
    expect(result.modules![0].id).toBe("mod-auth");
    expect(result.modules![1].dependencies).toEqual(["mod-auth"]);
  });
});

// ============================================================================
// defineInterfaces
// ============================================================================

describe("createDefineInterfacesNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return interfaces from tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("define_interfaces", {
        interfaces: [
          {
            id: "if-auth",
            name: "IAuthService",
            type: "service",
            methods: [
              {
                name: "login",
                input: "Credentials",
                output: "AuthToken",
                description: "Authenticate user",
              },
            ],
          },
        ],
      }),
    ]);
    const modules = [
      { id: "mod-auth", name: "Auth", description: "", responsibilities: [], dependencies: [] },
    ];
    const node = createDefineInterfacesNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState({ modules }));

    expect(result.interfaces).toHaveLength(1);
    expect(result.interfaces![0].methods).toHaveLength(1);
    expect(result.interfaces![0].methods[0].name).toBe("login");
  });
});

// ============================================================================
// designReview
// ============================================================================

describe("createDesignReviewNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return review findings", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("design_review", {
        omissions: ["Missing error handling module"],
        couplingIssues: [],
        suggestions: ["Add a logging module"],
      }),
    ]);
    const node = createDesignReviewNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.designReview!.omissions).toHaveLength(1);
    expect(result.designReview!.suggestions).toContain("Add a logging module");
    expect(mp.calls[0].options?.modelRole).toBe("reviewer");
  });
});

// ============================================================================
// validateArchitecture
// ============================================================================

describe("createValidateArchitectureNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return needsRefinement=true when issues found", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("validate_architecture", {
        needsRefinement: true,
        reason: "Circular dependency detected",
      }),
    ]);
    const node = createValidateArchitectureNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.needsRefinement).toBe(true);
  });

  it("should return needsRefinement=false when design is valid", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("validate_architecture", { needsRefinement: false }),
    ]);
    const node = createValidateArchitectureNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.needsRefinement).toBe(false);
  });
});

// ============================================================================
// designFileStructure
// ============================================================================

describe("createDesignFileStructureNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return file structure from tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("design_file_structure", {
        structure: { src: { auth: {}, api: {}, "index.ts": "entry point" } },
      }),
    ]);
    const node = createDesignFileStructureNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.fileStructure).toBeDefined();
    expect((result.fileStructure as any).src.auth).toBeDefined();
  });
});

// ============================================================================
// generateOpenspec
// ============================================================================

describe("createGenerateOpenspecNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should return design.md and tasks.md with content", async () => {
    const mp = new MockModelProvider([]);
    const node = createGenerateOpenspecNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        fileStructure: { src: {} },
        modules: [
          {
            id: "m1",
            name: "Core",
            description: "Core module",
            responsibilities: ["Logic"],
            dependencies: [],
          },
        ],
        interfaces: [
          {
            id: "i1",
            name: "CoreService",
            type: "service" as const,
            methods: [{ name: "run", input: "void", output: "void", description: "Run" }],
          },
        ],
      }),
    );

    expect(result.openspecFiles).toEqual(["design.md", "tasks.md"]);
    expect(result.openspecDocuments).toBeDefined();
    expect(result.openspecDocuments!["design.md"]).toContain("# Technical Design Document");
    expect(result.openspecDocuments!["tasks.md"]).toContain("# Implementation Tasks");
  });

  it("should return documents even with empty state", async () => {
    const mp = new MockModelProvider([]);
    const node = createGenerateOpenspecNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.openspecFiles).toEqual(["design.md", "tasks.md"]);
    expect(result.openspecDocuments!["design.md"]).toContain("# Technical Design Document");
  });
});
