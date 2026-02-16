/**
 * 自我迭代系统 — 类型定义
 *
 * 涵盖失败采集、KPI 采集、Lineage 追踪、归因分析、补丁管理、Argue 系统。
 *
 * 源码参考:
 * - _personal_copilot/src/workflows/self_iteration/failure_models.py
 * - _personal_copilot/src/workflows/self_iteration/kpi_models.py
 * - _personal_copilot/src/workflows/self_iteration/lineage_models.py
 * - _personal_copilot/src/workflows/self_iteration/attribution_models.py
 * - _personal_copilot/src/workflows/self_iteration/patch_models.py
 * - _personal_copilot/src/agents/argue_manager.py
 */

// ============================================================================
// Failure 模型
// ============================================================================

export type FailureType =
  | "input_validation"
  | "output_validation"
  | "execution_error"
  | "quality_gate"
  | "assessment_failure"
  | "argue"
  | "circuit_breaker";

export type Severity = "critical" | "high" | "medium" | "low";

export interface FailureEvent {
  failureId: string;
  timestamp: string;
  workflowId: string;
  nodeId: string;
  failureType: FailureType;
  severity: Severity;
  errorMessage: string;
  rootCause?: string;
  inputSnapshot?: Record<string, unknown>;
  stackTrace?: string;
  resolved: boolean;
  resolvedAt?: string;
  resolutionMethod?: string;
}

// ============================================================================
// KPI 模型
// ============================================================================

export type KPIType =
  | "latency"
  | "token_usage"
  | "step_count"
  | "success_rate"
  | "quality_score"
  | "user_satisfaction"
  | "requirement_coverage";

/** 5 级分类评估 */
export type AssessmentLevel = 1 | 2 | 3 | 4 | 5;

/** 硬指标（机器可采集） */
export interface Metric {
  metricId: string;
  kpiType: KPIType;
  value: number;
  unit: string;
  workflowId: string;
  nodeId: string;
  timestamp: string;
  tags: Record<string, string>;
}

/** 软评估（人工/LLM 评判） */
export interface Evaluation {
  evaluationId: string;
  kpiType: KPIType;
  score: number;
  workflowId: string;
  nodeId?: string;
  evaluator: string;
  comment: string;
  criteria: Record<string, unknown>;
  timestamp: string;
}

/** 期望阈值 */
export interface Expectation {
  expectationId: string;
  kpiType: KPIType;
  targetValue: number;
  operator: ">" | "<" | ">=" | "<=" | "==";
  description: string;
  level: "hard" | "soft";
  flexibility: number;
  active: boolean;
  createdAt: string;
}

/** 分类评估 */
export interface CategoricalAssessment {
  assessmentId: string;
  level: AssessmentLevel;
  reasoning: string;
  workflowId: string;
  nodeId: string;
  evaluator: string;
  modelId: string;
  agentId: string;
  unmetRequirements: string[];
  inappropriateApproaches: string[];
  recommendations: string[];
  timestamp: string;
}

// ============================================================================
// Lineage 模型
// ============================================================================

export type ArtifactType =
  | "workflow_input"
  | "workflow_output"
  | "node_input"
  | "node_output"
  | "intermediate_result";

