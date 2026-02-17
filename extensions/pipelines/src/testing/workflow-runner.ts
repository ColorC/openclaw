/**
 * WorkflowRunner - Interactive workflow controller for UX testing
 *
 * Controls the requirement clarification pipeline in interactive mode,
 * allowing the UX Agent to send/receive messages turn by turn.
 *
 * Replaces Python's WorkflowRunner (InputInterceptor + EventBus)
 * with a simpler Promise-based mechanism using onClarificationTurn.
 *
 * Source: _personal_copilot/src/tools/user_experience/workflow_runner.py
 */

import type { ChainContext } from "../chains/chain-context.js";
import type { DevPipelineConfig } from "../chains/chain-dev-pipeline.js";
import { createDevPipelineGraph } from "../chains/chain-dev-pipeline.js";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowExecution {
  workflowId: string;
  target: string;
  status: "pending" | "running" | "waiting_input" | "completed" | "error";
  currentPrompt?: string;
  error?: string;
  output: string[];
  interactionHistory: Array<{ prompt: string; response: string }>;
  startTime: number;
  endTime?: number;
  /** The background promise running the pipeline graph */
  runPromise?: Promise<void>;
}

export interface WaitResult {
  status: WorkflowExecution["status"];
  prompt?: string;
  output?: string;
  error?: string;
}

export interface InteractionEntry {
  prompt: string;
  response: string;
}

// ============================================================================
// WorkflowRunner
// ============================================================================

export class WorkflowRunner {
  private executions = new Map<string, WorkflowExecution>();
  private pendingResolvers = new Map<string, (input: string | null) => void>();
  private latestId: string | undefined;

  /**
   * Start an interactive workflow.
   *
   * Launches the dev pipeline graph in interactive mode. The
   * `onClarificationTurn` callback pauses at each turn, waiting for
   * `sendResponse()` to provide the next user input.
   */
  start(
    target: string,
    ctx: ChainContext,
    config?: DevPipelineConfig,
    userRequirement?: string,
  ): string {
    const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const execution: WorkflowExecution = {
      workflowId,
      target,
      status: "running",
      output: [],
      interactionHistory: [],
      startTime: Date.now(),
    };

    this.executions.set(workflowId, execution);
    this.latestId = workflowId;

    // Build interactive config with our onClarificationTurn callback
    const interactiveConfig: DevPipelineConfig = {
      ...config,
      clarification: {
        ...config?.clarification,
        interactive: true,
        onClarificationTurn: async (response: string, isComplete: boolean) => {
          if (isComplete) {
            execution.output.push(response);
            execution.status = "completed";
            execution.endTime = Date.now();
            return null; // Signal completion
          }

          // Store agent response and pause
          execution.currentPrompt = response;
          execution.output.push(response);
          execution.status = "waiting_input";

          // Wait for sendResponse() to provide input
          return new Promise<string | null>((resolve) => {
            this.pendingResolvers.set(workflowId, resolve);
          });
        },
      },
    };

    // Launch graph in background (don't await)
    const graph = createDevPipelineGraph(ctx, interactiveConfig);
    execution.runPromise = graph
      .invoke({
        userRequirement: userRequirement ?? target,
        scenario: "new_project" as const,
      })
      .then(() => {
        if (execution.status !== "error") {
          execution.status = "completed";
          execution.endTime = Date.now();
        }
      })
      .catch((err: Error) => {
        execution.status = "error";
        execution.error = err.message;
        execution.endTime = Date.now();
        // Also resolve any pending resolver to unblock waitForInput
        const resolver = this.pendingResolvers.get(workflowId);
        if (resolver) {
          resolver(null);
          this.pendingResolvers.delete(workflowId);
        }
      });

    return workflowId;
  }

