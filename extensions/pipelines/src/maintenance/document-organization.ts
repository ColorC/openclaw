/**
 * 文档整理工作流 (Document Organization)
 *
 * 整理 AI 生成的 markdown 文档，自动分类、解析任务、导入 PM 系统。
 *
 * 流程 (10 步线性):
 * START → validate → classify → standardize → parse → analyze_status
 *       → update_status → import_pm → migrate → archive → finalize → END
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/document_organization_workflow.py
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type {
  DocumentOrganizationState,
  DocumentType,
  DiscoveredFile,
  ParsedTask,
} from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const DocumentOrganizationAnnotation = Annotation.Root({
  // 输入
  sourceDir: Annotation<string>({ default: () => "" }),
  projectRoot: Annotation<string>({ default: () => "." }),
  importToPm: Annotation<boolean>({ default: () => true }),
  autoArchive: Annotation<boolean>({ default: () => false }),
  // 中间
  discoveredFiles: Annotation<DiscoveredFile[]>({ default: () => [] }),
  classifiedFiles: Annotation<Record<DocumentType, DiscoveredFile[]>>({
    default: () => ({ checklist: [], report: [], plan: [], other: [] }),
  }),
  standardizedFiles: Annotation<string[]>({ default: () => [] }),
  parsedTasks: Annotation<ParsedTask[]>({ default: () => [] }),
  statusUpdates: Annotation<Array<{ taskId: string; oldStatus: string; newStatus: string }>>({
    default: () => [],
  }),
  importedCount: Annotation<number>({ default: () => 0 }),
  migratedFiles: Annotation<string[]>({ default: () => [] }),
  archivedFiles: Annotation<string[]>({ default: () => [] }),
  // 输出
  totalTasks: Annotation<number>({ default: () => 0 }),
  currentStep: Annotation<string>({ default: () => "init" }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  summary: Annotation<string>({ default: () => "" }),
});

export type DocOrgGraphState = typeof DocumentOrganizationAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

export type DocOrgNodeExecutor = (state: DocOrgGraphState) => Promise<Partial<DocOrgGraphState>>;

export interface DocOrgNodeOverrides {
  validateInput?: DocOrgNodeExecutor;
  classifyDocuments?: DocOrgNodeExecutor;
  standardizeFormat?: DocOrgNodeExecutor;
  parseChecklists?: DocOrgNodeExecutor;
  analyzeTaskStatus?: DocOrgNodeExecutor;
  updateChecklistStatus?: DocOrgNodeExecutor;
  importToPm?: DocOrgNodeExecutor;
  migrateToStandard?: DocOrgNodeExecutor;
  archiveDocuments?: DocOrgNodeExecutor;
  finalize?: DocOrgNodeExecutor;
}

// ============================================================================
// Default Node Implementations
// ============================================================================

const defaultNodes: Required<DocOrgNodeOverrides> = {
  async validateInput(state) {
    if (!state.sourceDir?.trim()) {
      return { error: "Source directory is required", currentStep: "validate" };
    }
    return { currentStep: "validate" };
  },

  async classifyDocuments(state) {
    // Stub: 按文件名关键词分类
    const files = state.discoveredFiles ?? [];
    const classified: Record<DocumentType, DiscoveredFile[]> = {
      checklist: [],
      report: [],
      plan: [],
      other: [],
    };
    for (const f of files) {
      const name = f.filename.toLowerCase();
      if (name.includes("checklist") || name.includes("todo")) classified.checklist.push(f);
      else if (name.includes("report")) classified.report.push(f);
      else if (name.includes("plan")) classified.plan.push(f);
      else classified.other.push(f);
    }
    return { classifiedFiles: classified, currentStep: "classify" };
  },

  async standardizeFormat(state) {
    // Stub: 格式标准化
    const standardized = (state.discoveredFiles ?? []).map((f) => f.path);
    return { standardizedFiles: standardized, currentStep: "standardize" };
  },

  async parseChecklists(state) {
    // Stub: 从 checklist 文件提取任务
    const tasks: ParsedTask[] = (state.classifiedFiles?.checklist ?? []).map((f, i) => ({
      id: `task-${i + 1}`,
      description: `Task from ${f.filename}`,
      status: "pending",
      metadata: {},
      sourceFile: f.path,
    }));
    return { parsedTasks: tasks, totalTasks: tasks.length, currentStep: "parse" };
  },

  async analyzeTaskStatus(state) {
    // Stub: 查询任务实际状态
    return { currentStep: "analyze_status" };
  },

  async updateChecklistStatus(state) {
    // Stub: 更新 checklist 中的状态
    return { statusUpdates: [], currentStep: "update_status" };
  },

  async importToPm(state) {
    if (!state.importToPm) {
      return { importedCount: 0, currentStep: "import_pm" };
    }
    // Stub: 导入到 PM 系统
    return { importedCount: (state.parsedTasks ?? []).length, currentStep: "import_pm" };
  },

  async migrateToStandard(state) {
    // Stub: 迁移到标准目录
    return { migratedFiles: state.standardizedFiles ?? [], currentStep: "migrate" };
  },

  async archiveDocuments(state) {
    if (!state.autoArchive) {
      return { archivedFiles: [], currentStep: "archive" };
    }
    return { archivedFiles: state.standardizedFiles ?? [], currentStep: "archive" };
  },

  async finalize(state) {
    const totalFiles = (state.discoveredFiles ?? []).length;
    const totalTasks = state.totalTasks ?? 0;
    const imported = state.importedCount ?? 0;
    return {
      summary: `Processed ${totalFiles} files, parsed ${totalTasks} tasks, imported ${imported} to PM`,
      currentStep: "finalize",
    };
  },
};

// ============================================================================
// Graph Builder
// ============================================================================

export function createDocumentOrganizationGraph(overrides: DocOrgNodeOverrides = {}) {
  const n = { ...defaultNodes, ...overrides };

  const workflow = new StateGraph(DocumentOrganizationAnnotation)
    .addNode("validate_input", n.validateInput)
    .addNode("classify_documents", n.classifyDocuments)
    .addNode("standardize_format", n.standardizeFormat)
    .addNode("parse_checklists", n.parseChecklists)
    .addNode("analyze_task_status", n.analyzeTaskStatus)
    .addNode("update_checklist_status", n.updateChecklistStatus)
    .addNode("import_to_pm", n.importToPm)
    .addNode("migrate_to_standard", n.migrateToStandard)
    .addNode("archive_documents", n.archiveDocuments)
    .addNode("finalize", n.finalize)
    // 线性流程
    .addEdge(START, "validate_input")
    .addEdge("validate_input", "classify_documents")
    .addEdge("classify_documents", "standardize_format")
    .addEdge("standardize_format", "parse_checklists")
    .addEdge("parse_checklists", "analyze_task_status")
    .addEdge("analyze_task_status", "update_checklist_status")
    .addEdge("update_checklist_status", "import_to_pm")
    .addEdge("import_to_pm", "migrate_to_standard")
    .addEdge("migrate_to_standard", "archive_documents")
    .addEdge("archive_documents", "finalize")
    .addEdge("finalize", END);

  return workflow.compile();
}
