/**
 * Chain A — 开发链路
 *
 * 需求描述 → 分解 → PM 导入 → 架构设计 → 任务生成 → Coder 执行
 * → 质量门禁 → 合规检查 → KPI 采集 → 完成
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { ComplianceReport } from "../compliance/compliance-checker.js";
import type { ReqDecompNodeOverrides } from "../maintenance/requirement-decomposition.js";
import type { RequirementData } from "../pm/database.js";
import type { QualityResult } from "../pm/quality-gate.js";
import type { ArchitectureDesignNodeOverrides } from "../workflows/architecture-design.js";
import type { CoderNodeOverrides } from "../workflows/coder.js";
import type { ChainContext } from "./chain-context.js";
import { publishArchitectureTasks } from "../adapters/architecture-to-tasks.js";
import { updateRequirementFromCoder } from "../adapters/coder-to-quality.js";
import { importDecompositionResults } from "../adapters/decomposition-to-pm.js";
import { decompositionToArchitectureInput } from "../adapters/requirement-to-architecture.js";
import {
  createDecomposeNode,
  createInvestScoringNode,
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
import { createRequirementDecompositionGraph } from "../maintenance/requirement-decomposition.js";
import { createArchitectureDesignGraph } from "../workflows/architecture-design.js";
import { createCoderGraph } from "../workflows/coder.js";
import { withStepHook, type StepHookConfig } from "./step-hook.js";

// ============================================================================
// State
// ============================================================================

export const ChainAAnnotation = Annotation.Root({
  // 输入
  requirementDescription: Annotation<string>({ default: () => "" }),
  projectId: Annotation<string | undefined>({ default: () => undefined }),
  scenario: Annotation<"new_project" | "modify_existing">({ default: () => "new_project" }),
  projectPath: Annotation<string | undefined>({ default: () => undefined }),
  // 中间
  parentRequirementId: Annotation<string | undefined>({ default: () => undefined }),
  decomposedRequirements: Annotation<RequirementData[]>({ default: () => [] }),
  architectureModules: Annotation<Array<Record<string, unknown>>>({ default: () => [] }),
  architectureInterfaces: Annotation<Array<Record<string, unknown>>>({ default: () => [] }),
  publishedTasks: Annotation<RequirementData[]>({ default: () => [] }),
  coderResults: Annotation<Array<{ taskId: string; success: boolean; qualityScore: number }>>({
    default: () => [],
  }),
  qualityResults: Annotation<Array<{ taskId: string; result: QualityResult }>>({
    default: () => [],
  }),
  complianceReport: Annotation<ComplianceReport | undefined>({ default: () => undefined }),
  // 输出
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  summary: Annotation<string>({ default: () => "" }),
});

export type ChainAState = typeof ChainAAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

export type ChainANodeExecutor = (state: ChainAState) => Promise<Partial<ChainAState>>;

export interface ChainAConfig {
  decompOverrides?: ReqDecompNodeOverrides;
  architectureOverrides?: ArchitectureDesignNodeOverrides;
  coderOverrides?: CoderNodeOverrides;
}

/**
 * 从 ChainContext 生成 LLM 驱动的 ChainAConfig
 *
 * 如果 ctx 提供了 modelProvider 和 promptRegistry，则使用 LLM 节点；
 * 否则返回空 config，使用默认 stub 节点。
 */
