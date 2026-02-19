/**
 * Coder LLM Nodes
 *
 * 用 createAgentRunner (OpenClaw agentLoop) 替换手动 agent 循环。
 * 2 个节点:
 * - recursiveCoder: Agent 循环——使用文件工具自由创建/编辑文件
 * - handleArgue: 质量决策（retry/accept/argue）
 */

import * as fs from "node:fs";
import type { ModelProvider, ToolDefinition } from "../llm/types.js";
import type { ModelProviderConfig } from "../llm/types.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { CoderGraphState } from "../workflows/coder.js";
import { createAgentRunner } from "../llm/agent-adapter.js";
import { createCoderTools, type CoderCompletionInfo } from "./coder-tools.js";

// ============================================================================
// Deps
// ============================================================================

export interface CoderNodeDeps {
  modelProvider: ModelProvider;
  promptRegistry: PromptRegistry;
  /** Workspace root — file operations are relative to this */
  workspaceRoot?: string;
  /** ModelProviderConfig — needed to create AgentRunner */
  modelProviderConfig?: ModelProviderConfig;
}

// ============================================================================
// Helper
// ============================================================================

function extractToolCalls(response: {
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}): Array<{ name: string; arguments: Record<string, unknown> }> {
  return response.toolCalls ?? [];
}

// ============================================================================
// Decide Action Tool (for handleArgue)
// ============================================================================

const decideActionTool: ToolDefinition = {
  name: "decide_action",
  description: "Return the decision for handling quality issues",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["retry", "accept", "argue"] },
      reason: { type: "string", description: "Explanation for the decision" },
      suggestedAction: { type: "string", description: "For argue: what should change" },
    },
    required: ["action", "reason"],
  },
};

// ============================================================================
// recursiveCoder Node — Agent Loop via createAgentRunner
// ============================================================================

