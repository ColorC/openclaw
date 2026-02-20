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
  generateSpecMarkdown,
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
      techFeatures: { type: "array", items: { type: "string" } },
      reasoning: { type: "string" },
      recommendedArchitecture: { type: "string" },
      integrationType: { type: "string", enum: ["pure_extension", "core_modification", "hybrid"] },
      entryPoint: { type: "string", enum: ["independent", "sub_feature", "hook"] },
    },
    required: ["scale", "complexity", "domain", "keyEntities", "techFeatures", "reasoning"],
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
            priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
            sourceRequirement: { type: "string" },
            triggeredBy: { type: "string" },
            requiredBy: { type: "string" },
            isImplicit: { type: "boolean" },
          },
          required: ["id", "name", "description", "type"],
        },
      },
    },
    required: ["features"],
  },
};

const customArchitectureDesignTool: ToolDefinition = {
  name: "custom_architecture_design",
  description: "Design a custom architecture",
  parameters: {
    type: "object",
    properties: {
      architecture_name: { type: "string" },
      reference_patterns: { type: "array", items: { type: "string" } },
      description: { type: "string" },
      module_organization: { type: "string" },
      communication_pattern: { type: "string" },
      deployment_architecture: { type: "string" },
      justification: { type: "string" },
    },
    required: [
      "architecture_name",
      "reference_patterns",
      "description",
      "module_organization",
      "communication_pattern",
      "deployment_architecture",
      "justification",
    ],
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
            layer: { type: "string" },
            estimatedSize: {
              type: "object",
              properties: {
                lines: { type: "number" },
                files: { type: "number" },
                classes: { type: "number" },
              },
            },
          },
          required: ["id", "name", "description", "responsibilities", "dependencies"],
        },
      },
    },
    required: ["modules"],
  },
};

const assignResponsibilitiesTool: ToolDefinition = {
  name: "assign_responsibilities",
  description: "Return the responsibility matrix mapping features to modules",
  parameters: {
    type: "object",
    properties: {
      matrix: {
        type: "array",
        items: {
          type: "object",
          properties: {
            moduleId: { type: "string" },
            featureId: { type: "string" },
            responsibility: { type: "string" },
          },
          required: ["moduleId", "featureId", "responsibility"],
        },
      },
    },
    required: ["matrix"],
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
            type: {
              type: "string",
              enum: ["repository", "service", "external", "api", "controller", "adapter"],
            },
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
            exposedBy: { type: "string" },
            consumedBy: { type: "array", items: { type: "string" } },
            layer: { type: "string" },
            direction: { type: "string", enum: ["inbound", "outbound", "bidirectional"] },
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
      critical_issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["omission", "coupling", "inconsistency"] },
            description: { type: "string" },
            severity: { type: "string", enum: ["high", "medium"] },
            affected_components: { type: "array", items: { type: "string" } },
          },
          required: ["type", "description", "severity", "affected_components"],
        },
      },
      review_passed: { type: "boolean" },
      overall_assessment: { type: "string" },
      priority_recommendations: { type: "array", items: { type: "string" } },
    },
    required: [
      "critical_issues",
      "review_passed",
      "overall_assessment",
      "priority_recommendations",
    ],
  },
};

const validateArchitectureTool: ToolDefinition = {
  name: "validate_architecture",
  description: "Validate architecture completeness and consistency",
  parameters: {
    type: "object",
    properties: {
      overall_score: { type: "number" },
      requirement_coverage: { type: "number" },
      architecture_issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            affected_components: { type: "array", items: { type: "string" } },
          },
          required: ["type", "description", "severity"],
        },
      },
      missing_interfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            priority: { type: "string", enum: ["P0", "P1", "P2"] },
            name: { type: "string" },
            module: { type: "string" },
            reason: { type: "string" },
          },
          required: ["priority", "name", "module", "reason"],
        },
      },
      responsibility_conflicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            feature_ids: { type: "array", items: { type: "string" } },
            shared_module: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["feature_ids", "shared_module", "suggestion"],
        },
      },
      needs_refinement: { type: "boolean" },
      refinement_instructions: { type: "array", items: { type: "string" } },
      validation_summary: { type: "string" },
    },
    required: [
      "overall_score",
      "requirement_coverage",
      "architecture_issues",
      "missing_interfaces",
      "responsibility_conflicts",
      "needs_refinement",
      "refinement_instructions",
      "validation_summary",
    ],
  },
};

