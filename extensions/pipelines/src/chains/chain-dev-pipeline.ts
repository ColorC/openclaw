/**
 * Dev Pipeline — 三阶段开发管线
 *
 * 需求澄清 → 架构设计 → 编码
 *
 * 这是新版本的开发链路，替代 Chain A 中的 decompose → architecture → coder 流程：
 * 1. 需求澄清 (Requirement Clarification): Agent 循环收集需求信息，产出 OpenSpec proposal.md
 * 2. 架构设计 (Architecture Design): 多节点流水线，产出 OpenSpec design.md + tasks.md
 * 3. 编码 (Coder): 代码生成/修复，根据任务逐个执行
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { RequirementClarificationNodeDeps } from "../llm-nodes/requirement-clarification-nodes.js";
import type { PipelineAgentTool } from "../llm/agent-adapter.js";
import type { IncrementalDB } from "../pm/incremental-db.js";
import type { ArchitectureDesignNodeOverrides } from "../workflows/architecture-design.js";
import type { CoderNodeOverrides } from "../workflows/coder.js";
import type { ArchitectureSnapshot } from "../workflows/states.js";
import type { ChainContext } from "./chain-context.js";
import {
  createRequirementClarificationNode,
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignDomainsNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignDataModelNode,
  createDesignApiEndpointsNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createRefineDesignNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
  createRecursiveCoderNode,
  createHandleArgueNode,
  createLoadExistingContextNode,
  createAnalyzeChangeImpactNode,
  createDesignDeltaNode,
} from "../llm-nodes/index.js";
import {
  createPipelineWebSearchTool,
  createPipelineWebFetchTool,
} from "../llm/web-tools-adapter.js";
import { IncrementalDB as IncrementalDBClass } from "../pm/incremental-db.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createArchitectureDesignGraph } from "../workflows/architecture-design.js";
import { createCoderGraph } from "../workflows/coder.js";
import { createRequirementClarificationGraph } from "../workflows/requirement-clarification.js";

// ============================================================================
// State
// ============================================================================

export const DevPipelineAnnotation = Annotation.Root({
  // 输入
  userRequirement: Annotation<string>({ default: () => "" }),
  scenario: Annotation<"new_project" | "modify_existing">({ default: () => "new_project" }),
  projectPath: Annotation<string | undefined>({ default: () => undefined }),

  // 增量修改上下文
  projectId: Annotation<string | undefined>({ default: () => undefined }),
  changeRecordId: Annotation<number | undefined>({ default: () => undefined }),

  // Stage 1: Requirement Clarification 输出
  clarifiedRequirement: Annotation<string>({ default: () => "" }),
  proposalDocument: Annotation<string | undefined>({ default: () => undefined }),

  // Stage 2: Architecture Design 输出
  architectureModules: Annotation<Array<Record<string, unknown>>>({ default: () => [] }),
  architectureInterfaces: Annotation<Array<Record<string, unknown>>>({ default: () => [] }),
  designDocument: Annotation<string | undefined>({ default: () => undefined }),
  tasksDocument: Annotation<string | undefined>({ default: () => undefined }),

  // Stage 3: Coder 输出
  coderResults: Annotation<Array<{ taskId: string; success: boolean; qualityScore: number }>>({
    default: () => [],
  }),

  // 最终输出
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  summary: Annotation<string>({ default: () => "" }),
});

export type DevPipelineState = typeof DevPipelineAnnotation.State;

// ============================================================================
// Config
// ============================================================================

export interface DevPipelineConfig {
  /** 需求澄清配置 */
  clarification?: {
    /** 额外的 Agent 工具（如 web_search, web_fetch） */
    tools?: PipelineAgentTool[];
    /**
     * 启用交互模式：Agent 每轮回调 onClarificationTurn，获取用户输入
     * 默认 false（一次性模式：Agent 直接从需求文本生成文档）
     */
    interactive?: boolean;
    /**
     * 交互回调 — 每轮 Agent 输出后调用
     * @param response Agent 的回复文本
     * @param isComplete 是否已生成最终文档
     * @returns 用户的回复文本，返回 null 表示取消
     */
    onClarificationTurn?: (response: string, isComplete: boolean) => Promise<string | null>;
  };
  /** 架构设计节点覆写 */
  architectureOverrides?: ArchitectureDesignNodeOverrides;
  /** Coder 节点覆写 */
  coderOverrides?: CoderNodeOverrides;
  /** 增量模式数据库（modify_existing 场景必需） */
  db?: IncrementalDB;
}

