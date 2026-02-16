/**
 * Architecture Design LLM Nodes
 *
 * 用真实 LLM 调用替换 architecture-design 工作流中的 stub 节点。
 * 9 个节点，每个通过 chatWithTools() 获取结构化输出。
 */

import type { ModelProvider, ToolDefinition } from "../llm/types.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import {
  generateDesignMarkdown,
  generateArchitectureTasksMarkdown,
} from "./openspec-generators.js";

// ============================================================================
// Shared deps
// ============================================================================

export interface ArchitectureNodeDeps {
  modelProvider: ModelProvider;
  promptRegistry: PromptRegistry;
}

// ============================================================================
// Tool Schemas
// ============================================================================

const analyzeRequirementTool: ToolDefinition = {
  name: "analyze_requirement",
  description: "Return the requirement analysis",
  parameters: {
    type: "object",
    properties: {
      scale: { type: "string", enum: ["small", "medium", "large"] },
      complexity: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
      domain: { type: "string" },
      keyEntities: { type: "array", items: { type: "string" } },
    },
    required: ["scale", "complexity", "domain", "keyEntities"],
  },
};

const listFeaturesTool: ToolDefinition = {
  name: "list_features",
  description: "Return the identified features",
  parameters: {
    type: "object",
    properties: {
      features: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            type: { type: "string", enum: ["user_facing", "internal", "infrastructure"] },
          },
          required: ["id", "name", "description", "type"],
        },
      },
    },
    required: ["features"],
  },
};

const selectPatternTool: ToolDefinition = {
  name: "select_pattern",
  description: "Return the selected architecture pattern",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        enum: [
          "layered",
          "microservices",
          "event_driven",
          "modular_monolith",
          "hexagonal",
          "simple",
        ],
      },
      name: { type: "string" },
      description: { type: "string" },
    },
    required: ["pattern", "name", "description"],
  },
};

const designModulesTool: ToolDefinition = {
  name: "design_modules",
  description: "Return the module design",
  parameters: {
    type: "object",
    properties: {
      modules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            responsibilities: { type: "array", items: { type: "string" } },
            dependencies: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "description", "responsibilities", "dependencies"],
        },
      },
    },
    required: ["modules"],
  },
};

const defineInterfacesTool: ToolDefinition = {
  name: "define_interfaces",
  description: "Return the interface definitions",
  parameters: {
    type: "object",
    properties: {
      interfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["repository", "service", "external", "api"] },
            methods: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  input: { type: "string" },
                  output: { type: "string" },
                  description: { type: "string" },
                },
                required: ["name", "input", "output", "description"],
              },
            },
          },
          required: ["id", "name", "type", "methods"],
        },
      },
    },
    required: ["interfaces"],
  },
};

const designReviewTool: ToolDefinition = {
  name: "design_review",
  description: "Return the design review findings",
  parameters: {
    type: "object",
    properties: {
      omissions: { type: "array", items: { type: "string" } },
      couplingIssues: { type: "array", items: { type: "string" } },
      suggestions: { type: "array", items: { type: "string" } },
    },
    required: ["omissions", "couplingIssues", "suggestions"],
  },
};

const validateArchitectureTool: ToolDefinition = {
  name: "validate_architecture",
  description: "Return the validation result",
  parameters: {
    type: "object",
    properties: {
      needsRefinement: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["needsRefinement"],
  },
};

const designFileStructureTool: ToolDefinition = {
  name: "design_file_structure",
  description: "Return the file structure",
  parameters: {
    type: "object",
    properties: {
      structure: { type: "object" },
    },
    required: ["structure"],
  },
};

const generateOpenspecTool: ToolDefinition = {
  name: "generate_openspec",
  description: "Return the OpenSpec file names",
  parameters: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" } },
    },
    required: ["files"],
  },
};

// ============================================================================
// Helper
// ============================================================================

function extractToolArgs(
  response: { toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> },
  toolName: string,
) {
  const tc = response.toolCalls?.find((t) => t.name === toolName);
  return tc?.arguments;
}

// ============================================================================
// Node Factories
// ============================================================================

export function createAnalyzeRequirementNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/analyze-requirement",
      { requirement: state.requirement, project_context: JSON.stringify(state.projectContext) },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [analyzeRequirementTool], {
      modelRole: "architect",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "analyze_requirement");
    if (!args)
      return {
        requirementAnalysis: {
          scale: "medium",
          complexity: "medium",
          domain: "general",
          keyEntities: [],
        },
      };

    return {
      requirementAnalysis: {
        scale: (args.scale as "small" | "medium" | "large") ?? "medium",
        complexity: mapComplexity(args.complexity as string),
        domain: (args.domain as string) ?? "general",
        keyEntities: (args.keyEntities as string[]) ?? [],
      },
    };
  };
}

function mapComplexity(c: string): "low" | "medium" | "high" {
  if (c === "low") return "low";
  if (c === "high" || c === "very_high") return "high";
  return "medium";
}

