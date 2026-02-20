/**
 * OpenClaw Pipelines Extension
 *
 * Low-supervision software factory with 4 main pipelines:
 * 1. PM Pipeline - Project management and requirement clarification
 * 2. Generation Pipeline - New software generation from specifications
 * 3. Maintenance Pipeline - Bug fixes and feature additions
 * 4. Self-Evolution Pipeline - Autonomous improvement and learning
 *
 * Built on LangGraph.js for workflow orchestration.
 */

import { Type } from "@sinclair/typebox";
import * as path from "node:path";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
// Import OpenSpec utilities
import {
  parseSpecMarkdown,
  parseChangeMarkdown,
  validateSpec,
  validateChange,
  generateSpecMarkdown,
  generateChangeMarkdown,
} from "../../src/pipelines/openspec/index.js";
import { ComplianceChecker } from "./src/compliance/compliance-checker.js";
// Import PM services
import { PMDatabase } from "./src/pm/database.js";
import { QualityGate } from "./src/pm/quality-gate.js";
import { TaskQueueManager } from "./src/pm/task-queue-manager.js";

// Re-export types and utilities for external use
export type { PipelineConfig, StatusCode, WorkflowResult } from "../../src/pipelines/types.js";
export type {
  WorkflowStateBase,
  WorkflowNode,
  WorkflowRouter,
  CompiledWorkflow,
} from "../../src/pipelines/engine/types.js";
export type {
  Spec,
  Change,
  Delta,
  Requirement,
  Scenario,
  Proposal,
  Task,
  TaskGroup,
} from "../../src/pipelines/openspec/index.js";

// Re-export engine utilities
export {
  createBaseStateAnnotation,
  createWorkflowGraph,
  WorkflowGraphBuilder,
  invokeWorkflow,
  START,
  END,
} from "../../src/pipelines/engine/graph-factory.js";

export {
  wrapNode,
  createNodeTracer,
  TokenTracker,
} from "../../src/pipelines/engine/node-wrapper.js";

export {
  CheckpointerManager,
  createDefaultCheckpointer,
} from "../../src/pipelines/engine/checkpointer.js";

// Re-export OpenSpec utilities
export {
  MarkdownParser,
  parseSpecMarkdown,
  parseChangeMarkdown,
  validateSpec,
  validateChange,
  validateProposal,
  generateSpecMarkdown,
  generateChangeMarkdown,
  generateTasksMarkdown,
  // Schemas
  SpecSchema,
  ChangeSchema,
  DeltaSchema,
  RequirementSchema,
  ScenarioSchema,
  ProposalSchema,
  TaskSchema,
  TaskGroupSchema,
} from "../../src/pipelines/openspec/index.js";

// Re-export PM services (imported above for tool factories)
export { PMDatabase, TaskQueueManager, QualityGate, ComplianceChecker };
export type {
  Severity,
  Violation,
  ComplianceReport,
  CheckType,
  ComplianceRule,
} from "./src/compliance/compliance-checker.js";

// Re-export task converter
export {
  parseChecklistLine,
  parseChecklistContent,
  parseParsableContent,
  validateTaskData,
  convertTaskToPmFormat,
  convertTasksToPmBatch,
  formatTaskAsChecklistLine,
  formatTaskAsParsableBlock,
  exportTasksToParsableDocument,
  createDefaultTask,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_CATEGORIES,
  VALID_ESTIMATE_UNITS,
  STATUS_EMOJI_MAP,
  EMOJI_STATUS_MAP,
} from "./src/pm/task-converter.js";
export type {
  TaskData,
  TaskStatus,
  TaskPriority,
  TaskCategory,
  EstimateUnit,
  PmImportData,
} from "./src/pm/task-converter.js";

// Re-export knowledge modules
export { SymidGenerator } from "./src/knowledge/symid-generator.js";
export {
  formatReferencesForParsable,
  formatReferencesForMetadata,
  formatValidationSummary,
  parseReferencesFromParsable,
} from "./src/knowledge/reference-formatter.js";
export { SemanticHeaderInjector } from "./src/knowledge/semantic-header.js";
export { ProjectDocManager } from "./src/knowledge/project-doc-manager.js";
export type {
  OperationResult,
  FileProgressEntry,
  FileHistoryEntry,
  CheckpointData,
} from "./src/knowledge/project-doc-manager.js";

