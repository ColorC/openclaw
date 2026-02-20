/**
 * Native Coder Node
 *
 * 完全复用 openclaw 主体的 agent 系统（runEmbeddedPiAgent），
 * 自动获得 25+ 工具（subagent、web_search、web_fetch、browser、process 等）、
 * auth failover、compaction、context overflow recovery。
 *
 * 通过 clientTools 注入 task_complete 工具，agent 调用该工具时 loop 停止，
 * 结构化结果通过 pendingToolCalls 回传。
 *
 * 通过 CoderNodeOverrides.recursiveCoder 注入到 coder 工作流。
 */

import type { ClientToolDefinition } from "../../../../src/agents/pi-embedded-runner/run/params.js";
import type { OpenClawConfig } from "../../../../src/config/config.js";
import type { CoderGraphState } from "../workflows/coder.js";
import type { CodeContext } from "../workflows/states.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../../../../src/agents/defaults.js";
import { runEmbeddedPiAgent } from "../../../../src/agents/pi-embedded-runner/run.js";
import { loadConfig } from "../../../../src/config/config.js";
import { resolveSessionTranscriptPath } from "../../../../src/config/sessions/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface NativeCoderNodeDeps {
  /** 工作目录 */
  cwd: string;
  /** LLM provider（默认使用 openclaw 配置的 DEFAULT_PROVIDER） */
  provider?: string;
  /** 模型 ID（默认使用 openclaw 配置的 DEFAULT_MODEL） */
  model?: string;
  /** 超时 ms（默认 300_000 = 5 分钟） */
  timeoutMs?: number;
  /** 预加载的 openclaw 配置（不传则自动 loadConfig()） */
  config?: OpenClawConfig;
  /** 额外 system prompt */
  extraSystemPrompt?: string;
}

// ============================================================================
// task_complete Client Tool
// ============================================================================

const TASK_COMPLETE_TOOL: ClientToolDefinition = {
  type: "function",
  function: {
    name: "task_complete",
    description:
      "Call this tool when you have completed ALL parts of the coding task. " +
      "This signals completion and reports your results.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of what was implemented or fixed.",
        },
        qualityScore: {
          type: "number",
          description: "Self-assessed quality score from 0.0 to 1.0.",
        },
        modifiedFiles: {
          type: "array",
          items: { type: "string" },
          description: "List of files created or modified.",
        },
      },
      required: ["summary", "qualityScore", "modifiedFiles"],
    },
  },
};

interface TaskCompleteParams {
  summary?: string;
  qualityScore?: number;
  modifiedFiles?: string[];
}

// ============================================================================
// Prompt Builder
// ============================================================================

function buildTaskPrompt(params: {
  modeInstruction: string;
  taskDescription: string;
  codeContext: CodeContext;
  iteration: number;
  maxIterations: number;
}): string {
  const sections: string[] = [
    params.modeInstruction,
    "",
    "## Requirements",
    params.taskDescription,
  ];

  if (params.codeContext.requirements) {
    sections.push("", "## Additional Requirements", params.codeContext.requirements);
  }
  if (params.codeContext.skeleton) {
    sections.push("", "## Code Skeleton", "```", params.codeContext.skeleton, "```");
  }
  if (params.codeContext.test) {
    sections.push("", "## Test Code", "```", params.codeContext.test, "```");
  }
  if (params.codeContext.errorReports?.length) {
    sections.push(
      "",
      "## Errors to Fix",
      ...params.codeContext.errorReports.map(
        (e) => `- ${e.file}:${e.line ?? ""} ${e.message} (${e.type})`,
      ),
    );
  }

  sections.push(
    "",
    `## Iteration`,
    `${params.iteration} / ${params.maxIterations}`,
    "",
    "## Completion Protocol",
    "When you have completed ALL parts of the task, call the `task_complete` tool with your summary, quality score, and list of modified files.",
    "Do NOT call task_complete until you are confident the task is fully done.",
  );

  return sections.join("\n");
}

// ============================================================================
// Node Factory
// ============================================================================

