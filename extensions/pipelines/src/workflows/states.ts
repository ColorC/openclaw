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
  /** 生成的 proposal 文件建议路径 */
  proposalFilePath?: string;
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
  /** 来源需求 */
  sourceRequirement?: string;
  /** 触发者（哪个功能触发了此功能） */
  triggeredBy?: string;
  /** 被谁依赖 */
  requiredBy?: string;
  /** 是否为隐式推断的功能 */
  isImplicit?: boolean;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  responsibilities: string[];
  dependencies: string[];
  /** 所属层级（如 presentation, business, data, infrastructure） */
  layer?: string;
  /** 规模估算 */
  estimatedSize?: { lines: number; files: number; classes: number };
}

export interface InterfaceDefinition {
  id: string;
  name: string;
  type: "repository" | "service" | "external" | "api" | "controller" | "adapter";
  methods: Array<{
    name: string;
    input: string;
    output: string;
    description: string;
  }>;
  /** 由哪个模块提供 */
  exposedBy?: string;
  /** 被哪些模块消费 */
  consumedBy?: string[];
  /** 所属层级 */
  layer?: string;
  /** 接口方向 */
  direction?: "inbound" | "outbound" | "bidirectional";
}

export interface ResponsibilityEntry {
  moduleId: string;
  featureId: string;
  responsibility: string;
}

export interface EntityDefinition {
  id: string;
  name: string;
  description: string;
  attributes: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
  relationships: Array<{
    target: string;
    type: "one-to-one" | "one-to-many" | "many-to-many";
    description?: string;
  }>;
  /** 所属模块 */
  ownerModule?: string;
}

export interface ApiEndpointDefinition {
  id: string;
  /** HTTP 方法 */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 路径 */
  path: string;
  /** 描述 */
  description: string;
  /** 请求体 */
  requestBody?: string;
  /** 响应体 */
  responseBody?: string;
  /** 关联的实体 */
  relatedEntities?: string[];
  /** 所属模块 */
  ownerModule?: string;
  /** 认证要求 */
  auth?: boolean;
}

export interface DomainDefinition {
  id: string;
  name: string;
  description: string;
  /** 该领域包含的功能 ID */
  featureIds: string[];
  /** 与其他领域的交互点 */
  boundaryInteractions?: Array<{
    targetDomain: string;
    description: string;
  }>;
}

// ============================================================================
// 增量修改共享类型（供 IncrementalDB 和工作流状态共用）
// ============================================================================

export interface ArchitectureSnapshot {
  selectedPattern?: string;
  modules: ModuleDefinition[];
  interfaces: InterfaceDefinition[];
  entities: EntityDefinition[];
  apiEndpoints: ApiEndpointDefinition[];
  domains: DomainDefinition[];
  fileStructure?: Record<string, unknown>;
}

export interface RequirementSnapshotSummary {
  coreProblem?: string;
  targetUsers?: string;
  features: Array<{ name: string; description: string }>;
  techStack: Record<string, string[]>;
  totalRequirements: number;
}

export interface ImpactSummary {
  affectedModules: string[];
  affectedInterfaces: string[];
  affectedEntities: string[];
  affectedEndpoints: string[];
  affectedSpecs: string[];
  impactLevel: "low" | "medium" | "high";
  reasoning: string;
}

export interface DeltaPlanResult {
  addedModules: ModuleDefinition[];
  modifiedModules: Array<{ id: string; changes: Partial<ModuleDefinition>; reason: string }>;
  removedModules: Array<{ id: string; reason: string }>;
  addedInterfaces: InterfaceDefinition[];
  modifiedInterfaces: Array<{ id: string; changes: Partial<InterfaceDefinition>; reason: string }>;
  removedInterfaces: Array<{ id: string; reason: string }>;
  addedEntities: EntityDefinition[];
  modifiedEntities: Array<{ id: string; changes: Partial<EntityDefinition>; reason: string }>;
  removedEntities: Array<{ id: string; reason: string }>;
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

