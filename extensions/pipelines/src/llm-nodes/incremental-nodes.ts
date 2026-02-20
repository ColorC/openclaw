/**
 * Incremental Design Nodes
 *
 * 增量修改模式的 3 个节点工厂：
 * 1. loadExistingContext — 从数据库加载现有架构和需求快照
 * 2. analyzeChangeImpact — LLM 分析变更对现有架构的影响
 * 3. designDelta — LLM 基于影响分析设计增量变更，合并到现有架构
 *
 * 合并策略：designDelta 将 delta 结果合并到 existingArchitecture，
 * 生成完整的 modules/interfaces/entities，这样后续的
 * design_review → validate_architecture → refine_design 无需修改。
 */

import type { ModelProvider, ToolDefinition } from "../llm/types.js";
import type { IncrementalDB } from "../pm/incremental-db.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import type {
  ModuleDefinition,
  InterfaceDefinition,
  EntityDefinition,
  ApiEndpointDefinition,
  DomainDefinition,
  ArchitectureSnapshot,
  DeltaPlanResult,
  ImpactSummary,
} from "../workflows/states.js";

// ============================================================================
// Deps
// ============================================================================

export interface IncrementalNodeDeps {
  modelProvider: ModelProvider;
  promptRegistry: PromptRegistry;
  db: IncrementalDB;
}

// ============================================================================
// Tool Schemas
// ============================================================================

const analyzeChangeImpactTool: ToolDefinition = {
  name: "analyze_change_impact",
  description: "Analyze the impact of a change request on the existing architecture",
  parameters: {
    type: "object",
    properties: {
      affectedModules: {
        type: "array",
        items: { type: "string" },
        description: "IDs of modules affected by the change",
      },
      affectedInterfaces: {
        type: "array",
        items: { type: "string" },
        description: "IDs of interfaces affected by the change",
      },
      affectedEntities: {
        type: "array",
        items: { type: "string" },
        description: "IDs of entities affected by the change",
      },
      affectedEndpoints: {
        type: "array",
        items: { type: "string" },
        description: "IDs of API endpoints affected by the change",
      },
      affectedSpecs: {
        type: "array",
        items: { type: "string" },
        description: "Paths of spec files affected by the change",
      },
      impactLevel: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Overall impact level of the change",
      },
      reasoning: {
        type: "string",
        description: "Detailed reasoning for the impact assessment",
      },
    },
    required: [
      "affectedModules",
      "affectedInterfaces",
      "affectedEntities",
      "affectedEndpoints",
      "affectedSpecs",
      "impactLevel",
      "reasoning",
    ],
  },
};

const designDeltaTool: ToolDefinition = {
  name: "design_delta",
  description: "Design incremental changes to the existing architecture",
  parameters: {
    type: "object",
    properties: {
      addedModules: {
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
      modifiedModules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            changes: { type: "object" },
            reason: { type: "string" },
          },
          required: ["id", "changes", "reason"],
        },
      },
      removedModules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
      },
      addedInterfaces: {
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
      modifiedInterfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            changes: { type: "object" },
            reason: { type: "string" },
          },
          required: ["id", "changes", "reason"],
        },
      },
      removedInterfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
      },
      addedEntities: {
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
      modifiedEntities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            changes: { type: "object" },
            reason: { type: "string" },
          },
          required: ["id", "changes", "reason"],
        },
      },
      removedEntities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
      },
    },
    required: [
      "addedModules",
      "modifiedModules",
      "removedModules",
      "addedInterfaces",
      "modifiedInterfaces",
      "removedInterfaces",
      "addedEntities",
      "modifiedEntities",
      "removedEntities",
    ],
  },
};

// ============================================================================
// Helpers
// ============================================================================

function extractToolArgs(
  response: { toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> },
  toolName: string,
) {
  const tc = response.toolCalls?.find((t) => t.name === toolName);
  return tc?.arguments;
}