export function createNativeCoderNode(deps: NativeCoderNodeDeps) {
  const {
    cwd,
    provider = DEFAULT_PROVIDER,
    model = DEFAULT_MODEL,
    timeoutMs = 300_000,
    extraSystemPrompt,
  } = deps;

  // 延迟加载配置
  let resolvedConfig: OpenClawConfig | undefined = deps.config;

  return async (state: CoderGraphState): Promise<Partial<CoderGraphState>> => {
    if (!resolvedConfig) {
      resolvedConfig = loadConfig();
    }

    const hasErrors = state.codeContext.errorReports?.length;
    const modeInstruction = hasErrors
      ? "Fix the code based on the error reports below. Preserve the working parts."
      : "Implement the task described below.";

    const taskPrompt = buildTaskPrompt({
      modeInstruction,
      taskDescription: state.taskDescription,
      codeContext: state.codeContext,
      iteration: state.iterationCount + 1,
      maxIterations: state.maxIterations,
    });

    // 每次调用创建独立 session
    const sessionId = `pipeline-coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionFile = resolveSessionTranscriptPath(sessionId);
    const runId = `pipeline-${sessionId}`;

    console.log(`[native-coder] Starting embedded agent (provider=${provider}, model=${model})`);

    const result = await runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: cwd,
      prompt: taskPrompt,
      extraSystemPrompt: [
        "You are a code implementation agent. Focus on writing clean, working code.",
        "Use all available tools as needed: read files, write code, edit, run bash commands, search the web, spawn subagents for parallel work, etc.",
        "When done, call the task_complete tool to report your results.",
        extraSystemPrompt,
      ]
        .filter(Boolean)
        .join("\n"),
      clientTools: [TASK_COMPLETE_TOOL],
      timeoutMs,
      runId,
      provider,
      model,
      config: resolvedConfig,
      disableMessageTool: true,
      senderIsOwner: true,
    });

    const durationMs = result.meta.durationMs;
    console.log(`[native-coder] Agent finished in ${(durationMs / 1000).toFixed(1)}s`);

    // 从 pendingToolCalls 提取 task_complete 结果
    const taskCompleteCall = result.meta.pendingToolCalls?.find(
      (tc) => tc.name === "task_complete",
    );
    let completionParams: TaskCompleteParams | undefined;
    if (taskCompleteCall) {
      try {
        completionParams = JSON.parse(taskCompleteCall.arguments);
      } catch {
        // JSON 解析失败，视为未完成
      }
    }

    const completionDetected = !!completionParams;

    // 提取结果
    const qualityScore = completionParams?.qualityScore ?? (completionDetected ? 0.8 : 0.5);
    const modifiedFiles = completionParams?.modifiedFiles ?? [];
    const summary =
      completionParams?.summary ??
      result.payloads
        ?.filter((p) => p.text && !p.isError)
        .map((p) => p.text)
        .join("\n") ??
      "";
    const passed = completionDetected && qualityScore >= state.qualityThreshold;

    // 清理 session 文件
    try {
      const fs = await import("node:fs/promises");
      await fs.rm(sessionFile, { force: true });
    } catch {
      // session 文件清理失败不影响结果
    }

    // 记录 provider/model 信息
    const toolsUsed = [
      `embedded-agent:${result.meta.agentMeta?.provider ?? provider}/${result.meta.agentMeta?.model ?? model}`,
    ];

    return {
      iterationCount: state.iterationCount + 1,
      currentCode: summary,
      qualityScore,
      qualityHistory: [...(state.qualityHistory ?? []), qualityScore],
      modifiedFiles,
      toolsUsed,
      validationResult: {
        passed,
        errors: passed
          ? []
          : completionDetected
            ? [`Quality score ${qualityScore} < threshold ${state.qualityThreshold}`]
            : [`Agent did not signal completion (task_complete tool not called)`],
        warnings: result.meta.error
          ? [`Agent error: ${result.meta.error.kind} - ${result.meta.error.message}`]
          : [],
      },
    };
  };
}
