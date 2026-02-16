/**
 * LangGraph.js 引擎类型定义
 *
 * 封装 LangGraph.js 的核心类型，提供工作流构建所需的类型安全。
 * 与 Python 版 LangGraph 的 TypedDict + StateGraph 模式对齐。
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { CompiledStateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { StatusCode, StageResult, ExecutionMetadata, PipelineConfig } from "../types.js";

// ============================================================================
// 工作流状态
// ============================================================================

/**
 * 工作流基础状态
 *
 * 所有管线状态的共同字段，对应 Python 版的 TypedDict 基类。
 * 具体工作流通过扩展此接口添加特有字段。
 */
export interface WorkflowStateBase {
  /** 消息历史（LangChain Message 格式） */
  messages: BaseMessage[];
  /** 当前阶段名称 */
  stage: string;
  /** 执行元数据 */
  metadata: ExecutionMetadata;
  /** 各阶段执行结果 */
  stageResults: StageResult[];
  /** 错误信息（失败时） */
  error?: {
    code: string;
    message: string;
    severity: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  };
}

/**
 * 工作流节点函数签名
 *
 * 纯函数，接收状态返回部分状态更新。
 * 对应 Python 版: `(state: State) -> Partial[State]`
 */
export type WorkflowNode<S extends WorkflowStateBase> = (
  state: S,
) => Promise<Partial<S>> | Partial<S>;

/**
 * 条件路由函数签名
 *
 * 根据当前状态决定下一个节点。
 * 对应 Python 版: `(state: State) -> str`
 */
export type WorkflowRouter<S extends WorkflowStateBase> = (state: S) => string;

// ============================================================================
// 工作流配置
// ============================================================================

/**
 * 工作流引擎配置
 *
 * 用于 compile() 阶段的配置
 */
export interface WorkflowEngineConfig extends PipelineConfig {
  /** Checkpointer 实例 */
  checkpointer?: BaseCheckpointSaver;
  /** 在这些节点前中断（用于 human-in-the-loop） */
  interruptBefore?: string[];
  /** 在这些节点后中断 */
  interruptAfter?: string[];
}

/**
 * 工作流调用配置
 *
 * 用于 invoke() 阶段的配置
 */
export interface WorkflowInvokeConfig {
  /** 线程 ID（用于 checkpointer 隔离） */
  threadId: string;
  /** 输入数据 */
  input: Record<string, unknown>;
  /** 最大执行步数 */
  maxSteps?: number;
  /** 超时（毫秒） */
  timeout?: number;
}

// ============================================================================
// 工作流图构建
// ============================================================================

/**
 * 节点定义
 */
export interface NodeDefinition<S extends WorkflowStateBase> {
  /** 节点名称 */
  name: string;
  /** 节点函数 */
  handler: WorkflowNode<S>;
  /** 节点描述（用于调试和可视化） */
  description?: string;
}

/**
 * 边定义
 */
export interface EdgeDefinition {
  /** 源节点 */
  from: string;
  /** 目标节点（普通边） */
  to?: string;
  /** 条件路由（条件边） */
  condition?: string;
  /** 路由映射：条件返回值 → 目标节点 */
  routes?: Record<string, string>;
}

/**
 * 工作流图定义
 *
 * 用于描述完整的工作流结构
 */
export interface WorkflowGraphDefinition<S extends WorkflowStateBase> {
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description?: string;
  /** 状态初始值 */
  initialState: Partial<S>;
  /** 节点列表 */
  nodes: NodeDefinition<S>[];
  /** 边列表 */
  edges: EdgeDefinition[];
  /** 入口节点 */
  entryPoint: string;
  /** 结束节点（可选，可以有多个） */
  exitPoints?: string[];
}

/**
 * 编译后的工作流
 *
 * 使用 any 类型以支持动态节点名称
 * LangGraph.js 的 CompiledStateGraph 具有复杂的泛型约束
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledWorkflow<S extends WorkflowStateBase> = CompiledStateGraph<any, any, any, any>;

// ============================================================================
// 执行追踪
// ============================================================================

/**
 * 节点执行追踪器
 *
 * 用于包装节点函数，添加执行追踪
 */
export interface NodeTracer {
  /** 开始追踪 */
  start(nodeName: string, state: WorkflowStateBase): void;
  /** 结束追踪 */
  end(nodeName: string, result: Partial<WorkflowStateBase>): void;
  /** 记录错误 */
  error(nodeName: string, error: Error): void;
  /** 获取追踪结果 */
  getResults(): StageResult[];
}

/**
 * Token 使用追踪
 */
export interface TokenUsage {
  /** 输入 token */
  inputTokens: number;
  /** 输出 token */
  outputTokens: number;
  /** 总 token */
  totalTokens: number;
}

// ============================================================================
// 错误处理
// ============================================================================

/**
 * 节点错误
 *
 * 节点执行失败时抛出的错误
 */
export class WorkflowNodeError extends Error {
  constructor(
    public nodeName: string,
    public code: string,
    message: string,
    public cause?: unknown,
    public retryable: boolean = false,
  ) {
    super(`[${nodeName}] ${code}: ${message}`);
    this.name = "WorkflowNodeError";
  }
}

/**
 * 工作流错误
 *
 * 工作流执行失败时的错误
 */
export class WorkflowError extends Error {
  constructor(
    public workflowName: string,
    public statusCode: StatusCode,
    message: string,
    public stageResults: StageResult[],
  ) {
    super(`[${workflowName}] ${statusCode}: ${message}`);
    this.name = "WorkflowError";
  }
}
