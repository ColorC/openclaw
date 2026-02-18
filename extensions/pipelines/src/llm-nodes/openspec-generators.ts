/**
 * OpenSpec 文档生成器
 *
 * 从架构设计工作流的 state 数据生成 OpenSpec 格式文档：
 * - design.md: 技术设计文档（OpenSpec 标准节 + 自定义架构节）
 * - tasks.md: 实现任务分解（X.Y 编号格式）
 * - spec.md: 功能规格（WHEN/THEN 场景格式）
 *
 * OpenSpec 格式参考: @fission-ai/openspec v1.1.1 schemas/spec-driven/templates/
 */

import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import type {
  ModuleDefinition,
  InterfaceDefinition,
  ResponsibilityEntry,
  EntityDefinition,
  ApiEndpointDefinition,
  FeatureDefinition,
  DomainDefinition,
} from "../workflows/states.js";

// ============================================================================
// design.md 生成 (OpenSpec 格式)
// ============================================================================

/**
 * 生成 OpenSpec 格式的 design.md 技术设计文档
 *
 * 结构: OpenSpec 标准节 (Context, Goals, Decisions, Risks)
 *     + 自定义架构节 (Modules, Interfaces, Data Model, API, etc.)
 */
export function generateDesignMarkdown(
  state: Pick<
    ArchitectureDesignGraphState,
    | "requirement"
    | "requirementAnalysis"
    | "customArchitecture"
    | "selectedPattern"
    | "modules"
    | "interfaces"
    | "entities"
    | "apiEndpoints"
    | "domains"
    | "designReview"
    | "responsibilityMatrix"
    | "fileStructure"
    | "validationResult"
  >,
): string {
  const lines: string[] = [];
  const analysis = state.requirementAnalysis;
  const arch = state.customArchitecture;

  // ── OpenSpec Standard: Context ──
  lines.push("## Context", "");
  lines.push(state.requirement || "_No requirement specified_", "");
  if (analysis) {
    lines.push(
      `- **Scale**: ${analysis.scale} | **Complexity**: ${analysis.complexity} | **Domain**: ${analysis.domain}`,
    );
    if (analysis.keyEntities?.length) {
      lines.push(`- **Key Entities**: ${analysis.keyEntities.join(", ")}`);
    }
    if (analysis.techFeatures?.length) {
      lines.push(`- **Technical Features**: ${analysis.techFeatures.join(", ")}`);
    }
    if (analysis.reasoning) {
      lines.push("", `> ${analysis.reasoning}`);
    }
    lines.push("");
  }

  // ── OpenSpec Standard: Goals / Non-Goals ──
  lines.push("## Goals / Non-Goals", "");
  lines.push("**Goals:**");
  if (analysis?.keyEntities?.length) {
    for (const entity of analysis.keyEntities) {
      lines.push(`- Implement ${entity}`);
    }
  } else {
    lines.push("- Implement the described functionality");
  }
  lines.push("");
  lines.push("**Non-Goals:**");
  lines.push("- Out of scope features not mentioned in requirements", "");

  // ── OpenSpec Standard: Decisions ──
  lines.push("## Decisions", "");
  if (arch) {
    lines.push(`- **Architecture**: ${arch.name} (${arch.pattern})`);
    lines.push(`  - ${arch.description}`);
    if (arch.referencePatterns?.length) {
      lines.push(`  - Reference patterns: ${arch.referencePatterns.join(", ")}`);
    }
    if (arch.justification) {
      lines.push(`  - Rationale: ${arch.justification}`);
    }
    if (arch.moduleOrganization) {
      lines.push(`- **Module Organization**: ${arch.moduleOrganization}`);
    }
    if (arch.communicationPattern) {
      lines.push(`- **Communication**: ${arch.communicationPattern}`);
    }
    if (arch.deploymentArchitecture) {
      lines.push(`- **Deployment**: ${arch.deploymentArchitecture}`);
    }
  } else if (state.selectedPattern) {
    lines.push(`- **Architecture Pattern**: ${state.selectedPattern}`);
  }
  lines.push("");

  // ── OpenSpec Standard: Risks / Trade-offs ──
  renderRisksSection(lines, state);

  // ── Custom: Domain Decomposition (if hierarchical) ──
  if (state.domains?.length) {
    renderDomainsSection(lines, state.domains);
  }

  // ── Custom: Module Design ──
  renderModulesSection(lines, state.modules);

  // ── Custom: Interface Design ──
  renderInterfacesSection(lines, state.interfaces);

  // ── Custom: Data Model ──
  renderDataModelSection(lines, state.entities);

  // ── Custom: API Endpoints ──
  renderApiEndpointsSection(lines, state.apiEndpoints);

  // ── Custom: Responsibility Matrix ──
  if (state.responsibilityMatrix?.length) {
    lines.push("## Responsibility Matrix", "");
    lines.push("| Module | Feature | Responsibility |");
    lines.push("|--------|---------|---------------|");
    for (const entry of state.responsibilityMatrix) {
      lines.push(`| ${entry.moduleId} | ${entry.featureId} | ${entry.responsibility} |`);
    }
    lines.push("");
  }

  // ── Custom: Validation ──
  renderValidationSection(lines, state);

  // ── Custom: File Structure ──
  if (state.fileStructure && Object.keys(state.fileStructure).length > 0) {
    lines.push("## File Structure", "");
    lines.push("```");
    renderFileStructure(lines, state.fileStructure, 0);
    lines.push("```", "");
  }

  return lines.join("\n");
}

