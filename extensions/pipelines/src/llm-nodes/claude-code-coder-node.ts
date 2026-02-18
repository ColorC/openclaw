/**
 * Claude Code CLI Coder Node
 *
 * 将 runClaudeCodeCoder 包装为 LangGraph 节点，
 * 通过 CoderNodeOverrides.recursiveCoder 注入到 coder 工作流。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CoderGraphState } from "../workflows/coder.js";
import { runClaudeCodeCoder, type ClaudeCodeCoderConfig } from "../llm/claude-code-coder.js";

// ============================================================================
// Types
// ============================================================================

export interface ClaudeCodeCoderNodeDeps {
  /** 工作目录 */
  cwd: string;
  /** 模型（默认 "sonnet"） */
  model?: string;
  /** 单次 CLI 调用超时 ms */
  timeoutMs?: number;
  /** 未完成时最大重试次数 */
  maxRetries?: number;
  /** 完成后是否执行验证 pass */
  verificationPass?: boolean;
  /** 额外 system prompt */
  extraSystemPrompt?: string;
  /** CLI 最大 turn 数 */
  maxTurns?: number;
}

// ============================================================================
// Node Factory
// ============================================================================

export function createClaudeCodeCoderNode(deps: ClaudeCodeCoderNodeDeps) {
  return async (state: CoderGraphState): Promise<Partial<CoderGraphState>> => {
    const hasErrors = state.codeContext.errorReports?.length;
    const modeInstruction = hasErrors
      ? "Fix the code based on the error reports below."
      : "Implement the task described below.";

    const sections: string[] = [modeInstruction, "", `Task: ${state.taskDescription}`];

    if (state.codeContext.requirements) {
      sections.push("", `Requirements: ${state.codeContext.requirements}`);
    }
    if (state.codeContext.skeleton) {
      sections.push("", "Code skeleton:", state.codeContext.skeleton);
    }
    if (state.codeContext.test) {
      sections.push("", "Test code:", state.codeContext.test);
    }
    if (hasErrors) {
      sections.push(
        "",
        "Errors to fix:",
        ...state.codeContext.errorReports!.map(
          (e) => `- ${e.file}:${e.line ?? ""} ${e.message} (${e.type})`,
        ),
      );
    }
    sections.push("", `Iteration: ${state.iterationCount + 1} / ${state.maxIterations}`);

    const taskPrompt = sections.join("\n");
    const markerPath = path.join(deps.cwd, ".openclaw-task-done");

    const result = await runClaudeCodeCoder(taskPrompt, {
      cwd: deps.cwd,
      model: deps.model,
      timeoutMs: deps.timeoutMs,
      maxRetries: deps.maxRetries,
      verificationPass: deps.verificationPass,
      completionMarkerPath: markerPath,
      extraSystemPrompt: deps.extraSystemPrompt,
      maxTurns: deps.maxTurns,
    });

    // 从标记文件解析质量信息
    const qualityScore = result.marker?.qualityScore ?? (result.completionDetected ? 0.8 : 0.3);
    const modifiedFiles = result.marker?.modifiedFiles ?? [];
    const passed = result.completionDetected && qualityScore >= state.qualityThreshold;

    // 清理标记文件
    await fs.rm(markerPath, { force: true });

    return {
      iterationCount: state.iterationCount + 1,
      currentCode: result.marker?.summary ?? result.output,
      qualityScore,
      qualityHistory: [...(state.qualityHistory ?? []), qualityScore],
      modifiedFiles,
      toolsUsed: ["claude-code-cli"],
      validationResult: {
        passed,
        errors: passed
          ? []
          : result.completionDetected
            ? [`Quality score ${qualityScore} < threshold ${state.qualityThreshold}`]
            : [`Claude Code did not signal completion after ${result.attempts} attempts`],
        warnings: result.verificationOutput
          ? [`Verification: ${result.verificationOutput.slice(0, 500)}`]
          : [],
      },
    };
  };
}