const refineDesignTool: ToolDefinition = {
  name: "refine_design",
  description: "Return the refined architecture design",
  parameters: {
    type: "object",
    properties: {
      refined_modules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            responsibilities: { type: "array", items: { type: "string" } },
            dependencies: { type: "array", items: { type: "string" } },
            layer: { type: "string" },
          },
          required: ["id", "name", "description", "responsibilities", "dependencies"],
        },
      },
      refined_interfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string" },
            methods: { type: "array", items: { type: "object" } },
            exposedBy: { type: "string" },
            consumedBy: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "type", "methods"],
        },
      },
      refined_responsibility_matrix: {
        type: "array",
        items: {
          type: "object",
          properties: {
            moduleId: { type: "string" },
            featureId: { type: "string" },
            responsibility: { type: "string" },
          },
          required: ["moduleId", "featureId", "responsibility"],
        },
      },
      changes_made: { type: "array", items: { type: "string" } },
      refinement_summary: { type: "string" },
    },
    required: ["refined_modules", "refined_interfaces", "changes_made", "refinement_summary"],
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

const designDataModelTool: ToolDefinition = {
  name: "design_data_model",
  description: "Return the data model entities",
  parameters: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            attributes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  required: { type: "boolean" },
                  description: { type: "string" },
                },
                required: ["name", "type", "required"],
              },
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target: { type: "string" },
                  type: { type: "string", enum: ["one-to-one", "one-to-many", "many-to-many"] },
                  description: { type: "string" },
                },
                required: ["target", "type"],
              },
            },
            ownerModule: { type: "string" },
          },
          required: ["id", "name", "description", "attributes", "relationships"],
        },
      },
    },
    required: ["entities"],
  },
};

const designApiEndpointsTool: ToolDefinition = {
  name: "design_api_endpoints",
  description: "Return the API endpoint definitions",
  parameters: {
    type: "object",
    properties: {
      endpoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
            description: { type: "string" },
            requestBody: { type: "string" },
            responseBody: { type: "string" },
            relatedEntities: { type: "array", items: { type: "string" } },
            ownerModule: { type: "string" },
            auth: { type: "boolean" },
          },
          required: ["id", "method", "path", "description"],
        },
      },
    },
    required: ["endpoints"],
  },
};

const designDomainsTool: ToolDefinition = {
  name: "design_domains",
  description: "Return the domain decomposition",
  parameters: {
    type: "object",
    properties: {
      domains: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            featureIds: { type: "array", items: { type: "string" } },
            boundaryInteractions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  targetDomain: { type: "string" },
                  description: { type: "string" },
                },
                required: ["targetDomain", "description"],
              },
            },
          },
          required: ["id", "name", "description", "featureIds"],
        },
      },
    },
    required: ["domains"],
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
  response: {
    content?: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  },
  toolName: string,
) {
  const tc = response.toolCalls?.find((t) => t.name === toolName);
  if (!tc) {
    const availableTools = response.toolCalls?.map((t) => t.name).join(", ") || "(none)";
    const textPreview = (response.content ?? "").slice(0, 200);
    console.warn(
      `[arch] ⚠ extractToolArgs: expected tool "${toolName}" not found. Available: [${availableTools}]. LLM text: "${textPreview}"`,
    );
    return undefined;
  }
  const args = tc.arguments;
  if (args && (args as any)._parseError) {
    console.warn(
      `[arch] ⚠ extractToolArgs: tool "${toolName}" returned malformed JSON: ${(args as any)._raw?.slice(0, 300)}`,
    );
    return undefined;
  }
  return args;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, delayMs = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ============================================================================
// Cross-Domain Context Summarizers
// ============================================================================

const SUMMARY_MAX_CHARS = 2000;

/** Compact summary of modules for cross-domain context injection */
function summarizeModules(modules: any[]): string {
  const lines = modules.map(
    (m: any) =>
      `- ${m.id}: ${m.name} [${m.layer ?? "?"}] — ${(m.responsibilities ?? []).slice(0, 2).join("; ")}`,
  );
  return truncateSummary(lines.join("\n"));
}

/** Compact summary of interfaces for cross-domain context injection */
function summarizeInterfaces(interfaces: any[]): string {
  const lines = interfaces.map(
    (i: any) =>
      `- ${i.id}: ${i.name} (${i.type}, ${i.direction ?? "?"}) exposedBy=${i.exposedBy ?? "?"} methods=${(i.methods ?? []).length}`,
  );
  return truncateSummary(lines.join("\n"));
}

/** Compact summary of entities for cross-domain context injection */
function summarizeEntities(entities: any[]): string {
  const lines = entities.map(
    (e: any) =>
      `- ${e.id}: ${e.name} [owner=${e.ownerModule ?? "?"}] attrs=${(e.attributes ?? []).length} rels=${(e.relationships ?? []).length}`,
  );
  return truncateSummary(lines.join("\n"));
}

/** Compact summary of API endpoints for cross-domain context injection */
function summarizeEndpoints(endpoints: any[]): string {
  const lines = endpoints.map(
    (e: any) => `- ${e.id}: ${e.method} ${e.path} [owner=${e.ownerModule ?? "?"}]`,
  );
  return truncateSummary(lines.join("\n"));
}

function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  // Keep as many complete lines as possible within limit
  const lines = text.split("\n");
  let result = "";
  for (const line of lines) {
    if (result.length + line.length + 1 > SUMMARY_MAX_CHARS - 30) {
      result += "\n... (truncated)";
      break;
    }
    result += (result ? "\n" : "") + line;
  }
  return result;
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
        techFeatures: (args.techFeatures as string[]) ?? [],
        reasoning: (args.reasoning as string) ?? "",
        recommendedArchitecture: args.recommendedArchitecture as string | undefined,
        integrationType:
          (args.integrationType as "pure_extension" | "core_modification" | "hybrid") ??
          "pure_extension",
        entryPoint: (args.entryPoint as "independent" | "sub_feature" | "hook") ?? "independent",
      },
    };
  };
}