  /**
   * Wait for the workflow to request input or complete.
   */
  async waitForInput(workflowId: string, timeout = 60): Promise<WaitResult> {
    const execution = this.executions.get(workflowId);
    if (!execution) {
      return { status: "error", error: `Workflow ${workflowId} not found` };
    }

    // Already waiting or terminal
    if (execution.status === "waiting_input") {
      return {
        status: "waiting_input",
        prompt: execution.currentPrompt,
        output: execution.output.join("\n"),
      };
    }

    if (execution.status === "completed" || execution.status === "error") {
      return {
        status: execution.status,
        error: execution.error,
        output: execution.output.join("\n"),
      };
    }

    // Poll until status changes
    const pollInterval = 100; // ms
    const maxPolls = Math.ceil((timeout * 1000) / pollInterval);

    for (let i = 0; i < maxPolls; i++) {
      await sleep(pollInterval);

      if (execution.status === "waiting_input") {
        return {
          status: "waiting_input",
          prompt: execution.currentPrompt,
          output: execution.output.join("\n"),
        };
      }

      if (execution.status === "completed" || execution.status === "error") {
        return {
          status: execution.status,
          error: execution.error,
          output: execution.output.join("\n"),
        };
      }
    }

    return {
      status: "running",
      output: execution.output.join("\n"),
      error: `Timed out after ${timeout}s without input request`,
    };
  }

  /**
   * Send a response to a workflow waiting for input.
   * Then wait for the next input request or completion.
   */
  async sendResponse(workflowId: string, response: string, waitTimeout = 60): Promise<WaitResult> {
    const resolvedId = this.resolveId(workflowId);
    const execution = this.executions.get(resolvedId);
    if (!execution) {
      return { status: "error", error: `Workflow ${resolvedId} not found` };
    }

    if (execution.status !== "waiting_input") {
      return {
        status: execution.status,
        error: `Workflow is ${execution.status}, cannot send input`,
      };
    }

    // Record interaction
    execution.interactionHistory.push({
      prompt: execution.currentPrompt ?? "",
      response,
    });

    // Resolve the pending onClarificationTurn promise
    execution.status = "running";
    execution.currentPrompt = undefined;

    const resolver = this.pendingResolvers.get(resolvedId);
    if (resolver) {
      resolver(response);
      this.pendingResolvers.delete(resolvedId);
    }

    // Wait for next input request or completion
    return this.waitForInput(resolvedId, waitTimeout);
  }

  /**
   * Get current status of a workflow.
   */
  getStatus(workflowId: string): WaitResult {
    const resolvedId = this.resolveId(workflowId);
    const execution = this.executions.get(resolvedId);
    if (!execution) {
      return { status: "error", error: `Workflow ${resolvedId} not found` };
    }

    return {
      status: execution.status,
      prompt: execution.currentPrompt,
      output: execution.output.join("\n"),
      error: execution.error,
    };
  }

  /**
   * Stop a running workflow.
   */
  stop(workflowId: string): WaitResult {
    const resolvedId = this.resolveId(workflowId);
    const execution = this.executions.get(resolvedId);
    if (!execution) {
      return { status: "error", error: `Workflow ${resolvedId} not found` };
    }

    if (execution.status === "completed" || execution.status === "error") {
      return { status: execution.status, error: execution.error };
    }

    // If waiting for input, cancel it
    const resolver = this.pendingResolvers.get(resolvedId);
    if (resolver) {
      resolver(null); // null signals cancellation
      this.pendingResolvers.delete(resolvedId);
    }

    execution.status = "error";
    execution.error = "Stopped by user";
    execution.endTime = Date.now();

    return { status: "error", error: "Workflow stopped" };
  }

  /**
   * Get interaction history for a workflow.
   */
  getInteractionHistory(workflowId: string): InteractionEntry[] {
    const resolvedId = this.resolveId(workflowId);
    const execution = this.executions.get(resolvedId);
    return execution?.interactionHistory ?? [];
  }

  /**
   * Get all interaction history across all workflows.
   */
  getAllHistory(): InteractionEntry[] {
    const entries: InteractionEntry[] = [];
    for (const execution of this.executions.values()) {
      entries.push(...execution.interactionHistory);
    }
    return entries;
  }

  /**
   * Get count of active (running/waiting) workflows.
   */
  getActiveCount(): number {
    let count = 0;
    for (const execution of this.executions.values()) {
      if (execution.status === "running" || execution.status === "waiting_input") {
        count++;
      }
    }
    return count;
  }

  /**
   * Get the most recent workflow ID.
   */
  getLatestId(): string {
    if (!this.latestId) {
      throw new Error("No workflows have been started");
    }
    return this.latestId;
  }

  /**
   * Resolve "auto"/"latest" to actual workflow ID.
   */
  private resolveId(workflowId: string): string {
    if (workflowId === "auto" || workflowId === "latest") {
      return this.getLatestId();
    }
    return workflowId;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
