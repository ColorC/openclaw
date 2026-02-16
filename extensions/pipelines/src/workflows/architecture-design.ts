/**
 * 架构设计工作流
 *
 * 多节点流水线: 输入验证 → 需求分析 → 功能识别 → 模式选择 →
 * 模块设计 → 接口定义 → 设计评审 → 验证 → 细化(循环) →
 * 文件结构 → OpenSpec → 完成
 *
 * 源码参考: _personal_copilot/src/workflows/graphs/architecture_design_workflow.py
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type {
  ArchitectureDesignState,
  FeatureDefinition,
  ModuleDefinition,
  InterfaceDefinition,
  ResponsibilityEntry,
} from "./states.js";

// ============================================================================
// State Annotation
// ============================================================================

export const ArchitectureDesignAnnotation = Annotation.Root({
  // 输入
  requirement: Annotation<string>({ default: () => "" }),
  projectContext: Annotation<Record<string, unknown>>({ default: () => ({}) }),
  scenario: Annotation<"new_project" | "modify_existing">({ default: () => "new_project" }),
  projectPath: Annotation<string | undefined>({ default: () => undefined }),
  // 分析
  requirementAnalysis: Annotation<ArchitectureDesignState["requirementAnalysis"]>({
    default: () => undefined,
  }),
  userFacingFeatures: Annotation<FeatureDefinition[]>({ default: () => [] }),
  internalFeatures: Annotation<FeatureDefinition[]>({ default: () => [] }),
  infrastructureDependencies: Annotation<FeatureDefinition[]>({ default: () => [] }),
  // 设计
  customArchitecture: Annotation<ArchitectureDesignState["customArchitecture"]>({
    default: () => undefined,
  }),
  selectedPattern: Annotation<string | undefined>({ default: () => undefined }),
  modules: Annotation<ModuleDefinition[]>({ default: () => [] }),
  interfaces: Annotation<InterfaceDefinition[]>({ default: () => [] }),
  responsibilityMatrix: Annotation<ResponsibilityEntry[]>({ default: () => [] }),
  // 验证
  needsRefinement: Annotation<boolean>({ default: () => false }),
  refinementIteration: Annotation<number>({ default: () => 0 }),
  refinementHistory: Annotation<ArchitectureDesignState["refinementHistory"]>({
    default: () => [],
  }),
  designReview: Annotation<ArchitectureDesignState["designReview"]>({ default: () => undefined }),
  // 输出
  fileStructure: Annotation<Record<string, unknown> | undefined>({ default: () => undefined }),
  openspecFiles: Annotation<string[]>({ default: () => [] }),
  openspecDocuments: Annotation<Record<string, string>>({ default: () => ({}) }),
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
});

export type ArchitectureDesignGraphState = typeof ArchitectureDesignAnnotation.State;

// ============================================================================
// Node 类型
// ============================================================================

/** 节点执行器：接收状态，返回部分状态更新 */
export type ArchNodeExecutor = (
  state: ArchitectureDesignGraphState,
) => Promise<Partial<ArchitectureDesignGraphState>>;

export interface ArchitectureDesignNodeOverrides {
  validateInput?: ArchNodeExecutor;
  analyzeRequirement?: ArchNodeExecutor;
  listFeatures?: ArchNodeExecutor;
  selectPattern?: ArchNodeExecutor;
  designModules?: ArchNodeExecutor;
  defineInterfaces?: ArchNodeExecutor;
  designReview?: ArchNodeExecutor;
  validateArchitecture?: ArchNodeExecutor;
  refineDesign?: ArchNodeExecutor;
  designFileStructure?: ArchNodeExecutor;
  generateOpenspec?: ArchNodeExecutor;
  finalize?: ArchNodeExecutor;
  analyzeExistingArchitecture?: ArchNodeExecutor;
}

// ============================================================================
// Default Node Implementations (stubs)
// ============================================================================