function mapComplexity(c: string): "low" | "medium" | "high" {
  if (c === "low") return "low";
  if (c === "high" || c === "very_high") return "high";
  return "medium";
}

/** Extract integration_type from state for prompt template injection */
function getIntegrationType(state: ArchitectureDesignGraphState): string {
  return state.requirementAnalysis?.integrationType ?? "pure_extension";
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
        integration_type: getIntegrationType(state),
      },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(messages, [listFeaturesTool], {
      modelRole: "architect",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "list_features");
    if (!args) return {};

    const features = (args.features as Array<Record<string, unknown>>) ?? [];
    const mapFeature = (
      f: Record<string, unknown>,
      type: "user_facing" | "internal" | "infrastructure",
    ) => ({
      id: f.id as string,
      name: f.name as string,
      description: f.description as string,
      type,
      priority: (f.priority as "critical" | "high" | "medium" | "low") ?? "medium",
      sourceRequirement: f.sourceRequirement as string | undefined,
      triggeredBy: f.triggeredBy as string | undefined,
      requiredBy: f.requiredBy as string | undefined,
      isImplicit: f.isImplicit as boolean | undefined,
    });
    return {
      userFacingFeatures: features
        .filter((f) => f.type === "user_facing")
        .map((f) => mapFeature(f, "user_facing")),
      internalFeatures: features
        .filter((f) => f.type === "internal")
        .map((f) => mapFeature(f, "internal")),
      infrastructureDependencies: features
        .filter((f) => f.type === "infrastructure")
        .map((f) => mapFeature(f, "infrastructure")),
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
      {
        requirement: state.requirement,
        features_json: JSON.stringify(allFeatures),
        integration_type: getIntegrationType(state),
      },
      state.requirement,
    );
    const response = await deps.modelProvider.chatWithTools(
      messages,
      [customArchitectureDesignTool],
      { modelRole: "architect", temperature: 0.2 },
    );
    const args = extractToolArgs(response, "custom_architecture_design");
    if (!args)
      return {
        selectedPattern: "layered",
        customArchitecture: {
          name: "Layered Architecture",
          pattern: "layered",
          description: "Default layered architecture",
        },
      };

    const name = (args.architecture_name as string) ?? "Custom Architecture";
    return {
      selectedPattern: name,
      customArchitecture: {
        name,
        pattern: name,
        description: (args.description as string) ?? "",
        referencePatterns: (args.reference_patterns as string[]) ?? [],
        moduleOrganization: (args.module_organization as string) ?? "",
        communicationPattern: (args.communication_pattern as string) ?? "",
        deploymentArchitecture: (args.deployment_architecture as string) ?? "",
        justification: (args.justification as string) ?? "",
      },
    };
  };
}

export function createDesignDomainsNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const allFeatures = [
      ...state.userFacingFeatures,
      ...state.internalFeatures,
      ...state.infrastructureDependencies,
    ];
    const arch = state.customArchitecture;
    const analysis = state.requirementAnalysis;

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-domains",
      {
        requirement: state.requirement,
        scale: analysis?.scale ?? "large",
        complexity: analysis?.complexity ?? "high",
        architecture_name: arch?.name ?? state.selectedPattern ?? "layered",
        architecture_description: arch?.description ?? "",
        features_json: JSON.stringify(allFeatures),
      },
      "Decompose the system into domains.",
    );
    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [designDomainsTool], {
        modelRole: "architect",
        temperature: 0.3,
      }),
    );
    const args = extractToolArgs(response, "design_domains");
    if (!args) return { domains: [] };

    return { domains: (args.domains as any[]) ?? [] };
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
    const arch = state.customArchitecture;
    const analysis = state.requirementAnalysis;
    const domains = state.domains ?? [];

    // ── Hierarchical mode: per-domain module design ──
    if (domains.length > 0) {
      return await designModulesPerDomain(deps, state, allFeatures, domains, arch, analysis);
    }

    // ── Standard mode: single-pass module design ──
    return await designModulesSinglePass(deps, state, allFeatures, arch, analysis);
  };
}

