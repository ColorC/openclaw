/**
 * Node 包装器
 *
 * 为 LangGraph 节点函数添加执行追踪、错误处理、重试机制。
 */

import type { StageResult } from "../types.js";
import type { WorkflowStateBase, WorkflowNode, NodeTracer, TokenUsage } from "./types.js";

/**
 * 节点包装器配置
 */
export interface NodeWrapperConfig {
  /** 节点名称 */
  nodeName: string;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟基数（毫秒） */
  retryDelayBase: number;
  /** 是否启用追踪 */
  enableTracing: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Omit<NodeWrapperConfig, "nodeName"> = {
  maxRetries: 3,
  retryDelayBase: 1000,
  enableTracing: true,
};

/**
 * 创建节点执行追踪器
 */
export function createNodeTracer(): NodeTracer {
  const results: StageResult[] = [];
  const startTimes: Map<string, number> = new Map();
  const startStates: Map<string, WorkflowStateBase> = new Map();

  return {
    start(nodeName: string, state: WorkflowStateBase): void {
      startTimes.set(nodeName, Date.now());
      startStates.set(nodeName, state);
    },

    end(nodeName: string, result: Partial<WorkflowStateBase>): void {
      const startTime = startTimes.get(nodeName) ?? Date.now();
      const duration = Date.now() - startTime;

      results.push({
        stageName: nodeName,
        status: "SUCCESS",
        data: result as Record<string, unknown>,
        duration,
        tokens: 0, // 由 LLM 调用填充
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date().toISOString(),
      });

      startTimes.delete(nodeName);
      startStates.delete(nodeName);
    },

    error(nodeName: string, error: Error): void {
      const startTime = startTimes.get(nodeName) ?? Date.now();
      const duration = Date.now() - startTime;

      results.push({
        stageName: nodeName,
        status: "FAILED",
        error: {
          code: "NODE_ERROR",
          message: error.message,
          severity: "ERROR",
          source: nodeName,
          stack: error.stack,
          retryable: false,
        },
        duration,
        tokens: 0,
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date().toISOString(),
      });

      startTimes.delete(nodeName);
      startStates.delete(nodeName);
    },

    getResults(): StageResult[] {
      return [...results];
    },
  };
}

/**
 * 指数退避延迟
 */
function exponentialBackoff(attempt: number, baseDelay: number): number {
  // 基数 * 2^attempt + 随机抖动
  return baseDelay * Math.pow(2, attempt) + Math.random() * 100;
}

/**
 * 包装节点函数，添加重试和追踪
 */
export function wrapNode<S extends WorkflowStateBase>(
  node: WorkflowNode<S>,
  config: Partial<NodeWrapperConfig> & { nodeName: string },
): WorkflowNode<S> {
  const fullConfig: NodeWrapperConfig = { ...DEFAULT_CONFIG, ...config };
  const { nodeName, maxRetries, retryDelayBase, enableTracing } = fullConfig;

  return async (state: S): Promise<Partial<S>> => {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const result = await node(state);

        // 如果追踪启用且 state 有 stageResults，追加结果
        if (enableTracing && state.stageResults) {
          const duration = 0; // 实际时长由 tracer 记录
          state.stageResults.push({
            stageName: nodeName,
            status: "SUCCESS",
            data: result as Record<string, unknown>,
            duration,
            tokens: 0,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        // 判断是否可重试
        const retryable = isRetryableError(lastError);
        if (!retryable || attempt > maxRetries) {
          break;
        }

        // 等待后重试
        const delay = exponentialBackoff(attempt - 1, retryDelayBase);
        await sleep(delay);
      }
    }

    // 所有重试失败
    throw lastError;
  };
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: Error): boolean {
  // 网络错误、超时错误可重试
  const retryablePatterns = [
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /rate limit/i,
    /timeout/i,
    /temporarily unavailable/i,
  ];

  const message = error.message;
  return retryablePatterns.some((pattern) => pattern.test(message));
}

/**
 * 异步 sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token 使用追踪器
 *
 * 用于累积 LLM 调用的 token 使用量
 */
export class TokenTracker {
  private usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  add(input: number, output: number): void {
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
    this.usage.totalTokens += input + output;
  }

  get(): TokenUsage {
    return { ...this.usage };
  }

  reset(): void {
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }
}
