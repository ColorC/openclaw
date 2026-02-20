/**
 * Chain C — 迭代链路
 *
 * 从 A 或 B 的执行结果中采集数据，分析差距，生成补丁，Argue 协商。
 *
 * START → collect_events → analyze_gaps → generate_patches → argue_review → emit_feedback → END
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { ArgueRecord } from "../self-iteration/argue-manager.js";
import type { FailureEvent, Patch } from "../self-iteration/models.js";
import type { ChainContext } from "./chain-context.js";

// ============================================================================
// State
// ============================================================================

export const ChainCAnnotation = Annotation.Root({
  // 输入
  sourceChain: Annotation<"A" | "B">({ default: () => "A" }),
  workflowId: Annotation<string>({ default: () => "" }),
  requirementId: Annotation<string | undefined>({ default: () => undefined }),
  // 采集
  failures: Annotation<FailureEvent[]>({ default: () => [] }),
  kpiSummary: Annotation<Record<string, number>>({ default: () => ({}) }),
  lineageGaps: Annotation<string[]>({ default: () => [] }),
  // 补丁
  suggestedPatches: Annotation<Patch[]>({ default: () => [] }),
  disputes: Annotation<ArgueRecord[]>({ default: () => [] }),
  // 输出
  feedback: Annotation<{
    targetChain: "A" | "B";
    adjustments: Array<{
      type: "retry_step" | "modify_input" | "escalate" | "apply_patch";
      details: Record<string, unknown>;
    }>;
  }>({ default: () => ({ targetChain: "A", adjustments: [] }) }),
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  summary: Annotation<string>({ default: () => "" }),
});

export type ChainCState = typeof ChainCAnnotation.State;

// ============================================================================
// Default Nodes
// ============================================================================

function createDefaultNodes(ctx: ChainContext) {
  return {
    async collectEvents(state: ChainCState): Promise<Partial<ChainCState>> {
      // 从 failure-collector 和 kpi-collector 查询该 workflowId 的数据
      const failures = ctx.failureCollector.queryByWorkflow(state.workflowId);
      const metrics = ctx.kpiCollector.queryMetrics({ workflowId: state.workflowId });

      const kpiSummary: Record<string, number> = {};
      for (const m of metrics) {
        const key = `${m.kpiType}_${m.nodeId}`;
        kpiSummary[key] = m.value;
      }

      return { failures, kpiSummary };
    },

    async analyzeGaps(state: ChainCState): Promise<Partial<ChainCState>> {
      const gaps: string[] = [];

      // 检查未解决的失败
      const unresolvedFailures = state.failures.filter((f) => !f.resolved);
      if (unresolvedFailures.length > 0) {
        gaps.push(`${unresolvedFailures.length} unresolved failures`);
      }

      // 检查 KPI 期望
      const expectations = ctx.kpiCollector.getActiveExpectations();
      for (const exp of expectations) {
        const relevantMetrics = Object.entries(state.kpiSummary).filter(([key]) =>
          key.startsWith(exp.kpiType),
        );
        for (const [key, value] of relevantMetrics) {
          const met = evaluateExpectation(value, exp.targetValue, exp.operator);
          if (!met) {
            gaps.push(`KPI gap: ${key} = ${value}, expected ${exp.operator} ${exp.targetValue}`);
          }
        }
      }

      return { lineageGaps: gaps };
    },

    async generatePatches(state: ChainCState): Promise<Partial<ChainCState>> {
      if (state.lineageGaps.length === 0) return { suggestedPatches: [] };

      // 为每个差距生成补丁建议
      const patches: Patch[] = state.lineageGaps.map((gap, i) => {
        const patch: Patch = {
          patchId: `patch-${state.workflowId}-${i}`,
          patchType: gap.includes("failure") ? "workflow_validation" : "prompt_optimization",
          target: state.workflowId,
          title: `Fix: ${gap.slice(0, 60)}`,
          description: gap,
          rationale: `Detected gap in ${state.sourceChain} chain execution`,
          priority: gap.includes("failure") ? 3 : 5,
          estimatedEffort: "auto",
          status: "suggested",
          timestamp: new Date().toISOString(),
        };
        ctx.patchDb.savePatch(patch);
        return patch;
      });

      return { suggestedPatches: patches };
    },

    async argueReview(state: ChainCState): Promise<Partial<ChainCState>> {
      if (state.suggestedPatches.length === 0) return { disputes: [] };

      // 对高优先级补丁发起 Argue 审核
      const highPriority = state.suggestedPatches.filter((p) => p.priority <= 3);
      const disputes: ArgueRecord[] = [];

      for (const patch of highPriority) {
        const response = await ctx.argueManager.sendArgue({
          argueId: `argue-${patch.patchId}`,
          fromAgent: "chain-c-iteration",
          toAgent: "patch-reviewer",
          taskId: patch.patchId,
          reason: "quality_issue",
          level: patch.priority <= 2 ? "urgent" : "serious",
          details: `Patch suggested: ${patch.title}\n${patch.description}`,
          suggestions: [`Apply patch ${patch.patchId}`],
          evidence: [],
          timestamp: new Date().toISOString(),
        });
        disputes.push({
          argue: {
            argueId: `argue-${patch.patchId}`,
            fromAgent: "chain-c-iteration",
            toAgent: "patch-reviewer",
            taskId: patch.patchId,
            reason: "quality_issue",
            level: patch.priority <= 2 ? "urgent" : "serious",
            details: patch.description,
            suggestions: [],
            evidence: [],
            timestamp: new Date().toISOString(),
          },
          response,
        });
      }

      return { disputes };
    },

    async emitFeedback(state: ChainCState): Promise<Partial<ChainCState>> {
      const adjustments: ChainCState["feedback"]["adjustments"] = [];

      // 未解决的失败 → retry_step
      const unresolvedFailures = state.failures.filter((f) => !f.resolved);
      for (const f of unresolvedFailures) {
        adjustments.push({
          type: "retry_step",
          details: { nodeId: f.nodeId, failureType: f.failureType, errorMessage: f.errorMessage },
        });
      }

      // 被接受的 argue → apply_patch
      for (const d of state.disputes) {
        if (d.response?.accepted) {
          adjustments.push({
            type: "apply_patch",
            details: { patchId: d.argue.taskId },
          });
        }
      }

      // 未被接受的高优先级 → escalate
      for (const d of state.disputes) {
        if (!d.response?.accepted) {
          adjustments.push({
            type: "escalate",
            details: { argueId: d.argue.argueId, reason: d.response?.reasoning ?? "rejected" },
          });
        }
      }

      return {
        feedback: { targetChain: state.sourceChain, adjustments },
        success: true,
        summary: `Analyzed ${state.failures.length} failures, ${state.lineageGaps.length} gaps, generated ${state.suggestedPatches.length} patches, ${adjustments.length} feedback actions`,
      };
    },
  };
}

// ============================================================================
// Helper
// ============================================================================

function evaluateExpectation(actual: number, target: number, operator: string): boolean {
  switch (operator) {
    case ">":
      return actual > target;
    case "<":
      return actual < target;
    case ">=":
      return actual >= target;
    case "<=":
      return actual <= target;
    case "==":
      return actual === target;
    default:
      return true;
  }
}

// ============================================================================
// Graph Builder
// ============================================================================

export function createChainCGraph(ctx: ChainContext) {
  const nodes = createDefaultNodes(ctx);

  const workflow = new StateGraph(ChainCAnnotation)
    .addNode("collect_events", nodes.collectEvents)
    .addNode("analyze_gaps", nodes.analyzeGaps)
    .addNode("generate_patches", nodes.generatePatches)
    .addNode("argue_review", nodes.argueReview)
    .addNode("emit_feedback", nodes.emitFeedback)
    .addEdge(START, "collect_events")
    .addEdge("collect_events", "analyze_gaps")
    .addEdge("analyze_gaps", "generate_patches")
    .addEdge("generate_patches", "argue_review")
    .addEdge("argue_review", "emit_feedback")
    .addEdge("emit_feedback", END);

  return workflow.compile();
}

/** 便捷函数：运行迭代周期 */
export async function runIterationCycle(
  ctx: ChainContext,
  sourceChain: "A" | "B",
  workflowId: string,
  requirementId?: string,
): Promise<ChainCState> {
  const graph = createChainCGraph(ctx);
  return graph.invoke({ sourceChain, workflowId, requirementId });
}