async function designModulesSinglePass(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  allFeatures: any[],
  arch: ArchitectureDesignGraphState["customArchitecture"],
  analysis: ArchitectureDesignGraphState["requirementAnalysis"],
): Promise<Partial<ArchitectureDesignGraphState>> {
  // Step 1: Define modules
  const step1Messages = deps.promptRegistry.buildMessages(
    "architecture/design-modules",
    {
      requirement: state.requirement,
      pattern: state.selectedPattern ?? "layered",
      features_json: JSON.stringify(allFeatures),
      architecture_name: arch?.name ?? state.selectedPattern ?? "layered",
      architecture_description: arch?.description ?? "",
      module_organization: arch?.moduleOrganization ?? "",
      communication_pattern: arch?.communicationPattern ?? "",
      scale: analysis?.scale ?? "medium",
      complexity: analysis?.complexity ?? "medium",
      integration_type: analysis?.integrationType ?? "pure_extension",
    },
    state.requirement,
  );
  const step1Response = await withRetry(() =>
    deps.modelProvider.chatWithTools(step1Messages, [designModulesTool], {
      modelRole: "architect",
      temperature: 0.3,
    }),
  );
  const step1Args = extractToolArgs(step1Response, "design_modules");
  if (!step1Args) {
    console.warn(
      "[arch] designModulesSinglePass: LLM did not produce design_modules tool call — returning empty modules",
    );
    return { modules: [], responsibilityMatrix: [] };
  }

  const modules = (step1Args.modules as any[]) ?? [];
  if (modules.length === 0) {
    console.warn("[arch] designModulesSinglePass: design_modules tool returned 0 modules");
  }

  // Step 2: Assign responsibility matrix
  const matrix = await assignResponsibilityMatrix(
    deps,
    state,
    allFeatures,
    modules,
    arch,
    analysis,
  );

  return { modules, responsibilityMatrix: matrix };
}

async function designModulesPerDomain(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  allFeatures: any[],
  domains: any[],
  arch: ArchitectureDesignGraphState["customArchitecture"],
  analysis: ArchitectureDesignGraphState["requirementAnalysis"],
): Promise<Partial<ArchitectureDesignGraphState>> {
  const allModules: any[] = [];
  const featureMap = new Map(allFeatures.map((f) => [f.id, f]));

  // Global context summary for each domain to inherit
  const globalContext = {
    requirement: state.requirement,
    pattern: state.selectedPattern ?? "layered",
    architecture_name: arch?.name ?? state.selectedPattern ?? "layered",
    architecture_description: arch?.description ?? "",
    module_organization: arch?.moduleOrganization ?? "",
    communication_pattern: arch?.communicationPattern ?? "",
    totalDomains: domains.length,
    domainOverview: domains.map((d: any) => `${d.name}: ${d.description}`).join("; "),
  };

  for (const domain of domains) {
    const domainFeatures = (domain.featureIds as string[])
      .map((fid: string) => featureMap.get(fid))
      .filter(Boolean);

    if (domainFeatures.length === 0) continue;

    const boundaryInfo = (domain.boundaryInteractions ?? [])
      .map((b: any) => `→ ${b.targetDomain}: ${b.description}`)
      .join("\n");

    // Accumulate completed domains context
    const completedContext =
      allModules.length > 0
        ? `\n\nAlready designed modules from other domains (reference for cross-domain dependencies, do NOT duplicate):\n${summarizeModules(allModules)}`
        : "";

    const domainPrompt = [
      `Design modules for domain "${domain.name}" (${domain.description}).`,
      `This is part of a larger system with ${globalContext.totalDomains} domains: ${globalContext.domainOverview}`,
      boundaryInfo ? `Cross-domain interactions:\n${boundaryInfo}` : "",
      `Prefix module IDs with "${domain.id}_" to avoid conflicts.`,
      completedContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-modules",
      {
        requirement: domainPrompt,
        pattern: globalContext.pattern,
        features_json: JSON.stringify(domainFeatures),
        architecture_name: globalContext.architecture_name,
        architecture_description: globalContext.architecture_description,
        module_organization: globalContext.module_organization,
        communication_pattern: globalContext.communication_pattern,
        scale: "medium",
        complexity: analysis?.complexity ?? "medium",
        integration_type: analysis?.integrationType ?? "pure_extension",
      },
      domainPrompt,
    );

    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [designModulesTool], {
        modelRole: "architect",
        temperature: 0.3,
      }),
    );
    const args = extractToolArgs(response, "design_modules");
    if (!args) {
      console.warn(
        `[arch] designModulesPerDomain: LLM did not produce design_modules for domain "${domain.name}"`,
      );
    }
    const domainModules = (args?.modules as any[]) ?? [];
    allModules.push(...domainModules);
  }

  if (allModules.length === 0) {
    console.warn("[arch] designModulesPerDomain: all domains returned 0 modules");
    return { modules: [], responsibilityMatrix: [] };
  }

  // Assign responsibility matrix for all modules across all features
  const matrix = await assignResponsibilityMatrix(
    deps,
    state,
    allFeatures,
    allModules,
    arch,
    analysis,
  );

  return { modules: allModules, responsibilityMatrix: matrix };
}

