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
import type { ArchitectureDesignNodeOverrides } from "../workflows/architecture-design.js";
import type { CoderNodeOverrides } from "../workflows/coder.js";
import type { ChainContext } from "./chain-context.js";
import {
  createRequirementClarificationNode,
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
  createRecursiveCoderNode,
  createHandleArgueNode,
} from "../llm-nodes/index.js";
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
}

/**
 * 从 ChainContext 生成 LLM 驱动的 DevPipelineConfig
 */
export function createLlmDevPipelineConfig(ctx: ChainContext): DevPipelineConfig {
  if (!ctx.modelProvider || !ctx.promptRegistry) {
    return {};
  }

  const deps = { modelProvider: ctx.modelProvider, promptRegistry: ctx.promptRegistry };

  return {
    architectureOverrides: {
      analyzeRequirement: createAnalyzeRequirementNode(deps),
      listFeatures: createListFeaturesNode(deps),
      selectPattern: createSelectPatternNode(deps),
      designModules: createDesignModulesNode(deps),
      defineInterfaces: createDefineInterfacesNode(deps),
      designReview: createDesignReviewNode(deps),
      validateArchitecture: createValidateArchitectureNode(deps),
      designFileStructure: createDesignFileStructureNode(deps),
      generateOpenspec: createGenerateOpenspecNode(deps),
    },
    coderOverrides: {
      recursiveCoder: createRecursiveCoderNode(deps),
      handleArgue: createHandleArgueNode(deps),
    },
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

      const clarificationDeps: RequirementClarificationNodeDeps = {
        modelProviderConfig,
        promptRegistry,
        ...(config.clarification?.tools?.find((t) => t.name === "quick_web_search")
          ? { webSearchTool: config.clarification.tools.find((t) => t.name === "quick_web_search") }
          : {}),
        ...(config.clarification?.tools?.find((t) => t.name === "quick_web_fetch")
          ? { webFetchTool: config.clarification.tools.find((t) => t.name === "quick_web_fetch") }
          : {}),
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

      for (const mod of modules) {
        const taskId = (mod as any).id ?? `task-${Date.now()}`;
        const description = (mod as any).description ?? JSON.stringify(mod);

        const graph = createCoderGraph(config.coderOverrides);
        const coderResult = await graph.invoke({
          taskDescription: description,
          codeContext: {},
        });

        results.push({
          taskId,
          success: coderResult.success,
          qualityScore: coderResult.qualityScore,
        });
      }

      return { coderResults: results };
    },

    // Finalize
    async finalize(state: DevPipelineState): Promise<Partial<DevPipelineState>> {
      const totalTasks = state.coderResults.length;
      const passedTasks = state.coderResults.filter((r) => r.success).length;
      const allPassed = totalTasks === 0 || passedTasks === totalTasks;

      return {
        success: !state.error && allPassed,
        summary: [
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