const defaultNodes: Required<ArchitectureDesignNodeOverrides> = {
  async validateInput(state) {
    if (!state.requirement) {
      return { success: false, error: "Requirement is required" };
    }
    if (state.scenario === "modify_existing" && !state.projectPath) {
      return { success: false, error: "Project path required for modify_existing scenario" };
    }
    return {};
  },

  async analyzeRequirement(state) {
    return {
      requirementAnalysis: {
        scale: "medium" as const,
        complexity: "medium" as const,
        domain: "general",
        keyEntities: [],
      },
    };
  },

  async listFeatures(state) {
    return {
      userFacingFeatures: [],
      internalFeatures: [],
      infrastructureDependencies: [],
    };
  },

  async selectPattern(_state) {
    return {
      selectedPattern: "layered",
      customArchitecture: {
        name: "Layered Architecture",
        pattern: "layered",
        description: "Standard layered pattern",
      },
    };
  },

  async designModules(_state) {
    return { modules: [], responsibilityMatrix: [] };
  },

  async defineInterfaces(_state) {
    return { interfaces: [] };
  },

  async designReview(_state) {
    return { designReview: { omissions: [], couplingIssues: [], suggestions: [] } };
  },

  async validateArchitecture(state) {
    return { needsRefinement: false };
  },

  async refineDesign(state) {
    return {
      refinementIteration: state.refinementIteration + 1,
      needsRefinement: false,
    };
  },

  async designFileStructure(_state) {
    return { fileStructure: {} };
  },

  async generateOpenspec(_state) {
    return { openspecFiles: [] };
  },

  async finalize(state) {
    return { success: !state.error };
  },

  async analyzeExistingArchitecture(_state) {
    return {};
  },
};

// ============================================================================
// Routers
// ============================================================================

function afterValidation(state: ArchitectureDesignGraphState): "scenario_route" | "end" {
  return state.error ? "end" : "scenario_route";
}

function scenarioRouter(
  state: ArchitectureDesignGraphState,
): "analyze_requirement" | "analyze_existing" {
  return state.scenario === "modify_existing" ? "analyze_existing" : "analyze_requirement";
}

function shouldRefineOrContinue(
  state: ArchitectureDesignGraphState,
): "refine" | "file_structure" | "end" {
  if (state.error) return "end";
  if (state.needsRefinement && state.refinementIteration < 3) return "refine";
  return "file_structure";
}

function afterRefine(_state: ArchitectureDesignGraphState): "validate" {
  return "validate";
}

// ============================================================================
// Graph Builder
// ============================================================================

/**
 * 创建架构设计工作流图
 */
export function createArchitectureDesignGraph(overrides: ArchitectureDesignNodeOverrides = {}) {
  const n = { ...defaultNodes, ...overrides };

  const workflow = new StateGraph(ArchitectureDesignAnnotation)
    // 节点
    .addNode("validate_input", n.validateInput)
    .addNode("scenario_route", async (s) => s) // pass-through
    .addNode("analyze_requirement", n.analyzeRequirement)
    .addNode("list_features", n.listFeatures)
    .addNode("select_pattern", n.selectPattern)
    .addNode("design_modules", n.designModules)
    .addNode("define_interfaces", n.defineInterfaces)
    .addNode("design_review", n.designReview)
    .addNode("validate_architecture", n.validateArchitecture)
    .addNode("refine_design", n.refineDesign)
    .addNode("design_file_structure", n.designFileStructure)
    .addNode("generate_openspec", n.generateOpenspec)
    .addNode("finalize", n.finalize)
    .addNode("analyze_existing", n.analyzeExistingArchitecture)
    // 边
    .addEdge(START, "validate_input")
    .addConditionalEdges("validate_input", afterValidation, {
      scenario_route: "scenario_route",
      end: END,
    })
    .addConditionalEdges("scenario_route", scenarioRouter, {
      analyze_requirement: "analyze_requirement",
      analyze_existing: "analyze_existing",
    })
    .addEdge("analyze_requirement", "list_features")
    .addEdge("list_features", "select_pattern")
    .addEdge("select_pattern", "design_modules")
    .addEdge("design_modules", "define_interfaces")
    .addEdge("define_interfaces", "design_review")
    .addEdge("design_review", "validate_architecture")
    .addConditionalEdges("validate_architecture", shouldRefineOrContinue, {
      refine: "refine_design",
      file_structure: "design_file_structure",
      end: END,
    })
    .addConditionalEdges("refine_design", afterRefine, {
      validate: "validate_architecture",
    })
    .addEdge("design_file_structure", "generate_openspec")
    .addEdge("generate_openspec", "finalize")
    .addEdge("analyze_existing", "finalize")
    .addEdge("finalize", END);

  return workflow.compile();
}
