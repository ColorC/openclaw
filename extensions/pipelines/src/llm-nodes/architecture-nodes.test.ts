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
  createRefineDesignNode,
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
    entities: [],
    apiEndpoints: [],
    domains: [],
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

  it("should design custom architecture via tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("custom_architecture_design", {
        architecture_name: "Modular Monolith",
        reference_patterns: ["modular_monolith", "layered"],
        description: "Clear module boundaries",
        module_organization: "By domain",
        communication_pattern: "Direct method calls",
        deployment_architecture: "Single deployable",
        justification: "Best fit for medium scale",
      }),
    ]);
    const node = createSelectPatternNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.selectedPattern).toBe("Modular Monolith");
    expect(result.customArchitecture!.name).toBe("Modular Monolith");
    expect(result.customArchitecture!.referencePatterns).toEqual(["modular_monolith", "layered"]);
    expect(result.customArchitecture!.moduleOrganization).toBe("By domain");
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

  it("should return modules and responsibility matrix from two-step tool calls", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("design_modules", {
        modules: [
          {
            id: "mod-auth",
            name: "AuthModule",
            description: "Authentication",
            responsibilities: ["login", "register"],
            dependencies: [],
            layer: "business",
            estimatedSize: { lines: 500, files: 3, classes: 4 },
          },
          {
            id: "mod-api",
            name: "ApiGateway",
            description: "API routing",
            responsibilities: ["routing"],
            dependencies: ["mod-auth"],
            layer: "presentation",
          },
        ],
      }),
      mockToolCallResponse("assign_responsibilities", {
        matrix: [
          { moduleId: "mod-auth", featureId: "f-login", responsibility: "Handle user auth" },
        ],
      }),
    ]);
    const node = createDesignModulesNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState({ selectedPattern: "layered" }));

    expect(result.modules).toHaveLength(2);
    expect(result.modules![0].id).toBe("mod-auth");
    expect(result.modules![0].layer).toBe("business");
    expect(result.modules![1].dependencies).toEqual(["mod-auth"]);
    expect(result.responsibilityMatrix).toHaveLength(1);
    expect(result.responsibilityMatrix![0].featureId).toBe("f-login");
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

  it("should return structured review findings", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("design_review", {
        critical_issues: [
          {
            type: "omission",
            description: "Missing error handling module",
            severity: "high",
            affected_components: ["mod-api"],
          },
        ],
        review_passed: false,
        overall_assessment: "Design needs error handling improvements",
        priority_recommendations: ["Add a logging module", "Add error handling"],
      }),
    ]);
    const node = createDesignReviewNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.designReview!.criticalIssues).toHaveLength(1);
    expect(result.designReview!.criticalIssues![0].type).toBe("omission");
    expect(result.designReview!.reviewPassed).toBe(false);
    expect(result.designReview!.overallAssessment).toBe("Design needs error handling improvements");
    // Backward-compatible flat arrays
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

  it("should return needsRefinement=true when score is low", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("validate_architecture", {
        overall_score: 65,
        requirement_coverage: 70,
        architecture_issues: [
          {
            type: "circular_dependency",
            description: "Circular dependency detected",
            severity: "high",
            affected_components: ["mod-auth", "mod-api"],
          },
        ],
        missing_interfaces: [],
        responsibility_conflicts: [],
        needs_refinement: true,
        refinement_instructions: ["Break circular dependency between auth and api"],
        validation_summary: "Design has critical issues",
      }),
    ]);
    const node = createValidateArchitectureNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.needsRefinement).toBe(true);
    expect(result.validationResult).toBeDefined();
    expect(result.validationResult!.overallScore).toBe(65);
    expect(result.validationResult!.issues).toHaveLength(1);
    expect(result.validationResult!.refinementInstructions).toHaveLength(1);
  });

  it("should return needsRefinement=false when design is valid", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("validate_architecture", {
        overall_score: 92,
        requirement_coverage: 95,
        architecture_issues: [],
        missing_interfaces: [],
        responsibility_conflicts: [],
        needs_refinement: false,
        refinement_instructions: [],
        validation_summary: "Design is solid",
      }),
    ]);
    const node = createValidateArchitectureNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.needsRefinement).toBe(false);
    expect(result.validationResult!.overallScore).toBe(92);
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

    expect(result.openspecFiles).toEqual(["design.md", "tasks.md", "spec.md"]);
    expect(result.openspecDocuments).toBeDefined();
    expect(result.openspecDocuments!["design.md"]).toContain("## Context");
    expect(result.openspecDocuments!["tasks.md"]).toContain("## 1. Module Implementation");
  });

  it("should return documents even with empty state", async () => {
    const mp = new MockModelProvider([]);
    const node = createGenerateOpenspecNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.openspecFiles).toEqual(["design.md", "tasks.md", "spec.md"]);
    expect(result.openspecDocuments!["design.md"]).toContain("## Context");
  });
});

// ============================================================================
// refineDesign
// ============================================================================

describe("createRefineDesignNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should refine design based on validation issues", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("refine_design", {
        refined_modules: [
          {
            id: "mod-auth",
            name: "AuthModule",
            description: "Auth only",
            responsibilities: ["login"],
            dependencies: [],
            layer: "business",
          },
        ],
        refined_interfaces: [
          {
            id: "if-auth",
            name: "IAuthService",
            type: "service",
            methods: [
              { name: "login", input: "Credentials", output: "Token", description: "Login" },
            ],
          },
        ],
        changes_made: ["Separated auth from user module"],
        refinement_summary: "Resolved responsibility conflict",
      }),
    ]);
    const node = createRefineDesignNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        modules: [
          {
            id: "mod-auth",
            name: "Auth",
            description: "Auth+User",
            responsibilities: ["login", "profile"],
            dependencies: [],
          },
        ],
        interfaces: [],
        validationResult: {
          overallScore: 60,
          requirementCoverage: 70,
          issues: [
            {
              type: "overlap",
              description: "Auth and User mixed",
              severity: "high",
              affectedComponents: ["mod-auth"],
            },
          ],
          missingInterfaces: [],
          responsibilityConflicts: [],
          refinementInstructions: ["Separate auth from user management"],
        },
      }),
    );

    expect(result.modules).toHaveLength(1);
    expect(result.modules![0].name).toBe("AuthModule");
    expect(result.needsRefinement).toBe(false);
    expect(result.refinementIteration).toBe(1);
    expect(result.refinementHistory).toHaveLength(1);
  });

  it("should skip refinement gracefully when no validation result", async () => {
    const mp = new MockModelProvider([]);
    const node = createRefineDesignNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.needsRefinement).toBe(false);
    expect(result.refinementIteration).toBe(1);
  });
});