async function assignResponsibilityMatrix(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  allFeatures: any[],
  modules: any[],
  arch: ArchitectureDesignGraphState["customArchitecture"],
  analysis: ArchitectureDesignGraphState["requirementAnalysis"],
): Promise<any[]> {
  const step2Messages = deps.promptRegistry.buildMessages(
    "architecture/design-modules",
    {
      requirement: state.requirement,
      pattern: state.selectedPattern ?? "layered",
      features_json: JSON.stringify(allFeatures),
      architecture_name: arch?.name ?? "",
      architecture_description: arch?.description ?? "",
      module_organization: arch?.moduleOrganization ?? "",
      communication_pattern: arch?.communicationPattern ?? "",
      scale: analysis?.scale ?? "medium",
      complexity: analysis?.complexity ?? "medium",
      integration_type: analysis?.integrationType ?? "pure_extension",
    },
    `Assign responsibility matrix for these modules: ${JSON.stringify(modules.map((m: any) => ({ id: m.id, name: m.name })))} and features: ${JSON.stringify(allFeatures.map((f: any) => ({ id: f.id, name: f.name })))}`,
  );
  const step2Response = await deps.modelProvider.chatWithTools(
    step2Messages,
    [assignResponsibilitiesTool],
    { modelRole: "architect", temperature: 0.2 },
  );
  const step2Args = extractToolArgs(step2Response, "assign_responsibilities");
  return (step2Args?.matrix as any[]) ?? [];
}

export function createDefineInterfacesNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const domains = state.domains ?? [];

    // ── Hierarchical mode: per-domain interface definition ──
    if (domains.length > 0 && state.modules.length > 8) {
      return await defineInterfacesPerDomain(deps, state, domains);
    }

    // ── Standard mode: single-pass ──
    return await defineInterfacesSinglePass(deps, state);
  };
}

async function defineInterfacesSinglePass(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
): Promise<Partial<ArchitectureDesignGraphState>> {
  const messages = deps.promptRegistry.buildMessages(
    "architecture/define-interfaces",
    {
      requirement: state.requirement,
      pattern: state.selectedPattern ?? "layered",
      modules_json: JSON.stringify(state.modules),
    },
    `Define interfaces for ${state.modules.length} modules.`,
  );
  const response = await withRetry(() =>
    deps.modelProvider.chatWithTools(messages, [defineInterfacesTool], {
      modelRole: "architect",
      temperature: 0.3,
    }),
  );
  const args = extractToolArgs(response, "define_interfaces");
  if (!args) {
    console.warn(
      "[arch] defineInterfacesSinglePass: LLM did not produce define_interfaces tool call — returning empty interfaces",
    );
    return { interfaces: [] };
  }

  return { interfaces: (args.interfaces as any[]) ?? [] };
}

async function defineInterfacesPerDomain(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  domains: any[],
): Promise<Partial<ArchitectureDesignGraphState>> {
  const allInterfaces: any[] = [];

  for (const domain of domains) {
    const domainModules = state.modules.filter(
      (m) => m.id.startsWith(`${domain.id}_`) || m.id.startsWith(`${domain.id}-`),
    );
    if (domainModules.length === 0) continue;

    const otherDomainSummary = domains
      .filter((d: any) => d.id !== domain.id)
      .map((d: any) => `${d.name}: ${d.description}`)
      .join("; ");

    // Accumulate completed domains context
    const completedContext =
      allInterfaces.length > 0
        ? `\n\nAlready defined interfaces from other domains (reference for cross-domain contracts, do NOT duplicate):\n${summarizeInterfaces(allInterfaces)}`
        : "";

    const prompt = [
      `Define interfaces for domain "${domain.name}" modules.`,
      `Other domains in the system: ${otherDomainSummary}`,
      `Include cross-domain interfaces where needed. If another domain already exposes an interface you need, reference it by name instead of redefining.`,
      completedContext,
    ]
      .filter(Boolean)
      .join("\n");

    const messages = deps.promptRegistry.buildMessages(
      "architecture/define-interfaces",
      {
        requirement: prompt,
        pattern: state.selectedPattern ?? "layered",
        modules_json: JSON.stringify(domainModules),
      },
      prompt,
    );
    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [defineInterfacesTool], {
        modelRole: "architect",
        temperature: 0.3,
      }),
    );
    const args = extractToolArgs(response, "define_interfaces");
    if (!args) {
      console.warn(
        `[arch] defineInterfacesPerDomain: LLM did not produce define_interfaces for domain "${domain.name}"`,
      );
    } else if (args.interfaces) {
      allInterfaces.push(...(args.interfaces as any[]));
    }
  }

  return { interfaces: allInterfaces };
}