/** Compact summary of existing architecture for prompt injection */
function summarizeArchitecture(arch: {
  modules?: ModuleDefinition[];
  interfaces?: InterfaceDefinition[];
  entities?: EntityDefinition[];
  apiEndpoints?: ApiEndpointDefinition[];
  domains?: DomainDefinition[];
  selectedPattern?: string;
}): string {
  const lines: string[] = [];

  if (arch.selectedPattern) {
    lines.push(`## Architecture Pattern: ${arch.selectedPattern}`);
  }

  if (arch.modules?.length) {
    lines.push("\n## Modules");
    for (const m of arch.modules) {
      lines.push(
        `- **${m.id}**: ${m.name} [${m.layer ?? "?"}] — ${m.responsibilities.slice(0, 3).join("; ")}`,
      );
      if (m.dependencies.length) lines.push(`  deps: ${m.dependencies.join(", ")}`);
    }
  }

  if (arch.interfaces?.length) {
    lines.push("\n## Interfaces");
    for (const i of arch.interfaces) {
      lines.push(
        `- **${i.id}**: ${i.name} (${i.type}, ${i.direction ?? "?"}) exposedBy=${i.exposedBy ?? "?"} methods=${i.methods.length}`,
      );
    }
  }

  if (arch.entities?.length) {
    lines.push("\n## Entities");
    for (const e of arch.entities) {
      lines.push(
        `- **${e.id}**: ${e.name} [owner=${e.ownerModule ?? "?"}] attrs=${e.attributes.length} rels=${e.relationships.length}`,
      );
    }
  }

  if (arch.apiEndpoints?.length) {
    lines.push("\n## API Endpoints");
    for (const ep of arch.apiEndpoints) {
      lines.push(`- **${ep.id}**: ${ep.method} ${ep.path} [owner=${ep.ownerModule ?? "?"}]`);
    }
  }

  if (arch.domains?.length) {
    lines.push("\n## Domains");
    for (const d of arch.domains) {
      lines.push(`- **${d.id}**: ${d.name} — features: ${d.featureIds.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Node 1: Load Existing Context
// ============================================================================

/**
 * 从 IncrementalDB 加载现有架构和需求快照。
 * 输入：state.projectPath 或 state.projectId
 * 输出：{ existingArchitecture, existingRequirements, projectId }
 */
export function createLoadExistingContextNode(deps: IncrementalNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    // Resolve project
    const projectPath = state.projectPath;
    if (!projectPath) {
      return { error: "projectPath is required for modify_existing scenario" };
    }

    const project = deps.db.getOrCreateProject(projectPath);

    // Load latest snapshots
    const archSnapshot = deps.db.getLatestSnapshot(project.id, "architecture");
    const reqSnapshot = deps.db.getLatestSnapshot(project.id, "requirement");

    const result: Partial<ArchitectureDesignGraphState> = {
      projectId: project.id,
      scenario: "modify_existing",
    };

    if (archSnapshot?.architectureJson) {
      result.existingArchitecture = archSnapshot.architectureJson;
      // Pre-populate design fields from existing architecture so downstream
      // nodes (design_review, validate_architecture) see the full picture
      result.selectedPattern = archSnapshot.architectureJson.selectedPattern;
      result.modules = archSnapshot.architectureJson.modules;
      result.interfaces = archSnapshot.architectureJson.interfaces;
      result.entities = archSnapshot.architectureJson.entities;
      result.apiEndpoints = archSnapshot.architectureJson.apiEndpoints;
      result.domains = archSnapshot.architectureJson.domains;
    }

    if (reqSnapshot?.requirementSummary) {
      result.existingRequirements = reqSnapshot.requirementSummary;
    }

    console.log(
      `[incremental] Loaded context for project ${project.name} (v${project.currentVersion}): ` +
        `arch=${archSnapshot ? "yes" : "no"}, req=${reqSnapshot ? "yes" : "no"}`,
    );

    return result;
  };
}

// ============================================================================
// Node 2: Analyze Change Impact
// ============================================================================

/**
 * LLM 分析变更需求对现有架构的影响。
 * 输入：state.requirement + state.existingArchitecture
 * 输出：{ changeImpact }
 */
export function createAnalyzeChangeImpactNode(deps: IncrementalNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const arch = state.existingArchitecture;
    if (!arch) {
      // No existing architecture — treat as new project (low impact)
      return {
        changeImpact: {
          affectedModules: [],
          affectedInterfaces: [],
          affectedEntities: [],
          affectedEndpoints: [],
          affectedSpecs: [],
          impactLevel: "low",
          reasoning: "No existing architecture found; treating as greenfield.",
        },
      };
    }

    const archSummary = summarizeArchitecture(arch);

    const messages = deps.promptRegistry.buildMessages(
      "architecture/analyze-change-impact",
      {
        requirement: state.requirement,
        existing_architecture: archSummary,
        existing_modules: JSON.stringify(arch.modules.map((m) => m.id)),
        existing_interfaces: JSON.stringify(arch.interfaces.map((i) => i.id)),
        existing_entities: JSON.stringify(arch.entities.map((e) => e.id)),
        existing_endpoints: JSON.stringify(arch.apiEndpoints.map((ep) => ep.id)),
      },
      state.requirement,
    );

    const response = await deps.modelProvider.chatWithTools(messages, [analyzeChangeImpactTool], {
      modelRole: "architect",
      temperature: 0.3,
    });

    const args = extractToolArgs(response, "analyze_change_impact");
    if (!args) {
      return {
        changeImpact: {
          affectedModules: [],
          affectedInterfaces: [],
          affectedEntities: [],
          affectedEndpoints: [],
          affectedSpecs: [],
          impactLevel: "medium",
          reasoning: "LLM did not return structured impact analysis; defaulting to medium impact.",
        },
      };
    }

    const impact: ImpactSummary = {
      affectedModules: (args.affectedModules as string[]) ?? [],
      affectedInterfaces: (args.affectedInterfaces as string[]) ?? [],
      affectedEntities: (args.affectedEntities as string[]) ?? [],
      affectedEndpoints: (args.affectedEndpoints as string[]) ?? [],
      affectedSpecs: (args.affectedSpecs as string[]) ?? [],
      impactLevel: (args.impactLevel as ImpactSummary["impactLevel"]) ?? "medium",
      reasoning: (args.reasoning as string) ?? "",
    };

    // Persist impact to DB if we have a change record
    if (state.changeRecordId) {
      deps.db.updateChangeImpact(state.changeRecordId, impact);
    }

    console.log(
      `[incremental] Impact analysis: level=${impact.impactLevel}, ` +
        `modules=${impact.affectedModules.length}, interfaces=${impact.affectedInterfaces.length}, ` +
        `entities=${impact.affectedEntities.length}`,
    );

    return { changeImpact: impact };
  };
}

// ============================================================================
// Node 3: Design Delta
// ============================================================================

/**
 * LLM 基于影响分析设计增量变更，然后合并到现有架构。
 * 输入：state.changeImpact + state.existingArchitecture + state.requirement
 * 输出：{ deltaPlan } + 合并后的 { modules, interfaces, entities }
 *
 * 合并后的完整架构供后续 design_review → validate_architecture 使用，
 * 这些节点无需知道是增量还是全新设计。
 */
export function createDesignDeltaNode(deps: IncrementalNodeDeps) {
  return async (
    state: ArchitectureDesignGraphState,
  ): Promise<Partial<ArchitectureDesignGraphState>> => {
    const arch = state.existingArchitecture;
    const impact = state.changeImpact;

    if (!arch) {
      return { error: "existingArchitecture is required for design_delta" };
    }

    const archSummary = summarizeArchitecture(arch);
    const impactSummary = impact
      ? `Impact Level: ${impact.impactLevel}\n` +
        `Affected Modules: ${impact.affectedModules.join(", ") || "none"}\n` +
        `Affected Interfaces: ${impact.affectedInterfaces.join(", ") || "none"}\n` +
        `Affected Entities: ${impact.affectedEntities.join(", ") || "none"}\n` +
        `Reasoning: ${impact.reasoning}`
      : "No impact analysis available.";

    const messages = deps.promptRegistry.buildMessages(
      "architecture/design-delta",
      {
        requirement: state.requirement,
        existing_architecture: archSummary,
        impact_analysis: impactSummary,
        existing_modules_json: JSON.stringify(arch.modules, null, 2),
        existing_interfaces_json: JSON.stringify(arch.interfaces, null, 2),
        existing_entities_json: JSON.stringify(arch.entities, null, 2),
      },
      state.requirement,
    );

    const response = await deps.modelProvider.chatWithTools(messages, [designDeltaTool], {
      modelRole: "architect",
      temperature: 0.3,
    });

    const args = extractToolArgs(response, "design_delta");
    if (!args) {
      // Fallback: no changes
      return {
        deltaPlan: {
          addedModules: [],
          modifiedModules: [],
          removedModules: [],
          addedInterfaces: [],
          modifiedInterfaces: [],
          removedInterfaces: [],
          addedEntities: [],
          modifiedEntities: [],
          removedEntities: [],
        },
      };
    }

    const delta: DeltaPlanResult = {
      addedModules: (args.addedModules as ModuleDefinition[]) ?? [],
      modifiedModules: (args.modifiedModules as DeltaPlanResult["modifiedModules"]) ?? [],
      removedModules: (args.removedModules as DeltaPlanResult["removedModules"]) ?? [],
      addedInterfaces: (args.addedInterfaces as InterfaceDefinition[]) ?? [],
      modifiedInterfaces: (args.modifiedInterfaces as DeltaPlanResult["modifiedInterfaces"]) ?? [],
      removedInterfaces: (args.removedInterfaces as DeltaPlanResult["removedInterfaces"]) ?? [],
      addedEntities: (args.addedEntities as EntityDefinition[]) ?? [],
      modifiedEntities: (args.modifiedEntities as DeltaPlanResult["modifiedEntities"]) ?? [],
      removedEntities: (args.removedEntities as DeltaPlanResult["removedEntities"]) ?? [],
    };

    // Merge delta into existing architecture
    const merged = applyDelta(arch, delta);

    // Persist delta to DB if we have a change record
    if (state.changeRecordId) {
      deps.db.updateChangeDelta(state.changeRecordId, {
        added: [
          ...delta.addedModules.map((m) => ({ type: "module", id: m.id, description: m.name })),
          ...delta.addedInterfaces.map((i) => ({
            type: "interface",
            id: i.id,
            description: i.name,
          })),
          ...delta.addedEntities.map((e) => ({ type: "entity", id: e.id, description: e.name })),
        ],
        modified: [
          ...delta.modifiedModules.map((m) => ({
            type: "module",
            id: m.id,
            description: m.reason,
            changes: JSON.stringify(m.changes),
          })),
          ...delta.modifiedInterfaces.map((i) => ({
            type: "interface",
            id: i.id,
            description: i.reason,
            changes: JSON.stringify(i.changes),
          })),
          ...delta.modifiedEntities.map((e) => ({
            type: "entity",
            id: e.id,
            description: e.reason,
            changes: JSON.stringify(e.changes),
          })),
        ],
        removed: [
          ...delta.removedModules.map((m) => ({ type: "module", id: m.id, reason: m.reason })),
          ...delta.removedInterfaces.map((i) => ({
            type: "interface",
            id: i.id,
            reason: i.reason,
          })),
          ...delta.removedEntities.map((e) => ({ type: "entity", id: e.id, reason: e.reason })),
        ],
        renamed: [],
      });
    }

    const totalChanges =
      delta.addedModules.length +
      delta.modifiedModules.length +
      delta.removedModules.length +
      delta.addedInterfaces.length +
      delta.modifiedInterfaces.length +
      delta.removedInterfaces.length +
      delta.addedEntities.length +
      delta.modifiedEntities.length +
      delta.removedEntities.length;

    console.log(
      `[incremental] Delta design: ${totalChanges} total changes ` +
        `(+${delta.addedModules.length}m ~${delta.modifiedModules.length}m -${delta.removedModules.length}m, ` +
        `+${delta.addedInterfaces.length}i ~${delta.modifiedInterfaces.length}i -${delta.removedInterfaces.length}i, ` +
        `+${delta.addedEntities.length}e ~${delta.modifiedEntities.length}e -${delta.removedEntities.length}e)`,
    );

    return {
      deltaPlan: delta,
      // Merged results — downstream nodes see the full picture
      modules: merged.modules,
      interfaces: merged.interfaces,
      entities: merged.entities,
      apiEndpoints: merged.apiEndpoints,
      domains: merged.domains,
    };
  };
}

// ============================================================================
// Delta Merge Logic
// ============================================================================

interface MergedArchitecture {
  selectedPattern?: string;
  fileStructure?: Record<string, unknown>;
  modules: ModuleDefinition[];
  interfaces: InterfaceDefinition[];
  entities: EntityDefinition[];
  apiEndpoints: ApiEndpointDefinition[];
  domains: DomainDefinition[];
}

/**
 * Apply a DeltaPlanResult to an existing architecture snapshot.
 * Order: REMOVED → MODIFIED → ADDED (consistent with OpenSpec Delta Spec)
 * Preserves all fields from existing that are not covered by delta (selectedPattern, fileStructure, etc.)
 */
export function applyDelta(
  existing: ArchitectureSnapshot,
  delta: DeltaPlanResult,
): MergedArchitecture {
  return {
    // Preserve fields not covered by delta
    selectedPattern: existing.selectedPattern,
    fileStructure: existing.fileStructure,
    // Merge the core components
    modules: mergeItems(
      existing.modules,
      delta.addedModules,
      delta.modifiedModules,
      delta.removedModules,
    ),
    interfaces: mergeItems(
      existing.interfaces,
      delta.addedInterfaces,
      delta.modifiedInterfaces,
      delta.removedInterfaces,
    ),
    entities: mergeItems(
      existing.entities,
      delta.addedEntities,
      delta.modifiedEntities,
      delta.removedEntities,
    ),
    // API endpoints and domains pass through unchanged (delta doesn't cover them yet)
    apiEndpoints: [...existing.apiEndpoints],
    domains: [...existing.domains],
  };
}

function mergeItems<T extends { id: string }>(
  existing: T[],
  added: T[],
  modified: Array<{ id: string; changes: Partial<T>; reason: string }>,
  removed: Array<{ id: string; reason: string }>,
): T[] {
  const removedIds = new Set(removed.map((r) => r.id));
  const modifiedMap = new Map(modified.map((m) => [m.id, m.changes]));

  // 1. Remove
  let result = existing.filter((item) => !removedIds.has(item.id));

  // 2. Modify
  result = result.map((item) => {
    const changes = modifiedMap.get(item.id);
    if (changes) {
      return { ...item, ...changes };
    }
    return item;
  });

  // 3. Add
  result.push(...added);

  return result;
}