// Re-export workflow builders and types
export {
  createRequirementClarificationGraph,
  clarifyRequirements,
} from "./src/workflows/requirement-clarification.js";
export { createArchitectureDesignGraph } from "./src/workflows/architecture-design.js";
export { createCoderGraph } from "./src/workflows/coder.js";
export type {
  RequirementClarificationState,
  ArchitectureDesignState,
  CoderState,
  ToolCall,
  ToolResult,
  FeatureDefinition,
  ModuleDefinition,
  InterfaceDefinition,
  CodeContext,
  QualityIndicators,
  ValidationResult as CoderValidationResult,
} from "./src/workflows/states.js";

// Re-export self-iteration modules
export { FailureCollector } from "./src/self-iteration/failure-collector.js";
export { KPICollector } from "./src/self-iteration/kpi-collector.js";
export { LineageTracker } from "./src/self-iteration/lineage-tracker.js";
export { PatchDatabase } from "./src/self-iteration/patch-database.js";
export { ArgueManager } from "./src/self-iteration/argue-manager.js";

// Re-export maintenance modules
export { createRequirementDecompositionGraph } from "./src/maintenance/requirement-decomposition.js";
export {
  createArchitectureExplorationGraph,
  exploreArchitecture,
} from "./src/maintenance/architecture-exploration.js";
export { createDocumentOrganizationGraph } from "./src/maintenance/document-organization.js";

// Re-export adapters
export {
  taskStatusToRequirementStatus,
  requirementStatusToTaskStatus,
  isTerminalStatus,
  convertInvestScore,
  importDecompositionResults,
  decompositionToArchitectureInput,
  requirementTreeToText,
  modulesToTasks,
  publishArchitectureTasks,
  updateRequirementFromCoder,
  evaluateCoderResult,
  extractFilePaths,
  annotateDiscoveredFiles,
  saveExplorationToProjectDocs,
  annotationsToDiscoveredFiles,
  synthesizeWikiPages,
} from "./src/adapters/index.js";

// Re-export chains
export { createChainContext, disposeChainContext } from "./src/chains/chain-context.js";
export { createChainAGraph } from "./src/chains/chain-a-development.js";
export { createChainBGraph } from "./src/chains/chain-b-wiki.js";
export { createChainCGraph, runIterationCycle } from "./src/chains/chain-c-iteration.js";
export { withStepHook } from "./src/chains/step-hook.js";

/**
 * Empty config schema helper
 */
function emptyPluginConfigSchema() {
  return {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  };
}

/**
 * Pipeline run tool
 *
 * Execute a pipeline with the given input
 */