// ============================================================================
// design.md 辅助渲染函数
// ============================================================================

function renderRisksSection(
  lines: string[],
  state: { designReview?: any; validationResult?: any },
) {
  lines.push("## Risks / Trade-offs", "");
  const review = state.designReview;
  const validation = state.validationResult;
  let hasContent = false;

  if (review?.overallAssessment) {
    lines.push(`- **Design Review**: ${review.overallAssessment}`);
    hasContent = true;
  }
  if (review?.criticalIssues?.length) {
    for (const issue of review.criticalIssues) {
      lines.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
    }
    hasContent = true;
  }
  if (review?.suggestions?.length) {
    for (const s of review.suggestions) {
      lines.push(`- ${s}`);
    }
    hasContent = true;
  }
  if (validation) {
    lines.push(
      `- **Validation Score**: ${validation.overallScore}/100 (coverage: ${validation.requirementCoverage}/100)`,
    );
    hasContent = true;
    for (const issue of validation.issues ?? []) {
      lines.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
    }
  }
  if (!hasContent) {
    lines.push("_No significant risks identified_");
  }
  lines.push("");
}

function renderDomainsSection(lines: string[], domains: DomainDefinition[]) {
  lines.push("## Domain Decomposition", "");
  lines.push(`Total domains: ${domains.length}`, "");
  for (const domain of domains) {
    lines.push(`### ${domain.name} (\`${domain.id}\`)`, "");
    lines.push(domain.description, "");
    if (domain.featureIds?.length) {
      lines.push(`**Features:** ${domain.featureIds.join(", ")}`);
    }
    if (domain.boundaryInteractions?.length) {
      lines.push("**Boundary Interactions:**");
      for (const b of domain.boundaryInteractions) {
        lines.push(`- → ${b.targetDomain}: ${b.description}`);
      }
    }
    lines.push("");
  }
}

function renderModulesSection(lines: string[], modules: ModuleDefinition[]) {
  lines.push("## Module Design", "");
  if (modules?.length) {
    lines.push(`Total modules: ${modules.length}`, "");
    for (const mod of modules) {
      lines.push(`### ${mod.name} (\`${mod.id}\`)`, "");
      lines.push(mod.description, "");
      if (mod.layer) lines.push(`**Layer:** ${mod.layer}`, "");
      if (mod.estimatedSize) {
        const s = mod.estimatedSize;
        lines.push(
          `**Estimated Size:** ~${s.lines} lines, ${s.files} files, ${s.classes} classes`,
          "",
        );
      }
      if (mod.responsibilities?.length) {
        lines.push("**Responsibilities:**");
        for (const r of mod.responsibilities) lines.push(`- ${r}`);
        lines.push("");
      }
      if (mod.dependencies?.length) {
        lines.push(`**Dependencies:** ${mod.dependencies.join(", ")}`, "");
      }
    }
  } else {
    lines.push("_No modules defined_", "");
  }
}