export interface Artifact {
  artifactId: string;
  artifactType: ArtifactType;
  createdBy: string;
  workflowId: string;
  content: unknown;
  parentArtifacts: string[];
  timestamp: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface LineageChain {
  artifactId: string;
  chain: Array<Record<string, unknown>>;
  isComplete: boolean;
  depth: number;
}

// ============================================================================
// Attribution 模型
// ============================================================================

export type ProblemType =
  | "llm_context_insufficient"
  | "llm_prompt_unclear"
  | "llm_reasoning_error"
  | "workflow_design_flaw"
  | "node_design_flaw"
  | "external_dependency_error"
  | "program_bug"
  | "error_handling_insufficient";

export type EvidenceType =
  | "execution_log"
  | "artifact"
  | "argue_record"
  | "error_stack"
  | "user_feedback";

export interface Evidence {
  evidenceType: EvidenceType;
  content: unknown;
  description: string;
  metadata: Record<string, unknown>;
}

export interface AttributionResult {
  failureId: string;
  workflowId: string;
  nodeId: string;
  stepId?: string;
  locationDescription: string;
  problemType: ProblemType;
  problemDescription: string;
  rootCauseAnalysis: string;
  evidences: Evidence[];
  confidence: number;
  suggestedPatchDirection?: string;
  timestamp: string;
}

export interface ExecutionProcessSummary {
  workflowId: string;
  nodeId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  status: string;
  steps: Array<Record<string, unknown>>;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
}

export interface ArgueHistorySummary {
  argueId: string;
  relatedArtifactId: string;
  argueType: string;
  participants: string[];
  triggerReason: string;
  resolution?: string;
  rounds: number;
}

// ============================================================================
// Patch 模型
// ============================================================================

export type PatchType =
  | "prompt_optimization"
  | "agent_memory"
  | "workflow_validation"
  | "workflow_redesign"
  | "capability_upgrade";

export type PatchStatus =
  | "suggested"
  | "reviewed"
  | "approved"
  | "applied"
  | "rejected"
  | "deprecated";

export type PatchPlanStatus = "suggested" | "approved" | "rejected" | "revision" | "executed";

/** 补丁基础结构 */
export interface Patch {
  patchId: string;
  patchType: PatchType;
  target: string;
  title: string;
  description: string;
  rationale: string;
  suggestedAttributionId?: string;
  priority: number;
  estimatedEffort: string;
  status: PatchStatus;
  timestamp: string;
}

/** LLM Prompt 优化补丁 */
export interface LLMPatch extends Patch {
  patchType: "prompt_optimization";
  currentPrompt: string;
  suggestedPrompt: string;
  promptChanges: string[];
}

/** Agent 记忆补丁 */
export interface AgentMemoryPatch extends Patch {
  patchType: "agent_memory";
  triggerCondition: string;
  memoryContent: string;
  handlingSuggestion: string;
}

/** 工作流验证补丁 */
export interface WorkflowValidationPatch extends Patch {
  patchType: "workflow_validation";
  insertPosition: string;
  validationLogic: string;
  errorHandling: string;
  implementationHint: string;
}

/** 工作流重设计补丁 */
export interface WorkflowRedesignPatch extends Patch {
  patchType: "workflow_redesign";
  currentDesignIssues: string[];
  proposedDesign: string;
  designChanges: string[];
  migrationNotes: string;
}

/** 能力升级补丁 */
export interface CapabilityUpgradePatch extends Patch {
  patchType: "capability_upgrade";
  capabilityGap: string;
  solutions: Array<Record<string, unknown>>;
  recommendedSolution: string;
  recommendationRationale: string;
}

/** 联合补丁类型 */
export type AnyPatch =
  | LLMPatch
  | AgentMemoryPatch
  | WorkflowValidationPatch
  | WorkflowRedesignPatch
  | CapabilityUpgradePatch;

export interface PatchValidationResult {
  patchId: string;
  isValid: boolean;
  confidence: number;
  validationReasons: string[];
  potentialRisks: string[];
  improvementSuggestions: string[];
  reviewer: string;
  timestamp: string;
}

export interface PatchPlan {
  planId: string;
  patchId: string;
  targetFiles: string[];
  changes: Array<{ file: string; search: string; replace: string; reason: string }>;
  summaryMd: string;
  status: PatchPlanStatus;
  planningReasoning?: string;
  riskAssessment?: string;
  timestamp: string;
}

export interface PatchEffect {
  effectId: string;
  patchId: string;
  workflowId?: string;
  nodeId?: string;
  effectType: string;
  metricName: string;
  metricValueBefore?: number;
  metricValueAfter?: number;
  improvementPct?: number;
  measuredAt: string;
  notes?: string;
}

export interface PatchReview {
  reviewId: string;
  patchId: string;
  reviewer: string;
  decision: string;
  comments?: string;
  reviewedAt: string;
}

// ============================================================================
// Argue 模型
// ============================================================================

export type ArgueLevel = "urgent" | "serious" | "normal" | "suggestion";

export type ArgueReason =
  | "need_refinement"
  | "logic_error"
  | "incomplete_output"
  | "quality_issue"
  | "constraint_violation";

export type ArgueStatus = "pending" | "accepted" | "rejected" | "arbitrated";

export interface ArgueMessage {
  argueId: string;
  fromAgent: string;
  toAgent: string;
  taskId: string;
  reason: ArgueReason;
  level: ArgueLevel;
  details: string;
  suggestions: string[];
  evidence: Evidence[];
  timestamp: string;
}

export interface ArgueResponse {
  argueId: string;
  accepted: boolean;
  feedback: string;
  reasoning: string;
  counterPoints: string[];
  timestamp: string;
}

export interface ArgueBackMessage {
  argueId: string;
  argueBackId: string;
  rejectionReason: string;
  counterEvidence: Evidence[];
  counterArguments: string[];
  alternativeSolution?: string;
  requiresArbitration: boolean;
  timestamp: string;
}

export interface ArbitrationRequest {
  argueId: string;
  argueBackId?: string;
  requestedBy: string;
  reason: string;
  status: "pending" | "resolved";
  resolution?: string;
  timestamp: string;
}