function createPipelineRunTool(api: OpenClawPluginApi) {
  return {
    name: "pipeline_run",
    label: "Run Pipeline",
    description:
      "Execute a pipeline workflow. Available pipelines: pm (requirement clarification), generate (software generation), maintain (bug fixes/features), evolve (self-improvement).",
    parameters: Type.Object({
      pipeline: Type.Union([
        Type.Literal("pm"),
        Type.Literal("generate"),
        Type.Literal("maintain"),
        Type.Literal("evolve"),
      ]),
      input: Type.Record(Type.String(), Type.Unknown()),
      threadId: Type.Optional(Type.String()),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { pipeline, input, threadId } = params as {
        pipeline: "pm" | "generate" | "maintain" | "evolve";
        input: Record<string, unknown>;
        threadId?: string;
      };

      try {
        // TODO: Implement actual pipeline execution
        // For now, return a placeholder response
        const pipelineNames = {
          pm: "PM Pipeline (Requirement Clarification)",
          generate: "Generation Pipeline (Software Generation)",
          maintain: "Maintenance Pipeline (Bug Fixes & Features)",
          evolve: "Self-Evolution Pipeline (Improvement & Learning)",
        };

        api.logger.info(`Running ${pipeline} pipeline`);

        return {
          content: [
            {
              type: "text" as const,
              text: `${pipelineNames[pipeline]} executed successfully.\n\nInput: ${JSON.stringify(input, null, 2)}\n\nStatus: SUCCESS\n\nNote: Pipeline execution is a placeholder. Implement the actual pipeline logic in src/pipelines/pipelines/${pipeline}/`,
            },
          ],
          details: {
            pipeline,
            status: "SUCCESS",
            threadId: threadId || `thread-${Date.now()}`,
          },
        };
      } catch (error) {
        api.logger.error(
          `Pipeline ${pipeline} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: {
            pipeline,
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

/**
 * OpenSpec create tool
 *
 * Create OpenSpec documents (Spec or Change)
 */
function createOpenSpecTool(api: OpenClawPluginApi) {
  return {
    name: "openspec_create",
    label: "Create OpenSpec",
    description:
      'Create OpenSpec documents. Use type="spec" for requirement specifications or type="change" for change proposals.',
    parameters: Type.Object({
      type: Type.Union([Type.Literal("spec"), Type.Literal("change")]),
      name: Type.String({ description: "Document name" }),
      content: Type.String({ description: "Markdown content" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { type, name, content } = params as {
        type: "spec" | "change";
        name: string;
        content: string;
      };

      try {
        if (type === "spec") {
          const spec = parseSpecMarkdown(content, name);
          validateSpec(spec);
          api.logger.info(`Created OpenSpec spec: ${name}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `OpenSpec Spec created successfully:\n\n${generateSpecMarkdown(spec)}`,
              },
            ],
            details: { type: "spec", name, spec },
          };
        } else {
          const change = parseChangeMarkdown(content, name);
          validateChange(change);
          api.logger.info(`Created OpenSpec change: ${name}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `OpenSpec Change created successfully:\n\n${generateChangeMarkdown(change)}`,
              },
            ],
            details: { type: "change", name, change },
          };
        }
      } catch (error) {
        api.logger.error(
          `OpenSpec creation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `OpenSpec creation failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: {
            type,
            name,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

/**
 * Pipeline status tool
 *
 * Check the status of running or completed pipelines
 */
function createPipelineStatusTool(api: OpenClawPluginApi) {
  return {
    name: "pipeline_status",
    label: "Pipeline Status",
    description: "Check the status of a pipeline execution by thread ID.",
    parameters: Type.Object({
      threadId: Type.String({ description: "Thread ID of the pipeline execution" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { threadId } = params as { threadId: string };

      // TODO: Implement actual status check using checkpointer
      api.logger.info(`Checking pipeline status for thread: ${threadId}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Pipeline status for thread ${threadId}:\n\nStatus: Not implemented yet\n\nThe checkpointer integration will be added in a future update.`,
          },
        ],
        details: {
          threadId,
          status: "UNKNOWN",
        },
      };
    },
  };
}

// ============================================================================
// PM & Compliance Tool Factories
// ============================================================================

/** Shared state for PM database instances */
let pmDb: PMDatabase | null = null;

function getPMDatabase(api: OpenClawPluginApi): PMDatabase {
  if (!pmDb) {
    const config = api.pluginConfig as { dbPath?: string } | undefined;
    const dbPath = config?.dbPath || path.join(process.cwd(), ".openclaw", "pm.db");
    pmDb = new PMDatabase(dbPath);
    api.logger.info(`PM database initialized at ${dbPath}`);
  }
  return pmDb;
}

/**
 * PM requirement management tool
 */
function createPMManageTool(api: OpenClawPluginApi) {
  return {
    name: "pm_manage",
    label: "PM Manage",
    description:
      "Manage project requirements: create, read, update, delete requirements. Also handles dependencies, arguments, comments, and statistics.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("get"),
        Type.Literal("list"),
        Type.Literal("update"),
        Type.Literal("update_status"),
        Type.Literal("delete"),
        Type.Literal("tree"),
        Type.Literal("add_dependency"),
        Type.Literal("get_dependencies"),
        Type.Literal("log_argument"),
        Type.Literal("add_comment"),
        Type.Literal("get_comments"),
        Type.Literal("stats"),
      ]),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { action, data = {} } = params as { action: string; data?: Record<string, unknown> };
      const db = getPMDatabase(api);

      try {
        switch (action) {
          case "create": {
            const req = db.createRequirement(
              data as Parameters<PMDatabase["createRequirement"]>[0],
            );
            return {
              content: [{ type: "text" as const, text: `Requirement created: ${req.id}` }],
              details: req,
            };
          }
          case "get": {
            const req = db.getRequirement(data.id as string);
            if (!req)
              return {
                content: [{ type: "text" as const, text: `Requirement not found: ${data.id}` }],
                details: null,
              };
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Requirement: ${req.id} [${req.status}] ${req.description}`,
                },
              ],
              details: req,
            };
          }
          case "list": {
            const reqs = db.getAllRequirements(
              data as Parameters<PMDatabase["getAllRequirements"]>[0],
            );
            return {
              content: [{ type: "text" as const, text: `Found ${reqs.length} requirements` }],
              details: reqs,
            };
          }
          case "update": {
            const { id, ...updates } = data as { id: string; [k: string]: unknown };
            const req = db.updateRequirement(id, updates);
            return {
              content: [{ type: "text" as const, text: `Requirement updated: ${id}` }],
              details: req,
            };
          }
          case "update_status": {
            const req = db.updateRequirementStatus(
              data.id as string,
              data.status as Parameters<PMDatabase["updateRequirementStatus"]>[1],
              data.assignedAgent as string | undefined,
            );
            return {
              content: [
                { type: "text" as const, text: `Status updated: ${data.id} → ${data.status}` },
              ],
              details: req,
            };
          }
          case "delete": {
            const ok = db.deleteRequirement(data.id as string);
            return {
              content: [
                {
                  type: "text" as const,
                  text: ok ? `Deleted: ${data.id}` : `Not found: ${data.id}`,
                },
              ],
              details: { deleted: ok },
            };
          }
          case "tree": {
            const tree = db.getRequirementTree(data.rootId as string | undefined);
            return {
              content: [{ type: "text" as const, text: `Requirement tree: ${tree.length} nodes` }],
              details: tree,
            };
          }
          case "add_dependency": {
            const dep = db.createDependency(
              data.source as string,
              data.target as string,
              (data.type as "blocking" | "related" | "optional") ?? "blocking",
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dependency added: ${data.source} → ${data.target}`,
                },
              ],
              details: dep,
            };
          }
          case "get_dependencies": {
            const deps = db.getDependencies(data.id as string);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dependencies for ${data.id}: ${deps.blocking.length} blocking, ${deps.blockedBy.length} blocked-by`,
                },
              ],
              details: deps,
            };
          }
          case "log_argument": {
            const arg = db.logArgument(data as Parameters<PMDatabase["logArgument"]>[0]);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Argument logged between ${data.sourceRequirementId} and ${data.targetRequirementId}`,
                },
              ],
              details: arg,
            };
          }
          case "add_comment": {
            const comment = db.addComment(data as Parameters<PMDatabase["addComment"]>[0]);
            return {
              content: [{ type: "text" as const, text: `Comment added to ${data.requirementId}` }],
              details: comment,
            };
          }
          case "get_comments": {
            const comments = db.getComments(data.id as string);
            return {
              content: [
                { type: "text" as const, text: `${comments.length} comments for ${data.id}` },
              ],
              details: comments,
            };
          }
          case "stats": {
            const stats = db.getStats(data.projectId as string | undefined);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Stats: ${stats.total} total, ${stats.pending} pending, ${stats.inProgress} in-progress, ${stats.completed} completed`,
                },
              ],
              details: stats,
            };
          }
          default:
            return {
              content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
              details: null,
            };
        }
      } catch (error) {
        api.logger.error(
          `pm_manage ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Task queue management tool
 */
function createPMQueueTool(api: OpenClawPluginApi) {
  return {
    name: "pm_queue",
    label: "Task Queue",
    description:
      "Manage the task execution queue: publish, list, get next, update status, reorder, batch operations.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("publish"),
        Type.Literal("list"),
        Type.Literal("next"),
        Type.Literal("get"),
        Type.Literal("update_status"),
        Type.Literal("update"),
        Type.Literal("reorder"),
        Type.Literal("remove"),
        Type.Literal("batch_remove"),
        Type.Literal("clear_completed"),
        Type.Literal("stats"),
      ]),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const { action, data = {} } = params as { action: string; data?: Record<string, unknown> };
      const db = getPMDatabase(api);
      const queue = new TaskQueueManager(db);

      try {
        switch (action) {
          case "publish": {
            const task = queue.publishTask(
              data as unknown as Parameters<TaskQueueManager["publishTask"]>[0],
            );
            return {
              content: [{ type: "text" as const, text: `Task published: ${task.id}` }],
              details: task,
            };
          }
          case "list": {
            const tasks = queue.listQueue(data as Parameters<TaskQueueManager["listQueue"]>[0]);
            return {
              content: [{ type: "text" as const, text: `Queue: ${tasks.length} tasks` }],
              details: tasks,
            };
          }
          case "next": {
            const task = queue.getNextTask();
            if (!task)
              return {
                content: [{ type: "text" as const, text: "No pending tasks in queue" }],
                details: null,
              };
            return {
              content: [
                { type: "text" as const, text: `Next task: ${task.id} — ${task.description}` },
              ],
              details: task,
            };
          }
          case "get": {
            const task = queue.getTask(data.taskId as string);
            if (!task)
              return {
                content: [{ type: "text" as const, text: `Task not found: ${data.taskId}` }],
                details: null,
              };
            return {
              content: [{ type: "text" as const, text: `Task: ${task.id} [${task.status}]` }],
              details: task,
            };
          }
          case "update_status": {
            const task = queue.updateTaskStatus(
              data.taskId as string,
              data.status as Parameters<TaskQueueManager["updateTaskStatus"]>[1],
              data.result as Record<string, unknown> | undefined,
              data.error as string | undefined,
              data.executionTime as number | undefined,
            );
            return {
              content: [{ type: "text" as const, text: `Task ${data.taskId} → ${data.status}` }],
              details: task,
            };
          }
          case "update": {
            const task = queue.updateTask(
              data.taskId as string,
              data as Parameters<TaskQueueManager["updateTask"]>[1],
            );
            return {
              content: [{ type: "text" as const, text: `Task updated: ${data.taskId}` }],
              details: task,
            };
          }
          case "reorder": {
            const task = queue.reorderByPosition(data.taskId as string, data.position as number);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Task ${data.taskId} moved to position ${data.position}`,
                },
              ],
              details: task,
            };
          }
          case "remove": {
            const ok = queue.removeTask(data.taskId as string);
            return {
              content: [
                {
                  type: "text" as const,
                  text: ok ? `Removed: ${data.taskId}` : `Not found: ${data.taskId}`,
                },
              ],
              details: { removed: ok },
            };
          }
          case "batch_remove": {
            const count = queue.batchRemove(data.taskIds as string[]);
            return {
              content: [{ type: "text" as const, text: `Removed ${count} tasks` }],
              details: { removed: count },
            };
          }
          case "clear_completed": {
            const count = queue.clearCompleted();
            return {
              content: [{ type: "text" as const, text: `Cleared ${count} completed tasks` }],
              details: { cleared: count },
            };
          }
          case "stats": {
            const stats = queue.getQueueStats(data.projectId as string | undefined);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Queue: ${stats.total} total, ${stats.pending} pending, ${stats.inProgress} active`,
                },
              ],
              details: stats,
            };
          }
          default:
            return {
              content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
              details: null,
            };
        }
      } catch (error) {
        api.logger.error(
          `pm_queue ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Quality gate evaluation tool
 */
function createQualityGateTool(api: OpenClawPluginApi) {
  return {
    name: "pm_quality",
    label: "Quality Gate",
    description:
      "Evaluate requirement quality across 6 dimensions: INVEST, SMART, coverage, performance, documentation, and contract compliance.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("evaluate"), Type.Literal("set_threshold")]),
      requirementId: Type.Optional(Type.String()),
      dimension: Type.Optional(Type.String()),
      value: Type.Optional(Type.Number()),
      thresholds: Type.Optional(Type.Record(Type.String(), Type.Number())),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const db = getPMDatabase(api);
      const config = api.pluginConfig as { qualityThresholds?: Record<string, number> } | undefined;
      const gate = new QualityGate(db, {
        ...config?.qualityThresholds,
        ...(params.thresholds as Record<string, number> | undefined),
      });

      try {
        if (params.action === "set_threshold") {
          gate.setThreshold(
            params.dimension as
              | "invest"
              | "smart"
              | "coverage"
              | "performance"
              | "documentation"
              | "contract",
            params.value as number,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `Threshold ${params.dimension} set to ${params.value}`,
              },
            ],
            details: { dimension: params.dimension, value: params.value },
          };
        }

        const result = gate.evaluate(params.requirementId as string);
        const scoreText = Object.entries(result.scores)
          .map(([k, v]) => `${k}: ${((v as number) * 100).toFixed(0)}%`)
          .join(", ");

        return {
          content: [
            {
              type: "text" as const,
              text: `Quality: ${result.passed ? "PASSED" : "FAILED"}\nScores: ${scoreText}${result.blockingIssues.length > 0 ? "\nBlocking: " + result.blockingIssues.join("; ") : ""}`,
            },
          ],
          details: result,
        };
      } catch (error) {
        api.logger.error(
          `pm_quality failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Compliance checker tool
 */
function createComplianceCheckTool(api: OpenClawPluginApi) {
  return {
    name: "compliance_check",
    label: "Compliance Check",
    description:
      "Run architecture compliance checks: directory structure validation, LLM SDK usage, workflow location, logging practices.",
    parameters: Type.Object({
      checkType: Type.Optional(
        Type.Union([
          Type.Literal("all"),
          Type.Literal("structure"),
          Type.Literal("infra"),
          Type.Literal("tool"),
          Type.Literal("workflow"),
        ]),
      ),
      targetFile: Type.Optional(
        Type.String({ description: "Relative path to check a single file" }),
      ),
      quick: Type.Optional(Type.Boolean({ description: "Quick mode: only critical checks" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const checker = new ComplianceChecker(process.cwd());

      try {
        const report = checker.run({
          checkType: params.checkType as
            | "all"
            | "structure"
            | "infra"
            | "tool"
            | "workflow"
            | undefined,
          targetFile: params.targetFile as string | undefined,
          quick: params.quick as boolean | undefined,
        });

        return {
          content: [{ type: "text" as const, text: checker.formatReport(report) }],
          details: report,
        };
      } catch (error) {
        api.logger.error(
          `compliance_check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Pipelines Plugin Definition
 */
const plugin = {
  id: "pipelines",
  name: "Pipelines",
  description:
    "Low-supervision software factory: PM, Generation, Maintenance, Self-Evolution pipelines",
  version: "2026.2.15-1",
  configSchema: emptyPluginConfigSchema(),

  async register(api: OpenClawPluginApi) {
    api.logger.info("Pipelines extension registering...");

    // Register pipeline tools
    api.registerTool((_ctx) => createPipelineRunTool(api), { optional: true });
    api.registerTool((_ctx) => createOpenSpecTool(api), { optional: true });
    api.registerTool((_ctx) => createPipelineStatusTool(api), { optional: true });

    // Register PM tools
    api.registerTool((_ctx) => createPMManageTool(api), { optional: true });
    api.registerTool((_ctx) => createPMQueueTool(api), { optional: true });
    api.registerTool((_ctx) => createQualityGateTool(api), { optional: true });

    // Register compliance tool
    api.registerTool((_ctx) => createComplianceCheckTool(api), { optional: true });

    // Register service for lifecycle management
    api.registerService({
      id: "pipelines",
      async start() {
        api.logger.info("Pipelines service starting");
        const config = api.pluginConfig as {
          enableCheckpoint?: boolean;
          checkpointPath?: string;
        };
        if (config?.enableCheckpoint !== false) {
          api.logger.info("Checkpointing enabled");
        }
      },
      async stop() {
        api.logger.info("Pipelines service stopping");
        // Close PM database
        if (pmDb) {
          pmDb.close();
          pmDb = null;
          api.logger.info("PM database closed");
        }
        // Close all checkpointers
        const { CheckpointerManager } = await import("../../src/pipelines/engine/checkpointer.js");
        CheckpointerManager.closeAll();
      },
    });

    // Register lifecycle hooks
    api.on("session_start", async (event) => {
      api.logger.debug?.(`Session started, pipelines ready: ${event.sessionId}`);
    });

    api.on("session_end", async (event) => {
      api.logger.debug?.(`Session ended, cleaning up pipelines: ${event.sessionId}`);
    });

    api.logger.info("Pipelines extension registered successfully");
  },
};

export default plugin;