  // ===== 增量修改上下文 =====
  /** 项目 ID（IncrementalDB） */
  projectId?: string;
  /** 变更记录 ID（IncrementalDB） */
  changeRecordId?: number;
  /** 现有架构快照（modify_existing 场景） */
  existingArchitecture?: ArchitectureSnapshot;
  /** 现有需求摘要（modify_existing 场景） */
  existingRequirements?: RequirementSnapshotSummary;
  /** 变更影响分析结果 */
  changeImpact?: ImpactSummary;
  /** 增量设计方案 */
  deltaPlan?: DeltaPlanResult;

  // ===== 分析阶段 =====
  /** 需求分析结果 */
  requirementAnalysis?: {
    scale: "small" | "medium" | "large";
    complexity: "low" | "medium" | "high";
    domain: string;
    keyEntities: string[];
    /** 技术特征（如 concurrency, auth, realtime, persistence） */
    techFeatures?: string[];
    /** 分析推理过程 */
    reasoning?: string;
    /** 推荐的架构方向 */
    recommendedArchitecture?: string;
    /** 集成类型（从 analyze_requirement 提取） */
    integrationType?: "pure_extension" | "core_modification" | "hybrid";
    /** 入口方式 */
    entryPoint?: "independent" | "sub_feature" | "hook";
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
    /** 参考的架构模式列表 */
    referencePatterns?: string[];
    /** 模块组织方式 */
    moduleOrganization?: string;
    /** 通信模式 */
    communicationPattern?: string;
    /** 部署架构 */
    deploymentArchitecture?: string;
    /** 设计理由 */
    justification?: string;
  };
  /** 选择的架构模式 */
  selectedPattern?: string;
  /** 模块列表 */
  modules: ModuleDefinition[];
  /** 接口列表 */
  interfaces: InterfaceDefinition[];
  /** 职责矩阵 */
  responsibilityMatrix: ResponsibilityEntry[];
  /** 数据实体（ER 模型） */
  entities: EntityDefinition[];
  /** API 端点 */
  apiEndpoints: ApiEndpointDefinition[];
  /** 领域分解（大型项目） */
  domains: DomainDefinition[];
  /** 是否启用分阶段交互模式（大型项目 domain 拆分后暂停确认） */
  interactiveMode?: boolean;
  /** 用户对 domain 拆分方案的确认结果 */
  domainApproval?: { approved: boolean; feedback?: string };

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
    /** 结构化问题列表 */
    criticalIssues?: Array<{
      type: "omission" | "coupling" | "inconsistency";
      description: string;
      severity: "high" | "medium";
      affectedComponents: string[];
    }>;
    /** 评审是否通过 */
    reviewPassed?: boolean;
    /** 总体评价 */
    overallAssessment?: string;
  };

  /** 架构验证详情 */
  validationResult?: {
    /** 总体评分 0-100 */
    overallScore: number;
    /** 需求覆盖率 0-100 */
    requirementCoverage: number;
    /** 发现的问题 */
    issues: Array<{
      type: string;
      description: string;
      severity: "high" | "medium" | "low";
      affectedComponents: string[];
    }>;
    /** 缺失的接口 */
    missingInterfaces: Array<{
      priority: "P0" | "P1" | "P2";
      name: string;
      module: string;
      reason: string;
    }>;
    /** 职责冲突 */
    responsibilityConflicts: Array<{
      featureIds: string[];
      sharedModule: string;
      suggestion: string;
    }>;
    /** 修复指令 */
    refinementInstructions: string[];
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
  /** 允许的工作目录 — 文件操作被限制在此目录内 */
  allowedDir?: string;
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
  /** 工作目录 — Agent 文件操作的根目录 */
  workDir: string;
  /** 编辑范围约束 — 写入操作被限制在此路径前缀内（如 extensions/stock-analyzer/） */
  editScope?: string;
  /** Agent 会话 ID — 支持多轮 agent 循环 */
  sessionId?: string;

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
  /** 实现摘要（Agent 自述完成了什么） */
  implementationSummary?: string;
  /** 修复摘要（Agent 自述修复了什么） */
  fixSummary?: string;
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
