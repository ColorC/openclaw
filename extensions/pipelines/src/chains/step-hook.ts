/**
 * 步骤钩子 (Step Hook)
 *
 * Chain C 的跨切面中间件：包装 LangGraph node executor，
 * 自动采集 failure/KPI/lineage 数据。
 */

import * as crypto from "node:crypto";
import type { FailureType, Severity } from "../self-iteration/models.js";
import type { ChainContext } from "./chain-context.js";

// ============================================================================
// 类型
// ============================================================================

export interface StepHookConfig {
  workflowId: string;
  chainId: "A" | "B";
  requirementId?: string;
}

// ============================================================================
// 核心包装器
// ============================================================================

/**
 * 包装任意 node executor，自动采集：
 * - 成功时：latency KPI + lineage artifact
 * - 失败时：failure event，然后 re-throw
 */
export function withStepHook<S, R extends Partial<S>>(
  nodeId: string,
  executor: (state: S) => Promise<R>,
  ctx: ChainContext,
  hookConfig: StepHookConfig,
): (state: S) => Promise<R> {
  return async (state: S): Promise<R> => {
    const startTime = Date.now();

    try {
      const result = await executor(state);
      const durationMs = Date.now() - startTime;

      // 采集 KPI
      collectStepMetric(ctx, hookConfig.workflowId, nodeId, durationMs);

      // 记录 lineage
      recordStepArtifact(ctx, hookConfig.workflowId, nodeId, result);

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // 采集失败事件
      collectFailure(
        ctx,
        hookConfig.workflowId,
        nodeId,
        error instanceof Error ? error : new Error(String(error)),
        "execution_error",
        "high",
        typeof state === "object" && state !== null
          ? (state as Record<string, unknown>)
          : undefined,
      );

      // 也记录失败的 KPI
      collectStepMetric(ctx, hookConfig.workflowId, nodeId, durationMs);

      throw error;
    }
  };
}

// ============================================================================
// 采集函数
// ============================================================================

/** 采集失败事件 */
export function collectFailure(
  ctx: ChainContext,
  workflowId: string,
  nodeId: string,
  error: Error,
  failureType: FailureType,
  severity: Severity,
  inputSnapshot?: Record<string, unknown>,
): string {
  return ctx.failureCollector.collectFailure({
    failureId: `fail-${workflowId}-${nodeId}-${Date.now()}`,
    workflowId,
    nodeId,
    failureType,
    severity,
    errorMessage: error.message,
    stackTrace: error.stack,
    inputSnapshot,
  });
}

/** 采集步骤 KPI */
export function collectStepMetric(
  ctx: ChainContext,
  workflowId: string,
  nodeId: string,
  durationMs: number,
  tokenCount?: number,
): string {
  const metricId = `metric-${workflowId}-${nodeId}-${Date.now()}`;
  ctx.kpiCollector.collectMetric({
    metricId,
    kpiType: "latency",
    value: durationMs,
    unit: "ms",
    workflowId,
    nodeId,
    timestamp: new Date().toISOString(),
    tags: tokenCount != null ? { tokenCount: String(tokenCount) } : {},
  });
  return metricId;
}

/** 记录步骤产物 lineage */
export function recordStepArtifact(
  ctx: ChainContext,
  workflowId: string,
  nodeId: string,
  content: unknown,
  parentArtifactIds?: string[],
): string {
  const artifactId = `art-${workflowId}-${nodeId}-${crypto.randomUUID().slice(0, 8)}`;
  ctx.lineageTracker.recordArtifact({
    artifactId,
    artifactType: "node_output",
    createdBy: nodeId,
    workflowId,
    content,
    parentArtifacts: parentArtifactIds ?? [],
    metadata: { timestamp: new Date().toISOString() },
  });
  return artifactId;
}