function renderInterfacesSection(lines: string[], interfaces: InterfaceDefinition[]) {
  lines.push("## Interface Design", "");
  if (interfaces?.length) {
    lines.push(`Total interfaces: ${interfaces.length}`, "");
    for (const iface of interfaces) {
      lines.push(`### ${iface.name} (\`${iface.id}\`)`, "");
      lines.push(`**Type:** ${iface.type}`);
      if (iface.exposedBy) lines.push(`**Exposed By:** ${iface.exposedBy}`);
      if (iface.consumedBy?.length) lines.push(`**Consumed By:** ${iface.consumedBy.join(", ")}`);
      if (iface.layer) lines.push(`**Layer:** ${iface.layer}`);
      if (iface.direction) lines.push(`**Direction:** ${iface.direction}`);
      lines.push("");
      if (iface.methods?.length) {
        lines.push("| Method | Input | Output | Description |");
        lines.push("|--------|-------|--------|-------------|");
        for (const m of iface.methods) {
          lines.push(`| \`${m.name}\` | \`${m.input}\` | \`${m.output}\` | ${m.description} |`);
        }
        lines.push("");
      }
    }
  } else {
    lines.push("_No interfaces defined_", "");
  }
}

function renderDataModelSection(lines: string[], entities: EntityDefinition[]) {
  lines.push("## Data Model", "");
  if (entities?.length) {
    lines.push(`Total entities: ${entities.length}`, "");
    for (const entity of entities) {
      lines.push(`### ${entity.name} (\`${entity.id}\`)`, "");
      lines.push(entity.description, "");
      if (entity.ownerModule) lines.push(`**Owner Module:** ${entity.ownerModule}`, "");
      if (entity.attributes?.length) {
        lines.push("| Attribute | Type | Required | Description |");
        lines.push("|-----------|------|----------|-------------|");
        for (const attr of entity.attributes) {
          lines.push(
            `| \`${attr.name}\` | ${attr.type} | ${attr.required ? "Yes" : "No"} | ${attr.description ?? ""} |`,
          );
        }
        lines.push("");
      }
      if (entity.relationships?.length) {
        lines.push("**Relationships:**");
        for (const rel of entity.relationships) {
          lines.push(
            `- → \`${rel.target}\` (${rel.type})${rel.description ? `: ${rel.description}` : ""}`,
          );
        }
        lines.push("");
      }
    }
  } else {
    lines.push("_No entities defined_", "");
  }
}

function renderApiEndpointsSection(lines: string[], apiEndpoints: ApiEndpointDefinition[]) {
  lines.push("## API Endpoints", "");
  if (apiEndpoints?.length) {
    lines.push(`Total endpoints: ${apiEndpoints.length}`, "");
    lines.push("| Method | Path | Description | Auth | Owner Module |");
    lines.push("|--------|------|-------------|------|-------------|");
    for (const ep of apiEndpoints) {
      lines.push(
        `| \`${ep.method}\` | \`${ep.path}\` | ${ep.description} | ${ep.auth ? "Yes" : "No"} | ${ep.ownerModule ?? "-"} |`,
      );
    }
    lines.push("");
    for (const ep of apiEndpoints) {
      if (ep.requestBody || ep.responseBody) {
        lines.push(`### ${ep.method} ${ep.path}`, "");
        if (ep.requestBody) lines.push(`**Request:** ${ep.requestBody}`);
        if (ep.responseBody) lines.push(`**Response:** ${ep.responseBody}`);
        if (ep.relatedEntities?.length)
          lines.push(`**Related Entities:** ${ep.relatedEntities.join(", ")}`);
        lines.push("");
      }
    }
  } else {
    lines.push("_No API endpoints defined_", "");
  }
}

function renderValidationSection(lines: string[], state: { validationResult?: any }) {
  const v = state.validationResult;
  if (!v) return;
  lines.push("## Architecture Validation", "");
  lines.push(`- **Overall Score**: ${v.overallScore}/100`);
  lines.push(`- **Requirement Coverage**: ${v.requirementCoverage}/100`);
  lines.push("");
  if (v.missingInterfaces?.length) {
    lines.push("### Missing Interfaces");
    for (const mi of v.missingInterfaces) {
      lines.push(`- [${mi.priority}] ${mi.name} (module: ${mi.module}): ${mi.reason}`);
    }
    lines.push("");
  }
  if (v.responsibilityConflicts?.length) {
    lines.push("### Responsibility Conflicts");
    for (const rc of v.responsibilityConflicts) {
      lines.push(
        `- Features ${rc.featureIds.join(", ")} share module ${rc.sharedModule}: ${rc.suggestion}`,
      );
    }
    lines.push("");
  }
}