export function createRecursiveCoderNode(deps: CoderNodeDeps) {
  return async (state: CoderGraphState): Promise<Partial<CoderGraphState>> => {
    const { promptRegistry } = deps;

    // Determine allowed directory
    const allowedDir = state.codeContext.allowedDir ?? deps.workspaceRoot ?? process.cwd();

    if (!state.codeContext.allowedDir) {
      console.warn(
        `[coder] ⚠ codeContext.allowedDir is not set! Falling back to ${allowedDir}. ` +
          `This may cause files to be written to an unexpected location. ` +
          `Set codeContext.allowedDir explicitly.`,
      );
    }

    // Ensure allowed directory exists
    fs.mkdirSync(allowedDir, { recursive: true });

    // Determine mode
    const hasErrors = state.codeContext.errorReports?.length;
    const modeInstruction = hasErrors
      ? "Fix the code based on the error reports below. Read the existing files first, then use edit_file to make targeted changes."
      : "Implement the task by creating files using write_file. Organize your code as you see fit within the allowed directory.";

    // Error context
    const errorContext = hasErrors
      ? `Errors to fix:\n${state.codeContext.errorReports!.map((e) => `- ${e.file}:${e.line ?? ""} ${e.message} (${e.type})`).join("\n")}`
      : "";

    const codeContextJson = JSON.stringify({
      skeleton: state.codeContext.skeleton,
      test: state.codeContext.test,
      requirements: state.codeContext.requirements,
    });

    const directoryConstraint = `All files must be created within: \`${allowedDir}\``;

    // Build system prompt from template
    const messages = promptRegistry.buildMessages(
      "coder/recursive-coder",
      {
        mode_instruction: modeInstruction,
        task_description: state.taskDescription,
        code_context_json: codeContextJson,
        iteration: String(state.iterationCount + 1),
        max_iterations: String(state.maxIterations),
        error_context: errorContext,
        directory_constraint: directoryConstraint,
      },
      state.taskDescription,
    );

    // Extract system prompt (first message) and user message (last message)
    const systemPrompt =
      messages.length > 0 && (messages[0] as { role?: string }).role === "system"
        ? String((messages[0] as { content?: string }).content ?? "")
        : "";
    const userMessage =
      messages.length > 1
        ? String((messages[messages.length - 1] as { content?: string }).content ?? "")
        : state.taskDescription;

    // Completion tracker — coder_done tool writes here
    const completion: CoderCompletionInfo = {
      done: false,
      summary: "",
      createdFiles: [],
      modifiedFiles: [],
      qualityScore: 0.5,
    };

    // Create tools
    const tools = createCoderTools(allowedDir, completion);

    // Try agentRunner path (preferred), fall back to manual loop
    if (deps.modelProviderConfig) {
      // ── AgentRunner path (full OpenClaw agentLoop integration) ──
      const runner = createAgentRunner({
        ...deps.modelProviderConfig,
        cwd: allowedDir,
      });

      // AbortController to stop agent loop when coder_done is called
      const abortController = new AbortController();

      // Wrap coder_done to also abort the agent loop
      const wrappedTools = tools.map((t) => {
        if (t.name !== "coder_done") return t;
        return {
          ...t,
          execute: async (args: Record<string, unknown>) => {
            const result = await t.execute(args);
            // Signal agent loop to stop
            abortController.abort();
            return result;
          },
        };
      });

      const result = await runner.run(systemPrompt, userMessage, wrappedTools, {
        temperature: 0.3,
        signal: abortController.signal,
        cwd: allowedDir,
      });

      // If coder_done was not called, extract info from tool calls
      if (!completion.done) {
        completion.summary =
          result.finalResponse || `Agent completed ${result.toolCalls.length} tool calls`;
        // Infer files from tool call records
        for (const tc of result.toolCalls) {
          const args = tc.args as Record<string, unknown>;
          if (tc.name === "write_file" && args.path) {
            completion.createdFiles.push(args.path as string);
          } else if (tc.name === "edit_file" && args.path) {
            completion.modifiedFiles.push(args.path as string);
          }
        }
      }
    } else {
      // ── Fallback: manual chatWithTools loop ──
      await runManualAgentLoop(deps, messages, tools, completion, allowedDir);
    }

    // Deduplicate file lists
    const uniqueCreated = [...new Set(completion.createdFiles)];
    const uniqueModified = [...new Set(completion.modifiedFiles)];
    const passed = completion.qualityScore >= state.qualityThreshold;

    return {
      iterationCount: state.iterationCount + 1,
      currentCode:
        completion.summary ||
        `Created ${uniqueCreated.length} files, modified ${uniqueModified.length} files`,
      qualityScore: completion.qualityScore,
      qualityHistory: [...(state.qualityHistory ?? []), completion.qualityScore],
      modifiedFiles: [...uniqueCreated, ...uniqueModified],
      implementationSummary: completion.summary,
      validationResult: {
        passed,
        errors: passed
          ? []
          : [`Quality score ${completion.qualityScore} < threshold ${state.qualityThreshold}`],
        warnings: [],
      },
    };
  };
}

// ============================================================================
// Manual Agent Loop Fallback (when modelProviderConfig is not available)
// ============================================================================