export function createDesignReviewNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-review",
      {
        requirement: state.requirement,
        pattern: state.selectedPattern ?? "layered",
        modules_json: JSON.stringify(state.modules),
        interfaces_json: JSON.stringify(state.interfaces),
        entities_json: JSON.stringify(state.entities ?? []),
        api_endpoints_json: JSON.stringify(state.apiEndpoints ?? []),
        integration_type: getIntegrationType(state),
      },
      "Review this architecture design.",
    );
    const response = await deps.modelProvider.chatWithTools(messages, [designReviewTool], {
      modelRole: "reviewer",
      temperature: 0.3,
    });
    const args = extractToolArgs(response, "design_review");
    if (!args) return { designReview: { omissions: [], couplingIssues: [], suggestions: [] } };

    const criticalIssues = (args.critical_issues as any[]) ?? [];
    // Backward-compatible flat arrays derived from structured issues
    return {
      designReview: {
        omissions: criticalIssues
          .filter((i: any) => i.type === "omission")
          .map((i: any) => i.description),
        couplingIssues: criticalIssues
          .filter((i: any) => i.type === "coupling")
          .map((i: any) => i.description),
        suggestions: (args.priority_recommendations as string[]) ?? [],
        criticalIssues,
        reviewPassed: (args.review_passed as boolean) ?? true,
        overallAssessment: (args.overall_assessment as string) ?? "",
      },
    };
  };
}

export function createValidateArchitectureNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const messages = deps.promptRegistry.buildMessages(
      "architecture/validate-architecture",
      {
        requirement: state.requirement,
        pattern: state.selectedPattern ?? "layered",
        modules_json: JSON.stringify(state.modules),
        interfaces_json: JSON.stringify(state.interfaces),
        responsibility_matrix_json: JSON.stringify(state.responsibilityMatrix),
        entities_json: JSON.stringify(state.entities ?? []),
        api_endpoints_json: JSON.stringify(state.apiEndpoints ?? []),
        review_json: JSON.stringify(state.designReview ?? {}),
        integration_type: getIntegrationType(state),
      },
      "Validate this architecture.",
    );
    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [validateArchitectureTool], {
        modelRole: "reviewer",
        temperature: 0.2,
      }),
    );
    const args = extractToolArgs(response, "validate_architecture");
    if (!args) return { needsRefinement: false };

    const overallScore = (args.overall_score as number) ?? 100;
    const needsRefinement = (args.needs_refinement as boolean) ?? overallScore < 80;

    return {
      needsRefinement,
      validationResult: {
        overallScore,
        requirementCoverage: (args.requirement_coverage as number) ?? 100,
        issues: (args.architecture_issues as any[]) ?? [],
        missingInterfaces: (args.missing_interfaces as any[]) ?? [],
        responsibilityConflicts: ((args.responsibility_conflicts as any[]) ?? []).map((c: any) => ({
          featureIds: c.feature_ids ?? [],
          sharedModule: c.shared_module ?? "",
          suggestion: c.suggestion ?? "",
        })),
        refinementInstructions: (args.refinement_instructions as string[]) ?? [],
      },
    };
  };
}

export function createDesignDataModelNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const domains = state.domains ?? [];

    // ── Hierarchical mode: per-domain data model ──
    if (domains.length > 0 && state.modules.length > 8) {
      return await designDataModelPerDomain(deps, state, domains);
    }

    // ── Standard mode: single-pass ──
    return await designDataModelSinglePass(deps, state);
  };
}

async function designDataModelSinglePass(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
): Promise<Partial<ArchitectureDesignGraphState>> {
  const keyEntities = state.requirementAnalysis?.keyEntities ?? [];
  const messages = deps.promptRegistry.buildMessages(
    "architecture/design-data-model",
    {
      requirement: state.requirement,
      modules_json: JSON.stringify(state.modules),
      interfaces_json: JSON.stringify(state.interfaces),
      key_entities: keyEntities.join(", ") || "(none)",
    },
    "Design the data model.",
  );
  const response = await withRetry(() =>
    deps.modelProvider.chatWithTools(messages, [designDataModelTool], {
      modelRole: "architect",
      temperature: 0.3,
    }),
  );
  const args = extractToolArgs(response, "design_data_model");
  if (!args) return { entities: [] };

  return { entities: (args.entities as any[]) ?? [] };
}