function renderFileStructure(
  lines: string[],
  structure: Record<string, unknown>,
  depth: number,
): void {
  const indent = "  ".repeat(depth);
  for (const [key, value] of Object.entries(structure)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${indent}${key}/`);
      renderFileStructure(lines, value as Record<string, unknown>, depth + 1);
    } else if (typeof value === "string") {
      lines.push(`${indent}${key} — ${value}`);
    } else {
      lines.push(`${indent}${key}`);
    }
  }
}

// ============================================================================
// tasks.md 生成 (OpenSpec X.Y 编号格式)
// ============================================================================

/**
 * 生成 OpenSpec 格式的 tasks.md 任务分解文档
 * 使用 ## N. Group Name + - [ ] N.M Task 格式
 */
export function generateArchitectureTasksMarkdown(
  state: Pick<ArchitectureDesignGraphState, "modules" | "interfaces" | "entities" | "apiEndpoints">,
): string {
  const lines: string[] = [];
  const modules = state.modules ?? [];
  const interfaces = state.interfaces ?? [];
  const entities = state.entities ?? [];
  const apiEndpoints = state.apiEndpoints ?? [];
  let groupNum = 0;

  // 1. Module Implementation
  groupNum++;
  lines.push(`## ${groupNum}. Module Implementation`, "");
  if (modules.length) {
    let taskNum = 0;
    for (const mod of modules) {
      taskNum++;
      const layerTag = mod.layer ? ` [${mod.layer}]` : "";
      lines.push(
        `- [ ] ${groupNum}.${taskNum} Create module \`${mod.id}\`${layerTag}: ${mod.description}`,
      );
      for (const r of mod.responsibilities ?? []) {
        taskNum++;
        lines.push(`- [ ] ${groupNum}.${taskNum} Implement: ${r}`);
      }
      if (mod.dependencies?.length) {
        taskNum++;
        lines.push(
          `- [ ] ${groupNum}.${taskNum} Wire dependencies: ${mod.dependencies.join(", ")}`,
        );
      }
    }
  } else {
    lines.push("_No modules to implement_");
  }
  lines.push("");

  // 2. Interface Definitions
  groupNum++;
  lines.push(`## ${groupNum}. Interface Definitions`, "");
  if (interfaces.length) {
    let taskNum = 0;
    for (const iface of interfaces) {
      taskNum++;
      const ownerTag = iface.exposedBy ? ` (owner: ${iface.exposedBy})` : "";
      lines.push(
        `- [ ] ${groupNum}.${taskNum} Define interface \`${iface.id}\` (${iface.type})${ownerTag}`,
      );
      for (const m of iface.methods ?? []) {
        taskNum++;
        lines.push(`- [ ] ${groupNum}.${taskNum} Implement \`${m.name}(${m.input}): ${m.output}\``);
      }
    }
  } else {
    lines.push("_No interfaces to define_");
  }
  lines.push("");

  // 3. Data Model
  groupNum++;
  lines.push(`## ${groupNum}. Data Model Implementation`, "");
  if (entities.length) {
    let taskNum = 0;
    for (const entity of entities) {
      taskNum++;
      const ownerTag = entity.ownerModule ? ` (module: ${entity.ownerModule})` : "";
      lines.push(
        `- [ ] ${groupNum}.${taskNum} Create entity \`${entity.id}\`: ${entity.name}${ownerTag}`,
      );
      for (const attr of entity.attributes ?? []) {
        taskNum++;
        lines.push(
          `- [ ] ${groupNum}.${taskNum} Add attribute \`${attr.name}: ${attr.type}\`${attr.required ? " (required)" : ""}`,
        );
      }
      for (const rel of entity.relationships ?? []) {
        taskNum++;
        lines.push(
          `- [ ] ${groupNum}.${taskNum} Define relationship → \`${rel.target}\` (${rel.type})`,
        );
      }
    }
  } else {
    lines.push("_No entities to implement_");
  }
  lines.push("");

  // 4. API Endpoints
  groupNum++;
  lines.push(`## ${groupNum}. API Endpoints`, "");
  if (apiEndpoints.length) {
    let taskNum = 0;
    for (const ep of apiEndpoints) {
      taskNum++;
      lines.push(
        `- [ ] ${groupNum}.${taskNum} Implement \`${ep.method} ${ep.path}\`: ${ep.description}`,
      );
      if (ep.requestBody) {
        taskNum++;
        lines.push(`- [ ] ${groupNum}.${taskNum} Request validation: ${ep.requestBody}`);
      }
      if (ep.responseBody) {
        taskNum++;
        lines.push(`- [ ] ${groupNum}.${taskNum} Response serialization: ${ep.responseBody}`);
      }
      if (ep.auth) {
        taskNum++;
        lines.push(`- [ ] ${groupNum}.${taskNum} Add authentication guard`);
      }
    }
  } else {
    lines.push("_No API endpoints to implement_");
  }
  lines.push("");

  // 5. Testing & Verification
  groupNum++;
  lines.push(`## ${groupNum}. Testing & Verification`, "");
  let testNum = 0;
  for (const mod of modules) {
    testNum++;
    lines.push(`- [ ] ${groupNum}.${testNum} Unit tests for ${mod.name}`);
  }
  for (const iface of interfaces) {
    testNum++;
    lines.push(`- [ ] ${groupNum}.${testNum} Contract tests for ${iface.name}`);
  }
  for (const entity of entities) {
    testNum++;
    lines.push(`- [ ] ${groupNum}.${testNum} Model tests for ${entity.name}`);
  }
  for (const ep of apiEndpoints) {
    testNum++;
    lines.push(`- [ ] ${groupNum}.${testNum} API test for ${ep.method} ${ep.path}`);
  }
  if (testNum === 0) {
    lines.push("_No tests needed_");
  }
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// spec.md 生成 (OpenSpec WHEN/THEN 格式)
// ============================================================================

/**
 * 生成 OpenSpec 格式的 spec.md 功能规格文档
 * 使用 WHEN/THEN 场景格式，按功能分组
 */
export function generateSpecMarkdown(
  state: Pick<
    ArchitectureDesignGraphState,
    | "userFacingFeatures"
    | "internalFeatures"
    | "infrastructureDependencies"
    | "apiEndpoints"
    | "entities"
  >,
): string {
  const lines: string[] = [];
  const allFeatures = [
    ...(state.userFacingFeatures ?? []),
    ...(state.internalFeatures ?? []),
    ...(state.infrastructureDependencies ?? []),
  ];
  const apiEndpoints = state.apiEndpoints ?? [];
  const entities = state.entities ?? [];

  lines.push("## ADDED Requirements", "");

  for (const feature of allFeatures) {
    lines.push(`### Requirement: ${feature.name}`, "");
    lines.push(feature.description, "");

    // Generate scenarios from related API endpoints
    const relatedEndpoints = apiEndpoints.filter(
      (ep) =>
        ep.relatedEntities?.some(
          (e) => feature.id.includes(e) || feature.name.toLowerCase().includes(e.toLowerCase()),
        ) || feature.id === ep.ownerModule,
    );

    if (relatedEndpoints.length > 0) {
      for (const ep of relatedEndpoints) {
        lines.push(`#### Scenario: ${ep.method} ${ep.path}`, "");
        lines.push(`- **WHEN** a \`${ep.method}\` request is sent to \`${ep.path}\``);
        if (ep.requestBody) lines.push(`  with body: ${ep.requestBody}`);
        lines.push(`- **THEN** the system SHALL ${ep.description.toLowerCase()}`);
        if (ep.responseBody) lines.push(`  and return: ${ep.responseBody}`);
        lines.push("");
      }
    } else {
      // Generic scenario from feature description
      lines.push(`#### Scenario: ${feature.name} basic flow`, "");
      lines.push(
        `- **WHEN** the ${feature.type === "user_facing" ? "user" : "system"} triggers ${feature.name.toLowerCase()}`,
      );
      lines.push(`- **THEN** the system SHALL ${feature.description.toLowerCase()}`);
      lines.push("");
    }
  }

  // Entity-level requirements
  if (entities.length > 0) {
    lines.push("### Requirement: Data Integrity", "");
    lines.push("All data entities SHALL maintain referential integrity.", "");
    for (const entity of entities) {
      lines.push(`#### Scenario: ${entity.name} persistence`, "");
      lines.push(`- **WHEN** a ${entity.name} record is created or updated`);
      const requiredAttrs = entity.attributes?.filter((a) => a.required).map((a) => a.name) ?? [];
      if (requiredAttrs.length) {
        lines.push(
          `- **THEN** the system SHALL validate required fields: ${requiredAttrs.join(", ")}`,
        );
      } else {
        lines.push(`- **THEN** the system SHALL persist the record successfully`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
