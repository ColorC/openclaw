/**
 * Pipelines 统一类型定义
 *
 * 所有管线的基础类型，包括状态码、执行元数据、错误信息等。
 * 这些类型被 engine/、services/、workflows/ 共同使用。
 */

// ============================================================================
// 状态码定义
// ============================================================================

/**
 * 管线执行状态码
 *
 * SUCCESS: 成功完成
 * PENDING: 等待执行
 * RUNNING: 正在执行
 * PAUSED: 已暂停（等待外部输入，如 human-in-the-loop）
 * FAILED: 执行失败
 * CANCELLED: 被取消
 * TIMEOUT: 执行超时
 */
export type StatusCode =
  | "SUCCESS"
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

// ============================================================================
// 执行元数据
// ============================================================================

/**
 * 执行元数据
 *
 * 记录单次工作流或节点执行的基础信息
 */
export interface ExecutionMetadata {
  /** 执行 ID（唯一标识一次执行） */
  executionId: string;
  /** 线程 ID（用于 checkpointer 隔离） */
  threadId: string;
  /** 工作流名称 */
  workflowName: string;
  /** 开始时间（ISO 8601） */
  startedAt: string;
  /** 结束时间（ISO 8601），未结束时为 undefined */
  endedAt?: string;
  /** 执行时长（毫秒） */
  duration?: number;
  /** LLM 调用次数 */
  llmCalls: number;
  /** 总 token 使用量 */
  totalTokens: number;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
}

/**
 * 阶段执行结果
 *
 * 记录单个节点（stage）的执行结果
 */
export interface StageResult {
  /** 阶段名称（节点名） */
  stageName: string;
  /** 执行状态 */
  status: StatusCode;
  /** 阶段产出数据 */
  data?: Record<string, unknown>;
  /** 错误信息（失败时） */
  error?: ErrorInfo;
  /** 执行时长（毫秒） */
  duration: number;
  /** 本次阶段的 token 使用量 */
  tokens: number;
  /** 开始时间（ISO 8601） */
  startedAt: string;
  /** 结束时间（ISO 8601） */
  endedAt: string;
}

// ============================================================================
// 错误信息
// ============================================================================

/**
 * 错误严重级别
 */
export type ErrorSeverity = "CRITICAL" | "ERROR" | "WARNING" | "INFO";

/**
 * 错误信息
 *
 * 统一的错误描述结构
 */
export interface ErrorInfo {
  /** 错误代码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 严重级别 */
  severity: ErrorSeverity;
  /** 错误来源（哪个节点/组件） */
  source?: string;
  /** 原始错误（用于调试） */
  cause?: unknown;
  /** 堆栈信息 */
  stack?: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 重试次数 */
  retryCount?: number;
}

// ============================================================================
// 工作流结果
// ============================================================================

/**
 * 工作流执行结果（泛型）
 *
 * @template T - 产出数据类型
 */
export interface WorkflowResult<T = Record<string, unknown>> {
  /** 执行状态 */
  status: StatusCode;
  /** 产出数据 */
  data?: T;
  /** 错误信息 */
  error?: ErrorInfo;
  /** 执行元数据 */
  metadata: ExecutionMetadata;
  /** 各阶段执行结果 */
  stages: StageResult[];
}

// ============================================================================
// 管线配置
// ============================================================================

/**
 * 管线基础配置
 */
export interface PipelineConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟基数（毫秒，指数退避） */
  retryDelayBase: number;
  /** 执行超时（毫秒） */
  timeout: number;
  /** 是否启用执行追踪 */
  enableTracing: boolean;
  /** 是否启用 checkpointer */
  enableCheckpoint: boolean;
  /** checkpointer 存储路径（相对于 workspace） */
  checkpointPath?: string;
}

/**
 * 默认管线配置
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxRetries: 3,
  retryDelayBase: 1000,
  timeout: 300000, // 5 分钟
  enableTracing: true,
  enableCheckpoint: true,
  checkpointPath: ".pipelines/checkpoints",
};