async function designDataModelPerDomain(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  domains: any[],
): Promise<Partial<ArchitectureDesignGraphState>> {
  const allEntities: any[] = [];

  for (const domain of domains) {
    const domainModules = state.modules.filter(
      (m) => m.id.startsWith(`${domain.id}_`) || m.id.startsWith(`${domain.id}-`),
    );
    const domainInterfaces = state.interfaces.filter(
      (i) =>
        i.exposedBy &&
        (i.exposedBy.startsWith(`${domain.id}_`) || i.exposedBy.startsWith(`${domain.id}-`)),
    );
    if (domainModules.length === 0) continue;

    // Accumulate completed domains context
    const completedContext =
      allEntities.length > 0
        ? `\n\nAlready designed entities from other domains (do NOT redefine shared entities — reference them by name if needed):\n${summarizeEntities(allEntities)}`
        : "";

    const prompt = [
      `Design data entities for domain "${domain.name}" (${domain.description}).`,
      `Focus on entities owned by this domain's modules.`,
      completedContext,
    ]
      .filter(Boolean)
      .join("\n");

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-data-model",
      {
        requirement: prompt,
        modules_json: JSON.stringify(domainModules),
        interfaces_json: JSON.stringify(domainInterfaces),
        key_entities: "(domain-specific)",
      },
      prompt,
    );
    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [designDataModelTool], {
        modelRole: "architect",
        temperature: 0.3,
      }),
    );
    const args = extractToolArgs(response, "design_data_model");
    if (args?.entities) {
      allEntities.push(...(args.entities as any[]));
    }
  }

  return { entities: allEntities };
}

export function createDesignApiEndpointsNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const domains = state.domains ?? [];

    // ── Hierarchical mode: per-domain API endpoints ──
    if (domains.length > 0 && state.modules.length > 8) {
      return await designApiEndpointsPerDomain(deps, state, domains);
    }

    // ── Standard mode: single-pass ──
    return await designApiEndpointsSinglePass(deps, state);
  };
}

async function designApiEndpointsSinglePass(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
): Promise<Partial<ArchitectureDesignGraphState>> {
  const messages = deps.promptRegistry.buildMessages(
    "architecture/design-api-endpoints",
    {
      requirement: state.requirement,
      modules_json: JSON.stringify(state.modules),
      interfaces_json: JSON.stringify(state.interfaces),
      entities_json: JSON.stringify(state.entities),
    },
    "Design the API endpoints.",
  );
  const response = await withRetry(() =>
    deps.modelProvider.chatWithTools(messages, [designApiEndpointsTool], {
      modelRole: "architect",
      temperature: 0.3,
    }),
  );
  const args = extractToolArgs(response, "design_api_endpoints");
  if (!args) return { apiEndpoints: [] };

  return { apiEndpoints: (args.endpoints as any[]) ?? [] };
}

async function designApiEndpointsPerDomain(
  deps: ArchitectureNodeDeps,
  state: ArchitectureDesignGraphState,
  domains: any[],
): Promise<Partial<ArchitectureDesignGraphState>> {
  const allEndpoints: any[] = [];

  for (const domain of domains) {
    const domainModules = state.modules.filter(
      (m) => m.id.startsWith(`${domain.id}_`) || m.id.startsWith(`${domain.id}-`),
    );
    const domainEntities = state.entities.filter(
      (e) =>
        e.ownerModule &&
        (e.ownerModule.startsWith(`${domain.id}_`) || e.ownerModule.startsWith(`${domain.id}-`)),
    );
    const domainInterfaces = state.interfaces.filter(
      (i) =>
        i.exposedBy &&
        (i.exposedBy.startsWith(`${domain.id}_`) || i.exposedBy.startsWith(`${domain.id}-`)),
    );
    if (domainModules.length === 0) continue;

    // Accumulate completed domains context
    const completedContext =
      allEndpoints.length > 0
        ? `\n\nAlready designed API endpoints from other domains (do NOT duplicate — use distinct path prefixes for this domain):\n${summarizeEndpoints(allEndpoints)}`
        : "";

    const prompt = [
      `Design API endpoints for domain "${domain.name}" (${domain.description}).`,
      `Focus on endpoints exposed by this domain's modules.`,
      completedContext,
    ]
      .filter(Boolean)
      .join("\n");

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-api-endpoints",
      {
        requirement: prompt,
        modules_json: JSON.stringify(domainModules),
        interfaces_json: JSON.stringify(domainInterfaces),
        entities_json: JSON.stringify(domainEntities),
      },
      prompt,
    );
    const response = await withRetry(() =>
      deps.modelProvider.chatWithTools(messages, [designApiEndpointsTool], {
        modelRole: "architect",
        temperature: 0.3,
      }),
    );
    const args = extractToolArgs(response, "design_api_endpoints");
    if (args?.endpoints) {
      allEndpoints.push(...(args.endpoints as any[]));
    }
  }

  return { apiEndpoints: allEndpoints };
}