export function createListFeaturesNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/list-features",
      {
        requirement: state.requirement,
        analysis_json: JSON.stringify(state.requirementAnalysis ?? {}),
      },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [listFeaturesTool], {
      modelRole: "architect",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "list_features");
    if (!args) return {};

    const features =
      (args.features as Array<{ id: string; name: string; description: string; type: string }>) ??
      [];
    return {
      userFacingFeatures: features
        .filter((f) => f.type === "user_facing")
        .map((f) => ({ ...f, type: "user_facing" as const, priority: "medium" as const })),
      internalFeatures: features
        .filter((f) => f.type === "internal")
        .map((f) => ({ ...f, type: "internal" as const, priority: "medium" as const })),
      infrastructureDependencies: features
        .filter((f) => f.type === "infrastructure")
        .map((f) => ({ ...f, type: "infrastructure" as const, priority: "medium" as const })),
    };
  };
}

export function createSelectPatternNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const allFeatures = [
      ...state.userFacingFeatures,
      ...state.internalFeatures,
      ...state.infrastructureDependencies,
    ];
    const messages = deps.promptRegistry.buildMessages(
      "architecture/select-pattern",
      { requirement: state.requirement, features_json: JSON.stringify(allFeatures) },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [selectPatternTool], {
      modelRole: "architect",
      temperature: 0.2,
    });
    const args = extractToolArgs(response, "select_pattern");
    if (!args)
      return {
        selectedPattern: "layered",
        customArchitecture: {
          name: "Layered Architecture",
          pattern: "layered",
          description: "Default",
        },
      };

    return {
      selectedPattern: args.pattern as string,
      customArchitecture: {
        name: (args.name as string) ?? (args.pattern as string),
        pattern: args.pattern as string,
        description: (args.description as string) ?? "",
      },
    };
  };
}

export function createDesignModulesNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const allFeatures = [
      ...state.userFacingFeatures,
      ...state.internalFeatures,
      ...state.infrastructureDependencies,
    ];
    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-modules",
      {
        requirement: state.requirement,
        pattern: state.selectedPattern ?? "layered",
        features_json: JSON.stringify(allFeatures),
      },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [designModulesTool], {
      modelRole: "architect",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "design_modules");
    if (!args) return { modules: [] };

    return { modules: (args.modules as any[]) ?? [] };
  };
}

export function createDefineInterfacesNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/define-interfaces",
      { modules_json: JSON.stringify(state.modules) },
      `Define interfaces for ${state.modules.length} modules.`,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [defineInterfacesTool], {
      modelRole: "architect",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "define_interfaces");
    if (!args) return { interfaces: [] };

    return { interfaces: (args.interfaces as any[]) ?? [] };
  };
}

export function createDesignReviewNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-review",
      {
        modules_json: JSON.stringify(state.modules),
        interfaces_json: JSON.stringify(state.interfaces),
      },
      "Review this architecture design.",
    );
    const response = await deps.modelProvider.chatWithTools(messages, [designReviewTool], {
      modelRole: "reviewer",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "design_review");
    if (!args) return { designReview: { omissions: [], couplingIssues: [], suggestions: [] } };

    return {
      designReview: {
        omissions: (args.omissions as string[]) ?? [],
        couplingIssues: (args.couplingIssues as string[]) ?? [],
        suggestions: (args.suggestions as string[]) ?? [],
      },
    };
  };
}

export function createValidateArchitectureNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const designJson = JSON.stringify({
      modules: state.modules,
      interfaces: state.interfaces,
      pattern: state.selectedPattern,
    });
    const reviewJson = JSON.stringify(state.designReview ?? {});
    const messages = deps.promptRegistry.buildMessages(
      "architecture/validate-architecture",
      { design_json: designJson, review_json: reviewJson },
      "Validate this architecture.",
    );
    const response = await deps.modelProvider.chatWithTools(messages, [validateArchitectureTool], {
      modelRole: "reviewer",
      temperature: 0.2,
    });
    const args = extractToolArgs(response, "validate_architecture");
    if (!args) return { needsRefinement: false };

    return { needsRefinement: (args.needsRefinement as boolean) ?? false };
  };
}

export function createDesignFileStructureNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-file-structure",
      {
        modules_json: JSON.stringify(state.modules),
        interfaces_json: JSON.stringify(state.interfaces),
      },
      "Design the file structure.",
    );
    const response = await deps.modelProvider.chatWithTools(messages, [designFileStructureTool], {
      modelRole: "architect",
      temperature: 0.2,
    });
    const args = extractToolArgs(response, "design_file_structure");
    if (!args) return { fileStructure: {} };

    return { fileStructure: (args.structure as Record<string, unknown>) ?? {} };
  };
}

export function createGenerateOpenspecNode(_deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    // 不需要额外 LLM 调用 — 直接从 state 数据生成 OpenSpec 文档
    const designContent = generateDesignMarkdown(state);
    const tasksContent = generateArchitectureTasksMarkdown(state);

    return {
      openspecFiles: ["design.md", "tasks.md"],
      openspecDocuments: {
        "design.md": designContent,
        "tasks.md": tasksContent,
      },
    };
  };
}
