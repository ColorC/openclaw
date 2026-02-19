/**
 * Requirement Clarification LLM Nodes
 *
 * 用 OpenClaw Agent 框架（@mariozechner/pi-agent-core）实现需求澄清。
 * Agent 循环自动处理 LLM → Tool → LLM 的反复调用。
 *
 * 支持两种模式：
 * - 交互模式（默认）：Agent 提问 → 用户回答 → Agent 记录/提问 → ... → 生成文档
 * - 一次性模式：Agent 直接从需求文本生成文档，不提问
 *
 * 9 个工具:
 * - record_requirement: 记录需求信息
 * - record_tech_choice: 记录技术选型（单项）
 * - confirm_tech_choice: 确认完整技术栈（批量 + 模块缺口检测）
 * - read_context: 读取已收集信息
 * - generate_report: 生成阶段报告
 * - quick_web_search: Web 搜索（复用 OpenClaw）
 * - quick_web_fetch: 网页抓取（复用 OpenClaw）
 * - identify_innovation: 创新点识别
 * - generate_requirement_doc: 生成 OpenSpec 需求文档（proposal.md）
 */

import type { ModelProviderConfig } from "../llm/types.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { RequirementClarificationGraphState } from "../workflows/requirement-clarification.js";
import type { RequirementSnapshotSummary } from "../workflows/states.js";
// ============================================================================
// Deps
// ============================================================================
import { createAgentRunner, type PipelineAgentTool } from "../llm/agent-adapter.js";

export interface RequirementClarificationNodeDeps {
  modelProviderConfig: ModelProviderConfig;
  promptRegistry: PromptRegistry;
  /** 可选：外部提供的 web_search 工具 */
  webSearchTool?: PipelineAgentTool;
  /** 可选：外部提供的 web_fetch 工具 */
  webFetchTool?: PipelineAgentTool;
  /** 增量模式：现有需求摘要 */
  existingRequirements?: RequirementSnapshotSummary;
  /** 场景类型 */
  scenario?: "new_project" | "modify_existing";
}

// ============================================================================
// Collected Info Context (工具操作的共享状态，跨轮次持久化)
// ============================================================================

/** 单条需求记录 */
interface RequirementEntry {
  value: string;
  category: string;
}

/** 单项技术选型 */
interface TechChoiceEntry {
  choice: string;
  reason?: string;
}

/** 创新点分析 */
interface InnovationAnalysis {
  innovationPoints: Array<{ feature: string; reason: string; complexity: string }>;
  coveredRequirements: string[];
  uncoveredRequirements: string[];
}

/** 需求澄清过程中收集的所有信息 */
export interface CollectedInfo {
  requirements: Record<string, RequirementEntry>;
  techChoices: Record<string, TechChoiceEntry>;
  /** 结构化技术栈 {backend: ["FastAPI"], frontend: ["React"]} */
  techStack?: Record<string, string[]>;
  techConfirmed: boolean;
  innovations: string[];
  innovationAnalysis?: InnovationAnalysis;
  reportGenerated: boolean;
  requirementDocGenerated: boolean;
  requirementDocContent?: string;
  requirementDocFilePath?: string;
}

export function createCollectedInfo(): CollectedInfo {
  return {
    requirements: {},
    techChoices: {},
    techConfirmed: false,
    innovations: [],
    reportGenerated: false,
    requirementDocGenerated: false,
  };
}

/** 从 JSON 字符串反序列化 CollectedInfo */
export function deserializeCollectedInfo(json?: string): CollectedInfo {
  if (!json || json === "{}") return createCollectedInfo();
  try {
    const parsed = JSON.parse(json);
    return {
      ...createCollectedInfo(),
      ...parsed,
    };
  } catch {
    return createCollectedInfo();
  }
}

