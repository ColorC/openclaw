/**
 * StateGraph 构建工厂
 *
 * 封装 LangGraph.js 的 StateGraph 创建和编译流程。
 * 提供与 Python 版 LangGraph 对齐的 API 风格。
 */

import type { BaseMessage } from "@langchain/core/messages";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { StatusCode, ExecutionMetadata, StageResult } from "../types.js";
import type {
  WorkflowStateBase,
  WorkflowNode,
  WorkflowRouter,
  WorkflowGraphDefinition,
  WorkflowEngineConfig,
  CompiledWorkflow,
} from "./types.js";
import { wrapNode } from "./node-wrapper.js";

// ============================================================================
// Annotation 辅助函数
// ============================================================================

/**
 * 创建基础状态 Annotation
 *
 * 使用 LangGraph.js 的 Annotation API 定义状态结构。
 * 对应 Python 版的 TypedDict + Annotated。
 */
export function createBaseStateAnnotation<_S extends WorkflowStateBase>() {
  return Annotation.Root({
    // 消息历史：追加模式
    messages: Annotation<BaseMessage[]>({
      default: () => [],
      reducer: (left, right) => left.concat(right),
    }),

    // 当前阶段：覆盖模式
    stage: Annotation<string>({
      default: () => "",
      reducer: (_, right) => right,
    }),

    // 执行元数据：覆盖模式
    metadata: Annotation<ExecutionMetadata>({
      default: () => ({
        executionId: "",
        threadId: "",
        workflowName: "",
        startedAt: new Date().toISOString(),
        llmCalls: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      }),
      reducer: (_, right) => right,
    }),

    // 阶段结果：追加模式
    stageResults: Annotation<StageResult[]>({
      default: () => [],
      reducer: (left, right) => left.concat(right),
    }),

    // 错误信息：覆盖模式
    error: Annotation<{ code: string; message: string; severity: string } | undefined>({
      default: () => undefined,
      reducer: (_, right) => right,
    }),
  });
}

// ============================================================================
// 图构建器
// ============================================================================

/**
 * 工作流图构建器
 *
 * 提供流畅的 API 构建工作流图
 */
export class WorkflowGraphBuilder<S extends WorkflowStateBase> {
  private nodes: Map<string, WorkflowNode<S>> = new Map();
  private edges: Array<{ from: string; to: string }> = [];
  private conditionalEdges: Array<{
    from: string;
    router: WorkflowRouter<S>;
    routes: Record<string, string>;
  }> = [];
  private entryPoint: string = "";
  private annotation: ReturnType<typeof Annotation.Root>;

  constructor(
    private name: string,
    annotation: ReturnType<typeof Annotation.Root>,
  ) {
    this.annotation = annotation;
  }

  /**
   * 添加节点
   */
  addNode(name: string, handler: WorkflowNode<S>): this {
    this.nodes.set(name, handler);
    return this;
  }

  /**
   * 添加普通边
   */
  addEdge(from: string, to: string): this {
    this.edges.push({ from, to });
    return this;
  }

  /**
   * 添加条件边
   */
  addConditionalEdges(
    from: string,
    router: WorkflowRouter<S>,
    routes: Record<string, string>,
  ): this {
    this.conditionalEdges.push({ from, router, routes });
    return this;
  }

  /**
   * 设置入口点
   */
  setEntryPoint(nodeName: string): this {
    this.entryPoint = nodeName;
    return this;
  }

  /**
   * 编译工作流
   */
  compile(config?: WorkflowEngineConfig): CompiledWorkflow<S> {
    // 创建 StateGraph
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = new StateGraph(this.annotation as any);

    // 添加节点
    for (const [name, handler] of Array.from(this.nodes.entries())) {
      const wrappedHandler = config?.enableTracing
        ? wrapNode(handler, { nodeName: name, maxRetries: config.maxRetries })
        : handler;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.addNode(name, wrappedHandler as any);
    }

    // 添加入口边
    if (this.entryPoint) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.addEdge(START, this.entryPoint as any);
    }

    // 添加普通边
    for (const { from, to } of this.edges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.addEdge(from as any, to as any);
    }

    // 添加条件边
    for (const { from, router, routes } of this.conditionalEdges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.addConditionalEdges(from as any, router as any, routes as any);
    }

    // 编译 - 使用 unknown 中间类型进行转换
    const compiled = graph.compile({
      checkpointer: config?.checkpointer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interruptBefore: config?.interruptBefore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interruptAfter: config?.interruptAfter as any,
    });
    return compiled as unknown as CompiledWorkflow<S>;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建工作流图构建器
 */
export function createWorkflowGraph<S extends WorkflowStateBase>(
  name: string,
  annotation: ReturnType<typeof Annotation.Root>,
): WorkflowGraphBuilder<S> {
  return new WorkflowGraphBuilder<S>(name, annotation);
}

/**
 * 从定义创建工作流
 */
export function createWorkflowFromDefinition<S extends WorkflowStateBase>(
  definition: WorkflowGraphDefinition<S>,
  config?: WorkflowEngineConfig,
): CompiledWorkflow<S> {
  const annotation = createBaseStateAnnotation<S>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = new WorkflowGraphBuilder<S>(definition.name, annotation as any);

  // 添加节点
  for (const node of definition.nodes) {
    builder.addNode(node.name, node.handler);
  }

  // 添加边
  for (const edge of definition.edges) {
    if (edge.condition && edge.routes) {
      // 条件边需要 router 函数，这里简化处理
      // 实际使用时应提供 router
    } else if (edge.to) {
      builder.addEdge(edge.from, edge.to);
    }
  }

  // 设置入口点
  builder.setEntryPoint(definition.entryPoint);

  return builder.compile(config);
}

/**
 * 创建工作流执行器
 *
 * 封装 invoke 调用，提供统一的错误处理和结果格式
 */
export async function invokeWorkflow<S extends WorkflowStateBase>(
  workflow: CompiledWorkflow<S>,
  input: Partial<S>,
  threadId: string,
): Promise<{ status: StatusCode; data: S; error?: Error }> {
  try {
    const result = await workflow.invoke(input as Record<string, unknown>, {
      configurable: { thread_id: threadId },
    });

    return {
      status: "SUCCESS",
      data: result as S,
    };
  } catch (error) {
    return {
      status: "FAILED",
      data: input as S,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// 导出常量
export { START, END };
