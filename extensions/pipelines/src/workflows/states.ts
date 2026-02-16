/**
 * 工作流状态类型定义
 *
 * 定义三大生成工作流的状态结构:
 * 1. RequirementClarification - 需求澄清（LLM + Tool 循环）
 * 2. ArchitectureDesign - 架构设计（多节点流水线 + 迭代优化）
 * 3. Coder - 代码生成/修复（Agent 递归执行）
 *
 * 源码参考:
 * - _personal_copilot/src/workflows/states/architecture_design_state.py
 * - _personal_copilot/src/workflows/states/coder_state.py
 */

import type { BaseMessage } from "@langchain/core/messages";

// ============================================================================
// Requirement Clarification State
// ============================================================================

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface RequirementClarificationState {
  /** 对话消息历史 */
  messages: BaseMessage[];
  /** 待执行的 LLM 工具调用 */
  pendingToolCalls?: ToolCall[];
  /** 工具执行结果 */
  toolResults?: ToolResult[];
  /** LLM 响应文本 */
  response?: string;
  /** 是否完成 */
  completed: boolean;
  /** 错误信息 */
  error?: string;
  /** 当前迭代次数 */
  iteration: number;
  /** 最大迭代次数 */
  maxIteration: number;
  /** 会话 ID */
  sessionId: string;
  /** 研究任务 IDs */
  researchTaskIds: string[];
  /** 序列化的 CollectedInfo JSON，跨轮次持久化 */
  collectedInfoJson?: string;
  /** 对话历史（user/assistant 交替），传给 agentLoop 做多轮上下文 */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** 生成的 OpenSpec proposal.md 内容 */
  proposalDocument?: string;
}

// ============================================================================
// Architecture Design State
// ============================================================================

export interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  type: "user_facing" | "internal" | "infrastructure";
  priority?: "critical" | "high" | "medium" | "low";
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  responsibilities: string[];
  dependencies: string[];
}

export interface InterfaceDefinition {
  id: string;
  name: string;
  type: "repository" | "service" | "external" | "api";
  methods: Array<{
    name: string;
    input: string;
    output: string;
    description: string;
  }>;
}

export interface ResponsibilityEntry {
  moduleId: string;
  featureId: string;
  responsibility: string;
}

export interface ArchitectureDesignState {
  // ===== 输入 =====
  /** 需求描述 */
  requirement: string;
  /** 项目上下文 */
  projectContext: Record<string, unknown>;
  /** 场景类型: 新项目 / 修改现有 */
  scenario: "new_project" | "modify_existing";
  /** 项目路径（修改现有场景需要） */
  projectPath?: string;

  // ===== 分析阶段 =====
  /** 需求分析结果 */
  requirementAnalysis?: {
    scale: "small" | "medium" | "large";
    complexity: "low" | "medium" | "high";
    domain: string;
    keyEntities: string[];
  };
  /** 用户面向功能 */
  userFacingFeatures: FeatureDefinition[];
  /** 内部功能 */
  internalFeatures: FeatureDefinition[];
  /** 基础设施依赖 */
  infrastructureDependencies: FeatureDefinition[];

  // ===== 设计阶段 =====
  /** 自定义架构 */
  customArchitecture?: {
    name: string;
    pattern: string;
    description: string;
  };
  /** 选择的架构模式 */
  selectedPattern?: string;
  /** 模块列表 */
  modules: ModuleDefinition[];
  /** 接口列表 */
  interfaces: InterfaceDefinition[];
  /** 职责矩阵 */
  responsibilityMatrix: ResponsibilityEntry[];

  // ===== 验证与迭代 =====
  /** 是否需要细化 */
  needsRefinement: boolean;
  /** 细化迭代次数 */
  refinementIteration: number;
  /** 细化历史 */
  refinementHistory: Array<{
    iteration: number;
    issues: string[];
    actions: string[];
  }>;
  /** 设计评审结果 */
  designReview?: {
    omissions: string[];
    couplingIssues: string[];
    suggestions: string[];
  };

  // ===== 输出 =====
  /** 文件结构 */
  fileStructure?: Record<string, unknown>;
  /** OpenSpec 文件列表 */
  openspecFiles: string[];
  /** OpenSpec 文档内容 (文件名 → markdown 内容) */
  openspecDocuments?: Record<string, string>;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// Coder State
// ============================================================================

export interface CodeContext {
  /** 代码骨架 */
  skeleton?: string;
  /** 测试代码 */
  test?: string;
  /** 需求描述 */
  requirements?: string;
  /** 错误报告 */
  errorReports?: Array<{
    file: string;
    line?: number;
    message: string;
    type: "compile" | "test" | "runtime" | "lint";
  }>;
}

export interface QualityIndicators {
  /** 代码覆盖率 */
  testCoverage?: number;
  /** 复杂度 */
  cyclomaticComplexity?: number;
  /** 可维护性指数 */
  maintainabilityIndex?: number;
  /** 代码重复率 */
  duplicationRatio?: number;
}

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface CoderState {
  // ===== 输入 =====
  /** 任务描述 */
  taskDescription: string;
  /** 代码上下文 */
  codeContext: CodeContext;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 质量阈值 */
  qualityThreshold: number;

  // ===== 迭代控制 =====
  /** 当前迭代次数 */
  iterationCount: number;
  /** 当前代码 */
  currentCode?: string;
  /** 验证结果 */
  validationResult?: ValidationResult;
  /** 质量指标 */
  qualityIndicators?: QualityIndicators;
  /** 质量分数 */
  qualityScore: number;
  /** 质量历史 */
  qualityHistory: number[];
  /** 重试原因 */
  retryReason?: string;
  /** 使用的工具 */
  toolsUsed: string[];

  // ===== 输出 =====
  /** 实现代码 */
  implementationCode?: string;
  /** 修复后代码 */
  fixedCode?: string;
  /** 修改的文件列表 */
  modifiedFiles: string[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;

  // ===== Argue 机制 =====
  /** Argue 响应 */
  argueResponse?: {
    type: "quality_below_threshold" | "validation_failed" | "dependency_conflict";
    details: string;
    suggestedAction: string;
  };
  /** Argue 是否已处理 */
  argueHandled: boolean;
}

// ============================================================================
// 通用工作流结果类型
// ============================================================================

export interface WorkflowResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    iterations?: number;
    tokensUsed?: number;
    duration?: number;
  };
}