export function createDesignFileStructureNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const analysis = state.requirementAnalysis;
    const arch = state.customArchitecture;

    // Build module size budget summary from upstream estimatedSize
    const moduleSizeBudget = state.modules
      .filter((m) => m.estimatedSize)
      .map(
        (m) =>
          `- ${m.id} (${m.name}): ~${m.estimatedSize!.files} files, ~${m.estimatedSize!.lines} lines`,
      )
      .join("\n");
    const totalEstimatedFiles = state.modules.reduce(
      (sum, m) => sum + (m.estimatedSize?.files ?? 0),
      0,
    );

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-file-structure",
      {
        requirement: state.requirement,
        pattern: state.selectedPattern ?? "layered",
        scale: analysis?.scale ?? "medium",
        complexity: analysis?.complexity ?? "medium",
        integration_type: analysis?.integrationType ?? "pure_extension",
        architecture_name: arch?.name ?? state.selectedPattern ?? "layered",
        architecture_description: arch?.description ?? "",
        module_organization: arch?.moduleOrganization ?? "",
        modules_json: JSON.stringify(state.modules),
        interfaces_json: JSON.stringify(state.interfaces),
        entities_json: JSON.stringify(state.entities ?? []),
        api_endpoints_json: JSON.stringify(state.apiEndpoints ?? []),
        domains_json: JSON.stringify(state.domains ?? []),
        module_size_budget: moduleSizeBudget || "(no estimates available)",
        total_estimated_files: String(totalEstimatedFiles || "unknown"),
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
    const specContent = generateSpecMarkdown(state);

    return {
      openspecFiles: ["design.md", "tasks.md", "spec.md"],
      openspecDocuments: {
        "design.md": designContent,
        "tasks.md": tasksContent,
        "spec.md": specContent,
      },
    };
  };
}

export function createRefineDesignNode(deps: ArchitectureNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const validation = state.validationResult;
    if (!validation) {
      // No validation result — skip refinement
      return {
        refinementIteration: state.refinementIteration + 1,
        needsRefinement: false,
      };
    }

    try {
      const modulesInfo = state.modules
        .map((m) => `- ${m.id}: ${m.name} (layer: ${m.layer ?? "N/A"}) — ${m.description}`)
        .join("\n");
      const interfacesInfo = state.interfaces
        .map((i) => `- ${i.id}: ${i.name} (${i.type}, exposedBy: ${i.exposedBy ?? "N/A"})`)
        .join("\n");
      const matrixInfo = state.responsibilityMatrix
        .map((r) => `- ${r.featureId} → ${r.moduleId}: ${r.responsibility}`)
        .join("\n");
      const issuesInfo = validation.issues
        .map((i) => `- [${i.severity}] ${i.type}: ${i.description}`)
        .join("\n");
      const missingInfo = validation.missingInterfaces
        .map((m) => `- [${m.priority}] ${m.name} (module: ${m.module}): ${m.reason}`)
        .join("\n");
      const conflictsInfo = validation.responsibilityConflicts
        .map((c) => `- ${c.sharedModule}: ${c.suggestion}`)
        .join("\n");
      const instructionsInfo = validation.refinementInstructions.join("\n- ");

      const messages = deps.promptRegistry.buildMessages(
        "architecture/refine-design",
        {
          modules_info: modulesInfo || "(none)",
          interfaces_info: interfacesInfo || "(none)",
          responsibility_matrix_info: matrixInfo || "(none)",
          architecture_issues: issuesInfo || "(none)",
          missing_interfaces: missingInfo || "(none)",
          responsibility_conflicts: conflictsInfo || "(none)",
          refinement_instructions: instructionsInfo || "(none)",
        },
        "Refine the architecture design based on validation feedback.",
      );

      const response = await withRetry(() =>
        deps.modelProvider.chatWithTools(messages, [refineDesignTool], {
          modelRole: "architect",
          temperature: 0.3,
        }),
      );
      const args = extractToolArgs(response, "refine_design");
      if (!args) {
        // LLM didn't call tool — graceful degradation
        return {
          refinementIteration: state.refinementIteration + 1,
          needsRefinement: false,
        };
      }

      const refinedModules = (args.refined_modules as any[]) ?? state.modules;
      const refinedInterfaces = (args.refined_interfaces as any[]) ?? state.interfaces;
      const refinedMatrix =
        (args.refined_responsibility_matrix as any[]) ?? state.responsibilityMatrix;
      const changesMade = (args.changes_made as string[]) ?? [];
      const summary = (args.refinement_summary as string) ?? "";

      return {
        modules: refinedModules,
        interfaces: refinedInterfaces,
        responsibilityMatrix: refinedMatrix,
        refinementIteration: state.refinementIteration + 1,
        needsRefinement: false,
        refinementHistory: [
          ...state.refinementHistory,
          {
            iteration: state.refinementIteration + 1,
            issues: validation.issues.map((i) => i.description),
            actions: changesMade.length > 0 ? changesMade : [summary],
          },
        ],
      };
    } catch {
      // Error — graceful degradation, skip refinement
      return {
        refinementIteration: state.refinementIteration + 1,
        needsRefinement: false,
      };
    }
  };
}
