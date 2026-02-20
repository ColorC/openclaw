/**
 * 适配器层导出
 */

export {
  taskStatusToRequirementStatus,
  requirementStatusToTaskStatus,
  isTerminalStatus,
  needsIntervention,
} from "./status-enums.js";

export {
  convertInvestScore,
  subRequirementToCreateParams,
  importDecompositionResults,
} from "./decomposition-to-pm.js";

export {
  requirementTreeToText,
  decompositionToArchitectureInput,
} from "./requirement-to-architecture.js";

export {
  moduleToTask,
  interfaceToTasks,
  modulesToTasks,
  publishArchitectureTasks,
} from "./architecture-to-tasks.js";
export type { TaskGenerationOptions } from "./architecture-to-tasks.js";

export { updateRequirementFromCoder, evaluateCoderResult } from "./coder-to-quality.js";

export {
  extractFilePaths,
  annotateDiscoveredFiles,
  saveExplorationToProjectDocs,
} from "./exploration-to-knowledge.js";
export type { FileAnnotation } from "./exploration-to-knowledge.js";

export {
  annotationsToDiscoveredFiles,
  wikiPagesToDiscoveredFiles,
  synthesizeWikiPages,
} from "./knowledge-to-wiki.js";