/**
 * 从 ChainContext 生成 LLM 驱动的 DevPipelineConfig
 * @param ctx Chain context with model provider and prompt registry
 * @param db Optional incremental database for modify_existing scenario
 */
export function createLlmDevPipelineConfig(
  ctx: ChainContext,
  db?: IncrementalDB,
): DevPipelineConfig {
  if (!ctx.modelProvider || !ctx.promptRegistry) {
    return {};
  }

  const deps = { modelProvider: ctx.modelProvider, promptRegistry: ctx.promptRegistry };

  // Incremental nodes only created when db is available
  const incrementalDeps = db ? { ...deps, db } : undefined;

  return {
    architectureOverrides: {
      analyzeRequirement: createAnalyzeRequirementNode(deps),
      listFeatures: createListFeaturesNode(deps),
      selectPattern: createSelectPatternNode(deps),
      designDomains: createDesignDomainsNode(deps),
      designModules: createDesignModulesNode(deps),
      defineInterfaces: createDefineInterfacesNode(deps),
      designDataModel: createDesignDataModelNode(deps),
      designApiEndpoints: createDesignApiEndpointsNode(deps),
      designReview: createDesignReviewNode(deps),
      validateArchitecture: createValidateArchitectureNode(deps),
      refineDesign: createRefineDesignNode(deps),
      designFileStructure: createDesignFileStructureNode(deps),
      generateOpenspec: createGenerateOpenspecNode(deps),
      // Incremental nodes for modify_existing scenario
      ...(incrementalDeps && {
        loadExistingContext: createLoadExistingContextNode(incrementalDeps),
        analyzeChangeImpact: createAnalyzeChangeImpactNode(incrementalDeps),
        designDelta: createDesignDeltaNode(incrementalDeps),
      }),
    },
    coderOverrides: {
      recursiveCoder: createRecursiveCoderNode(deps),
      handleArgue: createHandleArgueNode(deps),
    },
    // Pass db through for nodes that need direct access
    ...(db && { db }),
  };
}

// ============================================================================
// Default Nodes
// ============================================================================

