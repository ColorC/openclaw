/**
 * Claude Code CLI Coder
 *
 * 封装 Claude Code CLI 调用，让其使用自带的全套工具完成编程任务。
 * 通过标记文件（.openclaw-task-done）检测任务完成状态。
 *
 * 流程：
 * 1. 注入完成协议到 system prompt
 * 2. 调用 claude CLI（-p --dangerously-skip-permissions）
 * 3. 检查标记文件 → 存在则完成，不存在则 --resume 继续
 * 4. 可选：完成后执行验证 pass
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCommandWithTimeout } from "../../../../src/process/exec.js";

// ============================================================================
// Types
// ============================================================================

export interface ClaudeCodeCoderConfig {
  /** 工作目录 */
  cwd: string;
  /** 模型（默认 "sonnet"） */
  model?: string;
  /** 单次 CLI 调用超时 ms（默认 600_000 = 10 分钟） */
  timeoutMs?: number;
  /** 未完成时最大重试次数（默认 3） */
  maxRetries?: number;
  /** 标记文件路径（默认 cwd/.openclaw-task-done） */
  completionMarkerPath?: string;
  /** 完成后是否执行验证 pass（默认 true） */
  verificationPass?: boolean;
  /** 额外的 system prompt 内容 */
  extraSystemPrompt?: string;
  /** CLI 最大 turn 数（默认不限制） */
  maxTurns?: number;
}

export interface ClaudeCodeCoderResult {
  /** CLI 最后一次输出 */
  output: string;
  /** 是否检测到完成标记 */
  completionDetected: boolean;
  /** 总调用次数 */
  attempts: number;
  /** 验证 pass 输出 */
  verificationOutput?: string;
  /** 从标记文件解析的元数据 */
  marker?: { summary?: string; qualityScore?: number; modifiedFiles?: string[] };
}

// ============================================================================
// Helpers
// ============================================================================

function buildCliArgs(params: {
  model: string;
  systemPrompt?: string;
  sessionId?: string;
  isResume: boolean;
  maxTurns?: number;
}): string[] {
  const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions"];

  args.push("--model", params.model);

  if (params.maxTurns) {
    args.push("--max-turns", String(params.maxTurns));
  }

  if (params.systemPrompt) {
    args.push("--append-system-prompt", params.systemPrompt);
  }

  if (params.isResume && params.sessionId) {
    args.push("--resume", params.sessionId);
  } else if (params.sessionId) {
    args.push("--session-id", params.sessionId);
  }

  return args;
}

function parseSessionId(jsonOutput: string): string | undefined {
  try {
    const parsed = JSON.parse(jsonOutput);
    return parsed.session_id ?? parsed.sessionId ?? parsed.conversation_id;
  } catch {
    return undefined;
  }
}

