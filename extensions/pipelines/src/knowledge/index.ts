/**
 * Knowledge 模块导出
 */

export { SymidGenerator } from "./symid-generator.js";
export type { SymidType, ParsedSymid } from "./symid-generator.js";

export {
  formatReferencesForParsable,
  formatReferencesForMetadata,
  formatValidationSummary,
  parseReferencesFromParsable,
} from "./reference-formatter.js";
export type {
  ReferenceBlock,
  References,
  ParsedReference,
  ValidationResult as ReferenceValidationResult,
} from "./reference-formatter.js";

export { SemanticHeaderInjector } from "./semantic-header.js";
export type { SemanticHeaderData, InjectionResult } from "./semantic-header.js";

export { ProjectDocManager } from "./project-doc-manager.js";
export type {
  OperationResult,
  FileProgressEntry,
  FileHistoryEntry,
  PlanProgress,
  CheckpointData,
} from "./project-doc-manager.js";