function createDefaultNodes(ctx: ChainContext, config: DevPipelineConfig) {
  return {
    // Stage 1: Requirement Clarification
    async clarifyRequirements(state: DevPipelineState): Promise<Partial<DevPipelineState>> {
      if (!ctx.modelProvider) {
        // 无 LLM 时直接透传
        return {
          clarifiedRequirement: state.userRequirement,
        };
      }

      // 获取 modelProvider 的 config（需要 apiKey 和 baseUrl）
      const modelProviderConfig = (ctx.modelProvider as any).config ?? {};
      const promptRegistry = ctx.promptRegistry ?? new PromptRegistry();

      // 增量模式：从数据库加载现有需求
      let existingRequirements = undefined;
      if (state.scenario === "modify_existing" && config.db && state.projectId) {
        const snapshot = config.db.getLatestSnapshot(state.projectId, "requirement");
        if (snapshot?.requirementSummary) {
          existingRequirements = snapshot.requirementSummary;
        }
      }

      const clarificationDeps: RequirementClarificationNodeDeps = {
        modelProviderConfig,
        promptRegistry,
        // Web tools: 优先使用显式传入的，否则自动从 OpenClaw 创建（需要 BRAVE_API_KEY 等环境变量）
        webSearchTool:
          config.clarification?.tools?.find((t) => t.name === "quick_web_search") ??
          createPipelineWebSearchTool() ??
          undefined,
        webFetchTool:
          config.clarification?.tools?.find((t) => t.name === "quick_web_fetch") ??
          createPipelineWebFetchTool() ??
          undefined,
        // 增量模式上下文
        existingRequirements,
        scenario: state.scenario,
      };

      const clarificationNode = createRequirementClarificationNode(clarificationDeps);
      const interactive = config.clarification?.interactive ?? false;
      const onTurn = config.clarification?.onClarificationTurn;

      if (interactive && onTurn) {
        // ── 交互模式：循环调用 graph，通过回调获取用户输入 ──
        const graph = createRequirementClarificationGraph({
          llmExecutor: clarificationNode,
        });

        let graphState: any = {
          messages: [{ content: state.userRequirement }],
          iteration: 0,
          completed: false,
          collectedInfoJson: "{}",
          conversationHistory: [],
        };

        const MAX_INTERACTIVE_TURNS = 50;

        for (let turn = 0; turn < MAX_INTERACTIVE_TURNS; turn++) {
          const result = await graph.invoke(graphState);

          const isComplete = result.completed || !!result.proposalDocument;
          const response = result.response ?? "";

          if (isComplete) {
            // 通知回调：交互完成，传递最终文档
            await onTurn(result.proposalDocument ?? response, true);
            return {
              clarifiedRequirement: result.proposalDocument ?? response,
              proposalDocument: result.proposalDocument,
            };
          }

          // 回调获取用户输入
          const userInput = await onTurn(response, false);
          if (userInput === null) {
            // 用户取消
            return {
              clarifiedRequirement: response || state.userRequirement,
              proposalDocument: result.proposalDocument,
            };
          }

          // 准备下一轮：注入用户回复，保留持久化状态
          graphState = {
            messages: [{ content: userInput }],
            iteration: result.iteration,
            completed: false,
            collectedInfoJson: result.collectedInfoJson ?? "{}",
            conversationHistory: result.conversationHistory ?? [],
          };
        }

        // 超过最大轮次
        return {
          clarifiedRequirement: state.userRequirement,
        };
      } else {
        // ── 一次性模式：单次调用，Agent 直接生成文档 ──
        const graph = createRequirementClarificationGraph({
          llmExecutor: clarificationNode,
        });

        const result = await graph.invoke({
          messages: [{ content: state.userRequirement }],
          iteration: 0,
          completed: false,
        });

        return {
          clarifiedRequirement: result.response ?? state.userRequirement,
          proposalDocument: result.proposalDocument ?? result.response,
        };
      }
    },

    // Stage 2: Architecture Design
    async designArchitecture(state: DevPipelineState): Promise<Partial<DevPipelineState>> {
      const requirement = state.clarifiedRequirement || state.userRequirement;

      const graph = createArchitectureDesignGraph(config.architectureOverrides);
      const result = await graph.invoke({
        requirement,
        scenario: state.scenario,
        projectPath: state.projectPath,
        // Incremental context for modify_existing scenario
        projectId: state.projectId,
        changeRecordId: state.changeRecordId,
      });

      if (result.error) {
        return { error: `Architecture design failed: ${result.error}` };
      }

      return {
        architectureModules: result.modules as unknown as Array<Record<string, unknown>>,
        architectureInterfaces: result.interfaces as unknown as Array<Record<string, unknown>>,
        designDocument: (result as any).openspecDocuments?.["design.md"],
        tasksDocument: (result as any).openspecDocuments?.["tasks.md"],
      };
    },

    // Stage 3: Coder
    async executeCoder(state: DevPipelineState): Promise<Partial<DevPipelineState>> {
      const modules = state.architectureModules ?? [];
      if (modules.length === 0) {
        return { coderResults: [] };
      }

      const results: Array<{ taskId: string; success: boolean; qualityScore: number }> = [];

      // Determine output directory for generated code
      const outputDir = state.projectPath ?? process.cwd();

      // Build full task description with design context so coder knows the full picture
      const designContext = state.designDocument
        ? `\n\n## Architecture Design Document\n\n${state.designDocument}`
        : "";
      const tasksContext = state.tasksDocument
        ? `\n\n## Implementation Tasks\n\n${state.tasksDocument}`
        : "";

      // Single coder invocation with full design context (not per-module)
      const modulesSummary = modules
        .map((mod: any) => `- ${mod.id}: ${mod.name} — ${mod.description}`)
        .join("\n");

      const fullTaskDescription = [
        `Implement the following project based on the architecture design.`,
        `\n## Modules to Implement\n\n${modulesSummary}`,
        designContext,
        tasksContext,
        `\n## Target Directory\n\nAll files must be created within: \`${outputDir}\``,
      ].join("\n");

      const graph = createCoderGraph(config.coderOverrides);
      const coderResult = await graph.invoke({
        taskDescription: fullTaskDescription,
        codeContext: {
          allowedDir: outputDir,
          requirements: state.clarifiedRequirement || state.userRequirement,
        },
      });

      results.push({
        taskId: "full-implementation",
        success: coderResult.success,
        qualityScore: coderResult.qualityScore,
      });

      return { coderResults: results };
    },

    // Finalize
    async finalize(state: DevPipelineState): Promise<Partial<DevPipelineState>> {
      const totalTasks = state.coderResults.length;
      const passedTasks = state.coderResults.filter((r) => r.success).length;
      const allPassed = totalTasks === 0 || passedTasks === totalTasks;

      const scenarioLabel = state.scenario === "modify_existing" ? "incremental" : "new project";

      // ── Auto-persist: save state to IncrementalDB ──
      if (config.db && state.projectPath) {
        try {
          const db = config.db;
          const project = db.getOrCreateProject(state.projectPath);
          const version = project.currentVersion;

          // Save requirement snapshot (proposal)
          if (state.proposalDocument || state.clarifiedRequirement) {
            const proposalContent = state.proposalDocument || state.clarifiedRequirement;
            db.createSnapshot({
              projectId: project.id,
              version,
              snapshotType: "requirement",
              contentHash: IncrementalDBClass.contentHash(proposalContent),
              requirementSummary: {
                coreProblem: state.userRequirement,
                features: [],
                techStack: {},
                totalRequirements: 1,
              },
            });
          }

          // Save architecture snapshot (design + modules + interfaces)
          if (state.designDocument && state.architectureModules.length > 0) {
            const archSnapshot: ArchitectureSnapshot = {
              modules: state.architectureModules as any[],
              interfaces: state.architectureInterfaces as any[],
              entities: [],
              apiEndpoints: [],
              domains: [],
            };
            db.createSnapshot({
              projectId: project.id,
              version,
              snapshotType: "architecture",
              contentHash: IncrementalDBClass.contentHash(state.designDocument),
              architectureJson: archSnapshot,
            });
          }

          // Update project version on successful coding
          if (allPassed && !state.error && state.coderResults.length > 0) {
            db.updateProjectVersion(project.id, version + 1);
            // Mark scenario as modify_existing for future runs
            if (state.scenario === "new_project") {
              db.updateProjectScenario(project.id, "modify_existing");
            }
          }

          // Update change record if incremental
          if (state.changeRecordId && allPassed) {
            db.updateChangeStatus(state.changeRecordId, "applied", version + 1);
          }
        } catch (err) {
          console.warn("[dev-pipeline] Failed to persist state to IncrementalDB:", err);
        }
      }

      return {
        success: !state.error && allPassed,
        summary: [
          `Scenario: ${scenarioLabel}`,
          `Requirement: ${state.clarifiedRequirement ? "clarified" : "raw"}`,
          state.proposalDocument ? "proposal.md generated" : "",
          state.designDocument ? "design.md generated" : "",
          state.tasksDocument ? "tasks.md generated" : "",
          `Architecture: ${state.architectureModules.length} modules, ${state.architectureInterfaces.length} interfaces`,
          `Coder: ${passedTasks}/${totalTasks} tasks passed`,
        ]
          .filter(Boolean)
          .join(" | "),
      };
    },
  };
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * 创建三阶段开发管线图
 */
export function createDevPipelineGraph(ctx: ChainContext, config: DevPipelineConfig = {}) {
  const nodes = createDefaultNodes(ctx, config);

  const workflow = new StateGraph(DevPipelineAnnotation)
    .addNode("clarify_requirements", nodes.clarifyRequirements)
    .addNode("design_architecture", nodes.designArchitecture)
    .addNode("execute_coder", nodes.executeCoder)
    .addNode("finalize", nodes.finalize)
    .addEdge(START, "clarify_requirements")
    .addEdge("clarify_requirements", "design_architecture")
    .addEdge("design_architecture", "execute_coder")
    .addEdge("execute_coder", "finalize")
    .addEdge("finalize", END);

  return workflow.compile();
}