/** 格式化 CollectedInfo 为系统提示注入文本 */
export function formatCollectedInfo(info: CollectedInfo): string {
  const lines: string[] = [];

  if (Object.keys(info.requirements).length > 0) {
    lines.push("【已记录的需求信息】");
    lines.push("你已经记录了以下需求信息（请避免重复询问）：");
    for (const [key, entry] of Object.entries(info.requirements)) {
      const value = typeof entry === "string" ? entry : entry.value;
      lines.push(`- ${key}: ${value}`);
    }
    lines.push("");
  }

  if (Object.keys(info.techChoices).length > 0) {
    lines.push("【已记录的技术选型】");
    for (const [category, entry] of Object.entries(info.techChoices)) {
      const choice = typeof entry === "string" ? entry : entry.choice;
      lines.push(`- ${category}: ${choice}`);
    }
    if (info.techConfirmed) {
      lines.push("**状态**: ✅ 用户已确认");
    }
    lines.push("");
  }

  if (info.innovations.length > 0) {
    lines.push("【已识别的创新点】");
    for (const item of info.innovations) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (info.requirementDocGenerated) {
    lines.push("【文档状态】");
    lines.push("✅ OpenSpec 需求文档已生成");
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n") : "（尚未收集任何信息）";
}

/** 格式化现有需求上下文（增量模式注入） */
export function formatExistingRequirementsContext(existing?: RequirementSnapshotSummary): string {
  if (!existing) return "";

  const lines: string[] = ["【项目现有需求】", ""];

  if (existing.coreProblem) {
    lines.push(`核心问题: ${existing.coreProblem}`);
  }
  if (existing.targetUsers) {
    lines.push(`目标用户: ${existing.targetUsers}`);
  }

  if (existing.features?.length) {
    lines.push("", "现有功能:");
    for (const f of existing.features) {
      lines.push(`- ${f.name}: ${f.description}`);
    }
  }

  if (existing.techStack && Object.keys(existing.techStack).length > 0) {
    lines.push("", "现有技术栈:");
    for (const [module, techs] of Object.entries(existing.techStack)) {
      const techStr = Array.isArray(techs) ? techs.join(", ") : String(techs);
      lines.push(`- ${module}: ${techStr}`);
    }
  }

  lines.push("", `总需求数: ${existing.totalRequirements}`);

  return lines.join("\n");
}

// ============================================================================
// Summary Helpers
// ============================================================================

/** kebab-case 转换 */
function toKebabCase(s: string): string {
  return s
    .replace(/[\s_]+/g, "-")
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    .replace(/^-/, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** 构建文档摘要 */
function buildDocSummary(projectName: string, info: CollectedInfo): string {
  const lines: string[] = [`项目: ${projectName}`];
  if (info.requirements.core_problem)
    lines.push(`核心问题: ${info.requirements.core_problem.value}`);
  if (info.requirements.target_users)
    lines.push(`目标用户: ${info.requirements.target_users.value}`);
  const techEntries = Object.entries(info.techChoices);
  if (techEntries.length > 0) {
    const techStr = techEntries
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : v.choice}`)
      .join(", ");
    lines.push(`技术栈: ${techStr}`);
  }
  const reqCount = Object.keys(info.requirements).length;
  lines.push(`需求条目: ${reqCount} 项`);
  return lines.join("\n");
}

// ============================================================================
// 模块名称映射（中英文 → 标准化）
// ============================================================================

const MODULE_MAPPING: Record<string, string> = {
  后端框架: "backend",
  前端框架: "frontend",
  数据库: "database",
  AI框架: "ai",
  存储: "storage",
  backend: "backend",
  frontend: "frontend",
  database: "database",
  ai: "ai",
  storage: "storage",
  后端: "backend",
  前端: "frontend",
  数据存储: "storage",
};

/** 核心模块列表（用于缺口检测） */
const CORE_MODULES = ["backend", "frontend", "database", "ai", "storage"];

// ============================================================================
// OpenSpec Proposal 文档生成
// ============================================================================

function generateWhySection(info: CollectedInfo): string {
  const req = info.requirements;
  const get = (key: string) => {
    const entry = req[key];
    if (!entry) return "";
    return typeof entry === "string" ? entry : entry.value;
  };

  const coreProblem = get("core_problem") || get("background") || get("project_background");
  const targetUsers = get("target_users") || get("users");
  const projectGoals = get("project_goals") || get("project_goal") || get("goal");
  const useCase = get("use_case");
  const detailedBackground = get("detailed_background");
  const successCriteria = get("success_criteria");

  let content = "";

  if (targetUsers) {
    content += targetUsers;
    if (coreProblem) {
      content += `需要解决以下问题：${coreProblem}。`;
    } else {
      content += "需要一个更好的解决方案。";
    }
  } else if (coreProblem) {
    content += `需要解决以下问题：${coreProblem}。`;
  }

  if (projectGoals) content += `\n\n项目目标：${projectGoals}`;
  if (successCriteria) content += `\n\n成功标准：${successCriteria}`;
  if (useCase) content += `\n\n主要使用场景：${useCase}`;
  if (detailedBackground) content += `\n\n详细背景：${detailedBackground}`;

  return content || "待补充项目背景...";
}

function generateWhatChangesSection(info: CollectedInfo): string {
  const req = info.requirements;
  const get = (key: string) => {
    const entry = req[key];
    if (!entry) return "";
    return typeof entry === "string" ? entry : entry.value;
  };
  let content = "";

  // Core Features
  const metaKeys = [
    "core_problem",
    "target_users",
    "use_case",
    "project_goals",
    "success_criteria",
    "tech_preferences",
    "deployment_env",
    "data_scale",
    "detailed_background",
    "constraints",
    "budget_constraints",
    "timeline",
    "project_goal",
    "goal",
    "background",
    "project_background",
    "users",
    "project_scale",
    "integration_type",
    "entry_point",
    "edit_scope",
  ];

  const featureKeys = Object.keys(req).filter((k) => !metaKeys.includes(k));

  if (featureKeys.length > 0) {
    content += "### Core Features\n";
    for (const key of featureKeys) {
      const val = get(key);
      if (val) content += `- **${key}**: ${val}\n`;
    }
    content += "\n";
  }

  // Functional Requirements
  const useCase = get("use_case");
  const projectGoals = get("project_goals");
  if (useCase || projectGoals) {
    content += "### Functional Requirements\n";
    if (useCase) content += `- ${useCase}\n`;
    if (projectGoals) content += `- ${projectGoals}\n`;
    content += "\n";
  }

  // Features to Implement (from innovation analysis)
  const uncovered = info.innovationAnalysis?.uncoveredRequirements ?? [];
  if (uncovered.length > 0) {
    content += "### Features to Implement\n";
    for (const feature of uncovered) {
      content += `- ${feature}\n`;
    }
    content += "\n";
  }

  // Technology Stack
  content += "### Technology Stack\n";
  if (info.techStack && Object.keys(info.techStack).length > 0) {
    for (const [module, techs] of Object.entries(info.techStack)) {
      const techStr = Array.isArray(techs) ? techs.join(", ") : String(techs);
      content += `- **${module.toUpperCase()}**: ${techStr}\n`;
    }
  } else if (Object.keys(info.techChoices).length > 0) {
    for (const [category, entry] of Object.entries(info.techChoices)) {
      const choice = typeof entry === "string" ? entry : entry.choice;
      content += `- **${category.toUpperCase()}**: ${choice}\n`;
    }
  } else {
    content += "- 待确认\n";
  }
  content += "\n";

  // Deployment & Integration
  const deploymentEnv = get("deployment_env");
  const techPreferences = get("tech_preferences");
  if (deploymentEnv || techPreferences) {
    content += "### Deployment & Integration\n";
    if (techPreferences) content += `- 技术形式：${techPreferences}\n`;
    if (deploymentEnv) content += `- 部署环境：${deploymentEnv}\n`;
    content += "\n";
  }

  return content;
}

function generateCapabilitiesSection(info: CollectedInfo): string {
  const req = info.requirements;
  const get = (key: string) => {
    const entry = req[key];
    if (!entry) return "";
    return typeof entry === "string" ? entry : entry.value;
  };

  let content = "";

  // Integration Context (OpenClaw Extension 特有)
  const integrationType = get("integration_type");
  const entryPoint = get("entry_point");
  const editScope = get("edit_scope");
  if (integrationType || entryPoint || editScope) {
    content += "### Integration Context\n";
    if (integrationType) content += `- **Integration Type**: ${integrationType}\n`;
    if (entryPoint) content += `- **Entry Point**: ${entryPoint}\n`;
    if (editScope) content += `- **Edit Scope**: ${editScope}\n`;
    content += "\n";
  }

  content += "### New Capabilities\n";

  // 从 requirements 中提取功能点，生成 kebab-case 名称
  const metaKeys = [
    "core_problem",
    "target_users",
    "use_case",
    "project_goals",
    "success_criteria",
    "tech_preferences",
    "deployment_env",
    "data_scale",
    "detailed_background",
    "constraints",
    "budget_constraints",
    "timeline",
    "project_goal",
    "goal",
    "background",
    "project_background",
    "users",
    "project_scale",
    "integration_type",
    "entry_point",
    "edit_scope",
  ];

  const featureKeys = Object.keys(req).filter((k) => !metaKeys.includes(k));

  if (featureKeys.length > 0) {
    for (const key of featureKeys) {
      const kebab = key.replace(/[_\s]+/g, "-").toLowerCase();
      const val = get(key);
      if (val) content += `- \`${kebab}\`: ${val}\n`;
    }
  } else {
    // 从 use_case 或 core_problem 提取
    const useCase = get("use_case");
    const coreProblem = get("core_problem");
    const mainFeature = useCase || coreProblem;
    if (mainFeature) {
      const kebab = mainFeature
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
        .toLowerCase();
      content += `- \`${kebab}\`: ${mainFeature}\n`;
    }
  }
  content += "\n";

  content += "### Modified Capabilities\n";
  content += "<!-- No modifications for greenfield project -->\n";
  content += "\n";

  return content;
}

function generateImpactSection(info: CollectedInfo): string {
  let content = "";

  content += "- **Affected specs**: 新建项目（无现有 specs）\n";
  content += "- **Affected code**: 新建项目（greenfield）\n";

  // Project Structure — 从技术栈推断
  content += "- **Project Structure**:\n";
  const techStack = info.techStack ?? {};
  if (Object.keys(techStack).length > 0) {
    const frontend = techStack.frontend ?? techStack["前端"];
    const backend = techStack.backend ?? techStack["后端"];
    if (frontend) {
      content += `  - Frontend：${Array.isArray(frontend) ? frontend.join(", ") : frontend}\n`;
    }
    if (backend) {
      content += `  - Backend：${Array.isArray(backend) ? backend.join(", ") : backend}\n`;
    }
  }
  content += "  - 配置：应用配置、环境变量\n";
  content += "  - 文档：API 文档、用户手册、部署指南\n";
  content += "\n";

  // External Dependencies
  content += "**External Dependencies**\n";
  const aiModule = techStack.ai ?? techStack["AI框架"];
  const storage = techStack.storage ?? techStack["数据存储"];
  if (aiModule) {
    const aiStr = Array.isArray(aiModule) ? aiModule.join(", ") : String(aiModule);
    content += `- **AI/LLM**: ${aiStr}\n`;
  }
  if (storage) {
    const storageStr = Array.isArray(storage) ? storage.join(", ") : String(storage);
    content += `- **Storage**: ${storageStr}\n`;
  }
  content += "\n";

  // Implementation Notes — 从创新点分析
  const innovationPoints = info.innovationAnalysis?.innovationPoints ?? [];
  if (innovationPoints.length > 0) {
    content += "**Implementation Notes**\n";
    content += `- 总共 ${innovationPoints.length} 个功能点需要实现\n`;

    const complexityCounts: Record<string, number> = {};
    for (const point of innovationPoints) {
      complexityCounts[point.complexity] = (complexityCounts[point.complexity] ?? 0) + 1;
    }
    if (Object.keys(complexityCounts).length > 0) {
      content += "- 复杂度分布：\n";
      for (const [comp, count] of Object.entries(complexityCounts)) {
        content += `  - ${comp}: ${count} 个功能点\n`;
      }
    }
    content += "\n";
  }

  return content;
}

export function generateOpenSpecProposal(projectName: string, info: CollectedInfo): string {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  const lines: string[] = [
    `# ${projectName}`,
    "",
    `**Generated**: ${timestamp}`,
    "**Format**: OpenSpec v1.0 Proposal",
    "**Type**: Greenfield Project (新应用)",
    "",
    "---",
    "",
    "## Why",
    "",
    generateWhySection(info),
    "",
    "## What Changes",
    "",
    generateWhatChangesSection(info),
    "## Capabilities",
    "",
    generateCapabilitiesSection(info),
    "## Impact",
    "",
    generateImpactSection(info),
    "---",
    "",
    "**Next Steps**: Use this proposal to generate tasks and implementation specs with AI assistance.",
    "",
  ];

  return lines.join("\n");
}

// ============================================================================
// Incremental Mode Proposal Generator
// ============================================================================

/**
 * 生成增量修改模式的 OpenSpec Change Proposal
 *
 * 与 Greenfield 版本的区别：
 * - Type: Incremental Change (not Greenfield Project)
 * - Modified Capabilities: 有内容（列出修改的功能）
 * - Impact: 指明受影响的 specs 和代码
 */
export function generateOpenSpecChangeProposal(
  projectName: string,
  info: CollectedInfo,
  existingRequirements?: RequirementSnapshotSummary,
): string {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  const lines: string[] = [
    `# ${projectName} — Incremental Change`,
    "",
    `**Generated**: ${timestamp}`,
    "**Format**: OpenSpec v1.0 Proposal",
    "**Type**: Incremental Change (增量修改)",
    "",
    "---",
    "",
    "## Why",
    "",
    generateWhySection(info),
    "",
    "## What Changes",
    "",
    generateWhatChangesSection(info),
    "## Capabilities",
    "",
    generateCapabilitiesSectionIncremental(info, existingRequirements),
    "## Impact",
    "",
    generateImpactSectionIncremental(info, existingRequirements),
    "---",
    "",
    "**Next Steps**: Review the modified capabilities and proceed to architecture design for impact analysis.",
    "",
  ];

  return lines.join("\n");
}

function generateCapabilitiesSectionIncremental(
  info: CollectedInfo,
  existing?: RequirementSnapshotSummary,
): string {
  const req = info.requirements;
  const get = (key: string) => {
    const entry = req[key];
    if (!entry) return "";
    return typeof entry === "string" ? entry : entry.value;
  };

  let content = "";

  // New Capabilities (same as greenfield)
  const metaKeys = [
    "core_problem",
    "target_users",
    "use_case",
    "project_goals",
    "success_criteria",
    "tech_preferences",
    "deployment_env",
    "data_scale",
    "detailed_background",
    "constraints",
    "budget_constraints",
    "timeline",
    "project_goal",
    "goal",
    "background",
    "project_background",
    "users",
    "project_scale",
    "integration_type",
    "entry_point",
    "edit_scope",
  ];

  const featureKeys = Object.keys(req).filter((k) => !metaKeys.includes(k));

  if (featureKeys.length > 0) {
    content += "### New Capabilities\n";
    for (const key of featureKeys) {
      const kebab = key.replace(/[_\s]+/g, "-").toLowerCase();
      const val = get(key);
      if (val) content += `- \`${kebab}\`: ${val}\n`;
    }
    content += "\n";
  }

  // Modified Capabilities (reference existing features)
  content += "### Modified Capabilities\n";
  if (existing?.features?.length) {
    // Agent should specify which existing features are being modified
    const changeDesc = get("change_description") || get("modification_scope");
    if (changeDesc) {
      content += `本次变更影响以下现有功能：\n\n`;
      for (const f of existing.features) {
        content += `- \`${f.name}\`: ${f.description}\n`;
      }
      content += `\n变更描述：${changeDesc}\n`;
    } else {
      content += `项目现有 ${existing.features.length} 个功能（参考现有需求文档）。\n`;
      content += `本次变更的具体影响将在架构设计阶段分析。\n`;
    }
  } else {
    content += "<!-- 待架构设计阶段确定受影响的现有功能 -->\n";
  }
  content += "\n";

  return content;
}

function generateImpactSectionIncremental(
  info: CollectedInfo,
  existing?: RequirementSnapshotSummary,
): string {
  const req = info.requirements;
  const get = (key: string) => {
    const entry = req[key];
    if (!entry) return "";
    return typeof entry === "string" ? entry : entry.value;
  };

  let content = "";

  // Affected specs
  content += "- **Affected specs**: 现有项目的 OpenSpec 文档\n";
  if (existing?.features?.length) {
    content += `  - 现有功能: ${existing.features.length} 个\n`;
  }
  content += "\n";

  // Affected code
  content += "- **Affected code**: 现有代码库\n";
  content += "  - 具体影响的模块将在架构设计阶段确定\n";
  content += "\n";

  // Project Structure — 从技术栈推断
  content += "- **Project Structure**:\n";
  const techStack = info.techStack ?? existing?.techStack ?? {};
  if (Object.keys(techStack).length > 0) {
    const frontend = techStack.frontend ?? techStack["前端"];
    const backend = techStack.backend ?? techStack["后端"];
    if (frontend) {
      content += `  - Frontend：${Array.isArray(frontend) ? frontend.join(", ") : frontend}\n`;
    }
    if (backend) {
      content += `  - Backend：${Array.isArray(backend) ? backend.join(", ") : backend}\n`;
    }
  }
  content += "\n";

  // External Dependencies
  const aiModule = techStack.ai ?? techStack["AI框架"];
  const storage = techStack.storage ?? techStack["数据存储"];
  if (aiModule || storage) {
    content += "**External Dependencies**\n";
    if (aiModule) {
      const aiStr = Array.isArray(aiModule) ? aiModule.join(", ") : String(aiModule);
      content += `- **AI/LLM**: ${aiStr}\n`;
    }
    if (storage) {
      const storageStr = Array.isArray(storage) ? storage.join(", ") : String(storage);
      content += `- **Storage**: ${storageStr}\n`;
    }
    content += "\n";
  }

  // Implementation Notes for incremental change
  const changeDesc = get("change_description") || get("modification_scope");
  if (changeDesc) {
    content += "**Implementation Notes**\n";
    content += `- 变更范围：${changeDesc}\n`;
    content += "- 建议先进行架构影响分析，确定受影响的模块和接口\n";
    content += "\n";
  }

  return content;
}

// ============================================================================
// 内置工具定义
// ============================================================================

export function createBuiltinTools(info: CollectedInfo): PipelineAgentTool[] {
  return [
    // 1. record_requirement
    {
      name: "record_requirement",
      description: "记录一条已确认的需求信息（key-value）。提取到信息后必须立即调用。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "需求键名（如 target_users, core_problem, use_case, project_goals, success_criteria, detailed_background, constraints, deployment_env, tech_preferences, data_scale, project_scale, integration_type, entry_point, edit_scope）",
          },
          value: { type: "string", description: "需求值" },
          category: {
            type: "string",
            description: "分类",
            enum: ["basic", "goals", "background", "tech", "detail", "integration"],
          },
        },
        required: ["key", "value"],
      },
      execute: async (args) => {
        const key = args.key as string;
        const value = args.value as string;
        const category = (args.category as string) ?? "basic";
        info.requirements[key] = { value, category };
        return {
          saved: true,
          key,
          value,
          totalRequirements: Object.keys(info.requirements).length,
        };
      },
    },

    // 2. record_tech_choice
    {
      name: "record_tech_choice",
      description: "记录单项技术选型",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "技术类别（如 backend, frontend, database, ai, storage）",
          },
          choice: { type: "string", description: "选择的技术" },
          reason: { type: "string", description: "选择理由" },
        },
        required: ["category", "choice"],
      },
      execute: async (args) => {
        const rawCategory = args.category as string;
        const category = MODULE_MAPPING[rawCategory] ?? rawCategory.toLowerCase();
        const choice = args.choice as string;
        const reason = args.reason as string | undefined;
        info.techChoices[category] = { choice, reason };
        return {
          saved: true,
          category,
          choice,
          reason,
          totalChoices: Object.keys(info.techChoices).length,
        };
      },
    },

    // 3. confirm_tech_choice — 确认完整技术栈 + 模块缺口检测
    {
      name: "confirm_tech_choice",
      description:
        "确认并最终确定完整技术栈。返回已确认的模块和缺失的核心模块（backend/frontend/database/ai/storage）。在调研后或用户确认技术栈时使用。",
      parameters: {
        type: "object",
        properties: {
          tech_stack: {
            type: "object",
            description:
              '完整技术栈字典，例如 {"backend": ["FastAPI"], "frontend": ["React"], "database": ["PostgreSQL"]}',
          },
          reason: { type: "string", description: "整体选型理由" },
        },
        required: ["tech_stack", "reason"],
      },
      execute: async (args) => {
        const stack = args.tech_stack as Record<string, string[]>;
        const reason = args.reason as string;

        // 存储结构化技术栈
        info.techStack = stack;
        info.techConfirmed = true;

        // 同步到 techChoices
        for (const [module, techs] of Object.entries(stack)) {
          const normalized = MODULE_MAPPING[module] ?? module.toLowerCase();
          info.techChoices[normalized] = {
            choice: Array.isArray(techs) ? techs.join(", ") : String(techs),
            reason,
          };
        }

        // 模块缺口检测
        const confirmedModules = Object.keys(stack).map(
          (m) => MODULE_MAPPING[m] ?? m.toLowerCase(),
        );
        const missingModules = CORE_MODULES.filter((m) => !confirmedModules.includes(m));

        return {
          saved: true,
          tech_stack: stack,
          confirmed_modules: confirmedModules,
          missing_modules: missingModules,
          all_covered: missingModules.length === 0,
          reason,
        };
      },
    },

    // 4. read_context
    {
      name: "read_context",
      description: "读取已收集的需求上下文信息",
      parameters: {
        type: "object",
        properties: {
          contextType: {
            type: "string",
            enum: ["requirements", "tech_choices", "innovations", "all"],
            description: "要读取的上下文类型",
          },
        },
        required: ["contextType"],
      },
      execute: async (args) => {
        const type = args.contextType as string;
        if (type === "requirements") return info.requirements;
        if (type === "tech_choices")
          return {
            techChoices: info.techChoices,
            techStack: info.techStack,
            techConfirmed: info.techConfirmed,
          };
        if (type === "innovations")
          return { innovations: info.innovations, analysis: info.innovationAnalysis };
        return {
          requirements: info.requirements,
          techChoices: info.techChoices,
          techStack: info.techStack,
          techConfirmed: info.techConfirmed,
          innovations: info.innovations,
          innovationAnalysis: info.innovationAnalysis,
        };
      },
    },

    // 5. generate_report
    {
      name: "generate_report",
      description: "生成当前收集信息的汇总报告",
      parameters: {
        type: "object",
        properties: {
          reportType: { type: "string", enum: ["full", "summary"], description: "报告类型" },
        },
        required: ["reportType"],
      },
      execute: async () => {
        info.reportGenerated = true;
        const lines: string[] = [
          "# Requirement Clarification Report",
          "",
          "## Requirements",
          ...Object.entries(info.requirements).map(([k, v]) => {
            const val = typeof v === "string" ? v : v.value;
            return `- **${k}**: ${val}`;
          }),
          "",
          "## Technology Choices",
          ...Object.entries(info.techChoices).map(([k, v]) => {
            const choice = typeof v === "string" ? v : v.choice;
            return `- **${k}**: ${choice}`;
          }),
        ];
        if (info.innovations.length > 0) {
          lines.push("", "## Innovation Points");
          for (const item of info.innovations) {
            lines.push(`- ${item}`);
          }
        }
        return { report: lines.join("\n") };
      },
    },

    // 6. identify_innovation
    {
      name: "identify_innovation",
      description: "识别现有解决方案未覆盖的创新点。在调研完成后，分析用户需求与现有方案的差距。",
      parameters: {
        type: "object",
        properties: {
          userRequirements: {
            type: "array",
            items: { type: "string" },
            description: "用户需求列表",
          },
          existingProjects: {
            type: "array",
            items: { type: "string" },
            description: "已有项目名称列表",
          },
        },
        required: ["userRequirements"],
      },
      execute: async (args) => {
        const reqs = args.userRequirements as string[];
        const existing = (args.existingProjects as string[]) ?? [];

        // 分析覆盖度
        const covered: string[] = [];
        const uncovered: string[] = [];
        for (const req of reqs) {
          const isCovered = existing.some((e) => req.toLowerCase().includes(e.toLowerCase()));
          if (isCovered) {
            covered.push(req);
          } else {
            uncovered.push(req);
          }
        }

        const innovationPoints = uncovered.map((r) => ({
          feature: r,
          reason: "现有方案未覆盖",
          complexity: "medium",
        }));

        info.innovations.push(...uncovered);
        info.innovationAnalysis = {
          innovationPoints,
          coveredRequirements: covered,
          uncoveredRequirements: uncovered,
        };

        return {
          totalRequirements: reqs.length,
          coveredByExisting: covered.length,
          innovationPoints: uncovered,
          analysis: info.innovationAnalysis,
        };
      },
    },

    // 7. generate_requirement_doc — 核心产出：OpenSpec v1.0 Proposal
    {
      name: "generate_requirement_doc",
      description: [
        "生成 OpenSpec v1.0 格式的需求文档（proposal.md）。这是需求澄清阶段的**核心产出**。",
        "",
        "使用场景：",
        "- 技术选型确认后",
        "- 主要需求信息明确后",
        "- 用户主动要求生成文档时",
        "",
        "文档包含 Why / What Changes / Capabilities / Impact 四大部分。",
      ].join("\n"),
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "项目名称" },
        },
        required: ["projectName"],
      },
      execute: async (args) => {
        const projectName = args.projectName as string;
        const content = generateOpenSpecProposal(projectName, info);
        const filePath = `docs/proposals/${toKebabCase(projectName)}-proposal.md`;

        info.requirementDocGenerated = true;
        info.requirementDocContent = content;
        info.requirementDocFilePath = filePath;

        return {
          generated: true,
          content,
          projectName,
          sections: ["Why", "What Changes", "Capabilities", "Impact"],
          size: content.length,
          summary: buildDocSummary(projectName, info),
          filePath,
        };
      },
    },
  ];
}