export function createLlmChainAConfig(ctx: ChainContext): ChainAConfig {
  if (!ctx.modelProvider || !ctx.promptRegistry) {
    return {};
  }

  const deps = { modelProvider: ctx.modelProvider, promptRegistry: ctx.promptRegistry };

  return {
    decompOverrides: {
      decompose: createDecomposeNode(deps),
      investScoring: createInvestScoringNode(deps),
    },
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

function createDefaultNodes(ctx: ChainContext, config: ChainAConfig = {}) {
  return {
    async decompose(state: ChainAState): Promise<Partial<ChainAState>> {
      const graph = createRequirementDecompositionGraph(config.decompOverrides);
      const result = await graph.invoke({
        requirementDescription: state.requirementDescription,
      });
      if (result.error) return { error: result.error };

      // 创建父需求
      const parent = ctx.db.createRequirement({
        id: `req-${Date.now()}`,
        description: state.requirementDescription,
        projectId: state.projectId,
      });

      // 导入子需求
      const imported = importDecompositionResults(
        ctx.db,
        result.subRequirements,
        result.investScores,
        parent.id,
        state.projectId,
      );

      return {
        parentRequirementId: parent.id,
        decomposedRequirements: imported,
      };
    },

    async designArchitecture(state: ChainAState): Promise<Partial<ChainAState>> {
      const archInput = decompositionToArchitectureInput(
        {
          requirementDescription: state.requirementDescription,
          requirementTree: {
            root: state.requirementDescription,
            children: state.decomposedRequirements,
          },
          subRequirements: state.decomposedRequirements.map((r) => ({
            id: r.id,
            description: r.description,
            category: r.category ?? "general",
          })),
        },
        state.scenario,
        state.projectPath,
      );
      const graph = createArchitectureDesignGraph(config.architectureOverrides);
      const result = await graph.invoke(archInput);
      if (result.error) return { error: result.error };

      return {
        architectureModules: result.modules as unknown as Array<Record<string, unknown>>,
        architectureInterfaces: result.interfaces as unknown as Array<Record<string, unknown>>,
      };
    },

    async generateTasks(state: ChainAState): Promise<Partial<ChainAState>> {
      const published = publishArchitectureTasks(
        ctx.queue,
        state.architectureModules as never[],
        state.architectureInterfaces as never[],
        {
          requirementId: state.parentRequirementId ?? "",
          projectId: state.projectId,
        },
      );
      return { publishedTasks: published };
    },

    async executeCoder(state: ChainAState): Promise<Partial<ChainAState>> {
      const results: Array<{ taskId: string; success: boolean; qualityScore: number }> = [];
      for (const task of state.publishedTasks) {
        const graph = createCoderGraph(config.coderOverrides);
        const coderResult = await graph.invoke({
          taskDescription: task.description,
          codeContext: {},
        });
        results.push({
          taskId: task.id,
          success: coderResult.success,
          qualityScore: coderResult.qualityScore,
        });
        updateRequirementFromCoder(ctx.db, task.id, coderResult);
      }
      return { coderResults: results };
    },

    async evaluateQuality(state: ChainAState): Promise<Partial<ChainAState>> {
      const results: Array<{ taskId: string; result: QualityResult }> = [];
      for (const task of state.publishedTasks) {
        const result = ctx.qualityGate.evaluate(task.id);
        results.push({ taskId: task.id, result });
      }
      return { qualityResults: results };
    },

    async checkCompliance(state: ChainAState): Promise<Partial<ChainAState>> {
      const report = ctx.compliance.run({ checkType: "all" });
      return { complianceReport: report };
    },

    async collectKpi(state: ChainAState): Promise<Partial<ChainAState>> {
      const successCount = state.coderResults.filter((r) => r.success).length;
      const totalCount = state.coderResults.length;
      ctx.kpiCollector.collectMetric({
        metricId: `kpi-chain-a-${Date.now()}`,
        kpiType: "success_rate",
        value: totalCount > 0 ? successCount / totalCount : 0,
        unit: "ratio",
        workflowId: `chain-a-${state.parentRequirementId ?? "unknown"}`,
        nodeId: "collect_kpi",
        timestamp: new Date().toISOString(),
        tags: {},
      });
      return {};
    },

    async finalize(state: ChainAState): Promise<Partial<ChainAState>> {
      const allPassed = state.coderResults.every((r) => r.success);
      const qualityPassed = state.qualityResults.every((r) => r.result.passed);
      const compliancePassed = state.complianceReport?.passed ?? true;

      if (state.parentRequirementId) {
        ctx.db.updateRequirementStatus(
          state.parentRequirementId,
          allPassed && qualityPassed ? "completed" : "failed",
        );
      }

      return {
        success: allPassed && qualityPassed && compliancePassed,
        summary: `Decomposed ${state.decomposedRequirements.length} requirements, published ${state.publishedTasks.length} tasks, coder ${state.coderResults.filter((r) => r.success).length}/${state.coderResults.length} passed, compliance ${compliancePassed ? "OK" : "FAIL"}`,
      };
    },
  };
}

// ============================================================================
// Graph Builder
// ============================================================================

export function createChainAGraph(ctx: ChainContext, config: ChainAConfig = {}) {
  const nodes = createDefaultNodes(ctx, config);
  const workflowId = `chain-a-${Date.now()}`;
  const hookConfig: StepHookConfig = { workflowId, chainId: "A" };

  const wrap = <T extends ChainANodeExecutor>(nodeId: string, fn: T) =>
    withStepHook(nodeId, fn, ctx, hookConfig) as unknown as T;

  const workflow = new StateGraph(ChainAAnnotation)
    .addNode("decompose", wrap("decompose", nodes.decompose))
    .addNode("design_architecture", wrap("design_architecture", nodes.designArchitecture))
    .addNode("generate_tasks", wrap("generate_tasks", nodes.generateTasks))
    .addNode("execute_coder", wrap("execute_coder", nodes.executeCoder))
    .addNode("evaluate_quality", wrap("evaluate_quality", nodes.evaluateQuality))
    .addNode("check_compliance", wrap("check_compliance", nodes.checkCompliance))
    .addNode("collect_kpi", wrap("collect_kpi", nodes.collectKpi))
    .addNode("finalize", wrap("finalize", nodes.finalize))
    .addEdge(START, "decompose")
    .addEdge("decompose", "design_architecture")
    .addEdge("design_architecture", "generate_tasks")
    .addEdge("generate_tasks", "execute_coder")
    .addEdge("execute_coder", "evaluate_quality")
    .addEdge("evaluate_quality", "check_compliance")
    .addEdge("check_compliance", "collect_kpi")
    .addEdge("collect_kpi", "finalize")
    .addEdge("finalize", END);

  return workflow.compile();
}
