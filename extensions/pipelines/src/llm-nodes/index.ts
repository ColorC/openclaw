/**
 * LLM Nodes — 导出
 *
 * 将所有 LLM 驱动的节点工厂函数统一导出。
 * 这些节点通过 ModelProvider + PromptRegistry 调用 LLM，
 * 替换各工作流中的 stub 实现。
 */

// Decomposition nodes
export { createDecomposeNode, createInvestScoringNode } from "./decomposition-nodes.js";
export type { DecompositionNodeDeps } from "./decomposition-nodes.js";

// Architecture nodes
export {
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
} from "./architecture-nodes.js";
export type { ArchitectureNodeDeps } from "./architecture-nodes.js";

// Coder nodes
export { createRecursiveCoderNode, createHandleArgueNode } from "./coder-nodes.js";
export type { CoderNodeDeps } from "./coder-nodes.js";

// Requirement Clarification nodes
export { createRequirementClarificationNode } from "./requirement-clarification-nodes.js";
export type { RequirementClarificationNodeDeps } from "./requirement-clarification-nodes.js";

// OpenSpec generators
export {
  generateDesignMarkdown,
  generateArchitectureTasksMarkdown,
} from "./openspec-generators.js";
