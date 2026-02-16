/**
 * Coder LLM Nodes
 *
 * 用真实 LLM 调用替换 coder 工作流中的 stub 节点。
 * 2 个节点:
 * - recursiveCoder: 代码生成/修复
 * - handleArgue: 质量决策（retry/accept/argue）
 */

import type { ModelProvider, ToolDefinition } from "../llm/types.js";
import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { CoderGraphState } from "../workflows/coder.js";

// ============================================================================
// Deps
// ============================================================================

export interface CoderNodeDeps {
  modelProvider: ModelProvider;
  promptRegistry: PromptRegistry;
}

// ============================================================================
// Tool Schemas
// ============================================================================

const generateCodeTool: ToolDefinition = {
  name: "generate_code",
  description: "Return the generated/modified code",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "The generated or fixed code" },
      modifiedFiles: {
        type: "array",
        items: { type: "string" },
        description: "List of modified file paths",
      },
      qualityScore: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Self-assessed quality score",
      },
      explanation: { type: "string", description: "Brief explanation of what was done" },
    },
    required: ["code", "qualityScore"],
  },
};

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
// Helper
// ============================================================================

function extractToolArgs(
  response: { toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> },
  toolName: string,
) {
  const tc = response.toolCalls?.find((t) => t.name === toolName);
  return tc?.arguments;
}

// ============================================================================
// recursiveCoder Node
// ============================================================================

export function createRecursiveCoderNode(deps: CoderNodeDeps) {
  return async (state: CoderGraphState): Promise<Partial<CoderGraphState>> => {
    const { modelProvider, promptRegistry } = deps;

    // 判断是 generate 还是 fix 模式
    const hasErrors = state.codeContext.errorReports?.length;
    const modeInstruction = hasErrors
      ? "Fix the code based on the error reports below. Preserve the working parts."
      : "Generate new code to implement the task.";

    // 构造 error context
    const errorContext = hasErrors
      ? `Errors to fix:\n${state.codeContext.errorReports!.map((e) => `- ${e.file}:${e.line ?? ""} ${e.message} (${e.type})`).join("\n")}`
      : "";

    const codeContextJson = JSON.stringify({
      skeleton: state.codeContext.skeleton,
      test: state.codeContext.test,
      requirements: state.codeContext.requirements,
    });

    const messages = promptRegistry.buildMessages(
      "coder/recursive-coder",
      {
        mode_instruction: modeInstruction,
        task_description: state.taskDescription,
        code_context_json: codeContextJson,
        iteration: String(state.iterationCount + 1),
        max_iterations: String(state.maxIterations),
        error_context: errorContext,
      },
      state.taskDescription,
    );

    const response = await modelProvider.chatWithTools(messages, [generateCodeTool], {
      modelRole: "coder",
      temperature: 0.3,
    });

    const args = extractToolArgs(response, "generate_code");
    if (!args) {
      // 降级：返回 stub 代码
      return {
        iterationCount: state.iterationCount + 1,
        currentCode: state.currentCode ?? "// No code generated",
        qualityScore: 0.5,
        qualityHistory: [...state.qualityHistory, 0.5],
        validationResult: {
          passed: false,
          errors: ["LLM did not call generate_code tool"],
          warnings: [],
        },
      };
    }

    const qualityScore = (args.qualityScore as number) ?? 0.5;
    const code = (args.code as string) ?? "";
    const modifiedFiles = (args.modifiedFiles as string[]) ?? [];
    const passed = qualityScore >= state.qualityThreshold;

    return {
      iterationCount: state.iterationCount + 1,
      currentCode: code,
      qualityScore,
      qualityHistory: [...(state.qualityHistory ?? []), qualityScore],
      modifiedFiles,
      validationResult: {
        passed,
        errors: passed
          ? []
          : [`Quality score ${qualityScore} < threshold ${state.qualityThreshold}`],
        warnings: [],
      },
    };
  };
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

    const args = extractToolArgs(response, "decide_action");
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
      // 接受当前代码
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