// ============================================================================
// Node Factory
// ============================================================================

/**
 * 创建需求澄清 Agent 节点
 *
 * 使用 @mariozechner/pi-agent-core 的 agentLoop 实现完整的
 * LLM → 工具 → LLM 循环。
 *
 * 支持多轮交互：
 * - collectedInfo 通过 state.collectedInfoJson 跨轮次持久化
 * - 对话历史通过 state.conversationHistory 积累
 * - 每次调用处理一轮用户交互
 */
export function createRequirementClarificationNode(deps: RequirementClarificationNodeDeps) {
  return async (
    state: RequirementClarificationGraphState,
  ): Promise<Partial<RequirementClarificationGraphState>> => {
    const { modelProviderConfig, promptRegistry } = deps;
    const runner = createAgentRunner(modelProviderConfig);

    // 1. 恢复 CollectedInfo（从 state 持久化数据，而非每次重建）
    const collectedInfo = deserializeCollectedInfo(state.collectedInfoJson);

    // 2. 构建工具列表（闭包引用 collectedInfo，工具执行时直接修改）
    const tools: PipelineAgentTool[] = [...createBuiltinTools(collectedInfo)];
    // 注入外部工具（web_search, web_fetch）
    if (deps.webSearchTool) tools.push(deps.webSearchTool);
    if (deps.webFetchTool) tools.push(deps.webFetchTool);

    // 3. 构建系统提示（注入当前已收集信息）
    const collectedInfoText = formatCollectedInfo(collectedInfo);
    const systemPrompt = promptRegistry.render("requirement-clarification/system-prompt", {
      collected_info: collectedInfoText,
    });

    // 4. 提取最新用户消息
    const lastMessage = state.messages?.length ? state.messages[state.messages.length - 1] : null;
    const rawMessage = lastMessage
      ? typeof lastMessage === "string"
        ? lastMessage
        : ((lastMessage as { content?: string }).content ?? "")
      : "";

    // 用户消息直接传递（不再注入自主模式指令）
    const userMessage = rawMessage || "Please start the requirement clarification process.";

    // 5. 获取对话历史（支持多轮交互）
    const conversationHistory = state.conversationHistory;

    // 6. 执行 agent 循环
    const result = await runner.run(systemPrompt, userMessage, tools, {
      temperature: 0.3,
      history: conversationHistory?.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
    });

    // 7. 更新对话历史
    const updatedHistory = [
      ...(conversationHistory ?? []),
      { role: "user", content: userMessage },
      { role: "assistant", content: result.finalResponse },
    ];

    // 8. 返回更新后的状态
    return {
      response: collectedInfo.requirementDocContent ?? result.finalResponse,
      completed: collectedInfo.requirementDocGenerated,
      iteration: state.iteration + 1,
      collectedInfoJson: JSON.stringify(collectedInfo),
      conversationHistory: updatedHistory,
      proposalDocument: collectedInfo.requirementDocContent,
      proposalFilePath: collectedInfo.requirementDocFilePath,
    };
  };
}