async function runManualAgentLoop(
  deps: CoderNodeDeps,
  messages: any[],
  tools: ReturnType<typeof createCoderTools>,
  completion: CoderCompletionInfo,
  _allowedDir: string,
): Promise<void> {
  const { modelProvider } = deps;
  const MAX_AGENT_TURNS = 20;

  // Convert PipelineAgentTool[] to ToolDefinition[] for chatWithTools
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const conversationMessages = [...messages];

  for (let turn = 0; turn < MAX_AGENT_TURNS && !completion.done; turn++) {
    const turnStart = Date.now();
    console.log(`[coder] ── turn ${turn + 1}/${MAX_AGENT_TURNS} ──`);

    const response = await modelProvider.chatWithTools(conversationMessages, toolDefs, {
      modelRole: "coder",
      temperature: 0.3,
    });

    const llmMs = Date.now() - turnStart;
    const toolCalls = extractToolCalls(response);
    console.log(
      `[coder]   LLM ${(llmMs / 1000).toFixed(1)}s → ${toolCalls.length} tool call(s): ${toolCalls.map((tc) => tc.name).join(", ") || "(none)"}`,
    );
    if (toolCalls.length === 0) break;

    const toolResults: Array<{ toolCallId: string; name: string; result: string }> = [];

    for (const tc of toolCalls) {
      // Find matching PipelineAgentTool and execute
      const tool = tools.find((t) => t.name === tc.name);
      if (!tool) {
        console.log(`[coder]   ⚠ Unknown tool: ${tc.name}`);
        toolResults.push({
          toolCallId: tc.name + "_" + turn,
          name: tc.name,
          result: `Unknown tool: ${tc.name}`,
        });
        continue;
      }

      const result = await tool.execute(tc.arguments);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      const preview = resultStr.length > 150 ? resultStr.slice(0, 150) + "…" : resultStr;
      console.log(`[coder]   🔧 ${tc.name} → ${preview}`);
      toolResults.push({
        toolCallId: tc.name + "_" + turn,
        name: tc.name,
        result: resultStr,
      });

      if (completion.done) break;
    }

    console.log(`[coder]   turn ${turn + 1} done ${((Date.now() - turnStart) / 1000).toFixed(1)}s`);

    if (completion.done) break;

    // Append assistant message and tool results to conversation
    conversationMessages.push({
      role: "assistant",
      content: "",
      toolCalls: toolCalls.map((tc, i) => ({
        id: tc.name + "_" + turn + "_" + i,
        name: tc.name,
        arguments: tc.arguments,
      })),
    } as any);

    for (const tr of toolResults) {
      conversationMessages.push({
        role: "tool",
        content: tr.result,
        toolCallId: tr.toolCallId,
      } as any);
    }
  }
}

// ============================================================================
// handleArgue Node
// ============================================================================

export function createHandleArgueNode(deps: CoderNodeDeps) {
  return async (state: CoderGraphState): Promise<Partial<CoderGraphState>> => {
    const { modelProvider, promptRegistry } = deps;

    // 如果验证通过，无需 argue
    if (state.validationResult?.passed) {
      return { argueHandled: false };
    }

    const validationResultJson = JSON.stringify(
      state.validationResult ?? { passed: false, errors: [], warnings: [] },
    );

    const messages = promptRegistry.buildMessages(
      "coder/handle-argue",
      {
        validation_result_json: validationResultJson,
        quality_score: String(state.qualityScore),
      },
      "Decide how to handle this quality issue.",
    );

    const response = await modelProvider.chatWithTools(messages, [decideActionTool], {
      modelRole: "reviewer",
      temperature: 0.2,
    });

    const toolCalls = extractToolCalls(response);
    const args = toolCalls.find((t) => t.name === "decide_action")?.arguments;

    if (!args) {
      // 默认 retry
      return {
        argueResponse: {
          type: "quality_below_threshold" as const,
          details: `Quality ${state.qualityScore} < ${state.qualityThreshold}`,
          suggestedAction: "retry_with_improvements",
        },
        argueHandled: false,
      };
    }

    const action = args.action as "retry" | "accept" | "argue";
    const reason = (args.reason as string) ?? "";

    if (action === "accept") {
      return { argueHandled: false };
    }

    if (action === "argue") {
      return {
        argueResponse: {
          type: "validation_failed" as const,
          details: reason,
          suggestedAction: (args.suggestedAction as string) ?? "Review validation criteria",
        },
        argueHandled: false,
      };
    }

    // retry
    return {
      argueResponse: {
        type: "quality_below_threshold" as const,
        details: reason,
        suggestedAction: "retry_with_fixes",
      },
      argueHandled: false,
    };
  };
}