function parseMessage(jsonOutput: string): string {
  try {
    const parsed = JSON.parse(jsonOutput);
    return parsed.message ?? parsed.result ?? jsonOutput;
  } catch {
    return jsonOutput;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readMarker(
  markerPath: string,
): Promise<{ summary?: string; qualityScore?: number; modifiedFiles?: string[] } | undefined> {
  try {
    const content = await fs.readFile(markerPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

// ============================================================================
// Resolve claude CLI binary
// ============================================================================

/**
 * 解析 claude CLI 的绝对路径。
 * spawn 在某些环境下不会使用 env.PATH 查找命令，
 * 所以我们先手动解析绝对路径。
 */
async function resolveClaudeBin(npmGlobalBin: string): Promise<string> {
  const { execSync } = await import("node:child_process");

  // 1. 尝试 npm global bin 目录
  const candidate = path.join(npmGlobalBin, "claude");
  if (await fileExists(candidate)) {
    return candidate;
  }

  // 2. 尝试 which
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    // fall through
  }

  // 3. 回退到 "claude"，让 spawn 自己找
  return "claude";
}

// ============================================================================
// Verification Pass
// ============================================================================

async function runVerificationPass(params: {
  cwd: string;
  model: string;
  sessionId: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  claudeBin: string;
}): Promise<string> {
  const prompt =
    "The task has been marked as complete. Please do a final verification: " +
    "1) Check that all files compile/parse correctly. " +
    "2) Run any relevant tests. " +
    "3) Confirm the implementation matches the requirements. " +
    "Report any issues found.";

  const args = buildCliArgs({
    model: params.model,
    sessionId: params.sessionId,
    isResume: true,
  });

  const result = await runCommandWithTimeout([params.claudeBin, ...args, prompt], {
    timeoutMs: params.timeoutMs,
    cwd: params.cwd,
    env: params.env,
    input: "", // Force stdin to pipe mode; "inherit" crashes in vitest workers
  });

  return parseMessage(result.stdout.trim());
}

// ============================================================================
// Main
// ============================================================================

export async function runClaudeCodeCoder(
  taskPrompt: string,
  config: ClaudeCodeCoderConfig,
): Promise<ClaudeCodeCoderResult> {
  const {
    cwd,
    model = "sonnet",
    timeoutMs = 600_000,
    maxRetries = 3,
    completionMarkerPath = path.join(cwd, ".openclaw-task-done"),
    verificationPass = true,
    extraSystemPrompt,
    maxTurns,
  } = config;

  // 清理旧标记
  await fs.rm(completionMarkerPath, { force: true });

  // 构建干净的环境变量：
  // 1. 设 CLAUDECODE=undefined 以避免嵌套检测（runCommandWithTimeout 会过滤 undefined）
  // 2. 确保 PATH 包含 npm global bin 目录
  //    注意：process.env.HOME 可能被测试框架覆盖为临时目录，
  //    所以用 os.userInfo().homedir 获取真实 home 目录。
  const realHome = os.userInfo().homedir;
  const npmGlobalBin = path.join(realHome, ".npm-global", "bin");
  const currentPath = process.env.PATH ?? "";
  const cleanEnv: NodeJS.ProcessEnv = {
    CLAUDECODE: undefined,
    PATH: currentPath.includes(npmGlobalBin) ? currentPath : `${npmGlobalBin}:${currentPath}`,
  };

  // 解析 claude CLI 的绝对路径，避免 spawn ENOENT
  const claudeBin = await resolveClaudeBin(npmGlobalBin);

  const completionProtocol = [
    "IMPORTANT — Completion Protocol:",
    `When you have completed ALL parts of the task, create a file at: ${completionMarkerPath}`,
    'with JSON content: {"status":"done","summary":"<brief summary>","qualityScore":<0-1>,"modifiedFiles":["<file1>","<file2>"]}',
    "Do NOT create this file until you are confident the task is fully done.",
    extraSystemPrompt ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  let attempts = 0;
  let lastOutput = "";
  let sessionId: string | undefined;

  while (attempts < maxRetries) {
    attempts++;

    const isResume = attempts > 1 && !!sessionId;
    const args = buildCliArgs({
      model,
      systemPrompt: attempts === 1 ? completionProtocol : undefined,
      sessionId,
      isResume,
      maxTurns,
    });

    const prompt =
      attempts === 1
        ? taskPrompt
        : "The task is not yet complete — the completion marker file was not found. " +
          "Please continue working and create the marker file when done.";

    console.log(`[claude-code-coder] Attempt ${attempts}/${maxRetries} (resume=${isResume})`);

    const result = await runCommandWithTimeout([claudeBin, ...args, prompt], {
      timeoutMs,
      cwd,
      env: cleanEnv,
      input: "", // Force stdin to pipe mode; "inherit" crashes in vitest workers
    });

    const stdout = result.stdout.trim();
    lastOutput = parseMessage(stdout);
    sessionId = sessionId ?? parseSessionId(stdout);

    console.log(
      `[claude-code-coder] CLI exited code=${result.code}, signal=${result.signal}, killed=${result.killed}, stdout=${stdout.length} chars, stderr=${result.stderr.length} chars`,
    );
    if (result.stderr.trim()) {
      console.warn(`[claude-code-coder] stderr: ${result.stderr.trim().slice(0, 500)}`);
    }
    // Log a snippet of stdout for debugging
    console.log(`[claude-code-coder] stdout preview: ${stdout.slice(0, 300)}`);

    if (result.code !== 0) {
      console.warn(`[claude-code-coder] CLI exited with code ${result.code}`);
    }

    // 检查完成标记
    if (await fileExists(completionMarkerPath)) {
      console.log("[claude-code-coder] Completion marker found");
      const marker = await readMarker(completionMarkerPath);

      let verificationOutput: string | undefined;
      if (verificationPass && sessionId) {
        console.log("[claude-code-coder] Running verification pass...");
        verificationOutput = await runVerificationPass({
          cwd,
          model,
          sessionId,
          timeoutMs,
          env: cleanEnv,
          claudeBin,
        });
      }

      return {
        output: lastOutput,
        completionDetected: true,
        attempts,
        verificationOutput,
        marker,
      };
    }

    console.log("[claude-code-coder] Completion marker not found, will retry...");
  }

  // 重试耗尽
  console.warn(`[claude-code-coder] Exhausted ${maxRetries} attempts without completion`);
  return {
    output: lastOutput,
    completionDetected: false,
    attempts,
  };
}
