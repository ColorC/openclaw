/**
 * 维护管线 — 状态类型定义
 *
 * 覆盖:
 * - RequirementDecomposition（需求分解）
 * - ArchitectureExploration（架构探索）
 * - DocumentOrganization（文档整理）
 *
 * 源码参考:
 * - _personal_copilot/src/workflows/states/requirement_decomposition_state.py
 * - _personal_copilot/src/workflows/states/architecture_exploration_state.py
 * - _personal_copilot/src/workflows/states/document_organization_state.py
 */

// ============================================================================
// Requirement Decomposition
// ============================================================================

export interface SubRequirement {
  id: string;
  description: string;
  category: string;
  projectId?: string;
  investScore?: InvestScoreResult;
}

export interface InvestScoreResult {
  independent: number;
  negotiable: number;
  valuable: number;
  estimable: number;
  small: number;
  testable: number;
  total: number;
}

export interface RequirementDecompositionState {
  // 输入
  requirementDescription: string;
  parentRequirementId?: string;
  // 中间
  isValid: boolean;
  subRequirements: SubRequirement[];
  investScores: InvestScoreResult[];
  currentStep: string;
  error?: string;
  // 输出
  requirementTree: Record<string, unknown>;
}

// ============================================================================
// Architecture Exploration
// ============================================================================

export interface ExplorationFinding {
  type: string;
  content: string;
  source: string;
  iteration: number;
}

export interface ExplorationToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ArchitectureExplorationState {
  // 输入
  userInput: string;
  context: Record<string, unknown>;
  maxIterations: number;
  projectPath?: string;
  // 迭代
  currentIteration: number;
  nextAction: "continue" | "complete";
  pendingToolCalls: ExplorationToolCall[];
  toolResults: Array<Record<string, unknown>>;
  findings: ExplorationFinding[];
  keyFindings: string[];
  // 输出
  architectureSummary: string;
  success: boolean;
  error?: string;
  stats: {
    iterations: number;
    toolCallsCount: number;
    findingsCount: number;
  };
}

// ============================================================================
// Document Organization
// ============================================================================

export type DocumentType = "checklist" | "report" | "plan" | "other";

export interface DiscoveredFile {
  path: string;
  filename: string;
  documentType: DocumentType;
  size: number;
}

export interface ParsedTask {
  id: string;
  description: string;
  status: string;
  priority?: string;
  metadata: Record<string, unknown>;
  sourceFile: string;
}

export interface DocumentOrganizationState {
  // 输入
  sourceDir: string;
  projectRoot: string;
  importToPm: boolean;
  autoArchive: boolean;
  // 中间
  discoveredFiles: DiscoveredFile[];
  classifiedFiles: Record<DocumentType, DiscoveredFile[]>;
  standardizedFiles: string[];
  parsedTasks: ParsedTask[];
  statusUpdates: Array<{ taskId: string; oldStatus: string; newStatus: string }>;
  importedCount: number;
  migratedFiles: string[];
  archivedFiles: string[];
  // 输出
  totalTasks: number;
  currentStep: string;
  error?: string;
  summary: string;
}
