/**
 * Testing module — UX Agent for automated workflow testing
 *
 * Provides agent-vs-agent testing: a UX Agent simulates a real user
 * interacting with target workflows and generates structured reports.
 */

export {
  WorkflowRunner,
  type WorkflowExecution,
  type WaitResult,
  type InteractionEntry,
} from "./workflow-runner.js";
export { ReportBuilder, type UXReportFields } from "./report-builder.js";
export { createUxTools, type UxToolsDeps, type FinishSignal } from "./ux-tools.js";
export { runUxTest, type UXAgentConfig, type UXTestResult } from "./ux-agent.js";
