/**
 * Claude Code CLI Coder Node — 单元测试
 *
 * 通过 mock runClaudeCodeCoder 和 fs 验证节点逻辑。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoderGraphState } from "../workflows/coder.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Mock claude-code-coder
vi.mock("../llm/claude-code-coder.js", () => ({
  runClaudeCodeCoder: vi.fn(),
}));

import { rm } from "node:fs/promises";
import { runClaudeCodeCoder } from "../llm/claude-code-coder.js";
import { createClaudeCodeCoderNode } from "./claude-code-coder-node.js";

const mockRunCoder = runClaudeCodeCoder as ReturnType<typeof vi.fn>;
const mockRm = rm as ReturnType<typeof vi.fn>;

// ============================================================================
// Helpers
// ============================================================================

function makeState(overrides: Partial<CoderGraphState> = {}): CoderGraphState {
  return {
    taskDescription: "Implement a calculator",
    codeContext: {},
    maxIterations: 10,
    qualityThreshold: 0.7,
    workDir: process.cwd(),
    editScope: undefined,
    sessionId: undefined,
    iterationCount: 0,
    currentCode: undefined,
    validationResult: undefined,
    qualityIndicators: undefined,
    qualityScore: 0,
    qualityHistory: [],
    retryReason: undefined,
    toolsUsed: [],
    implementationSummary: undefined,
    fixSummary: undefined,
    modifiedFiles: [],
    success: false,
    error: undefined,
    argueResponse: undefined,
    argueHandled: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("createClaudeCodeCoderNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it("should return passed=true when completion detected with good quality", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "All done",
      completionDetected: true,
      attempts: 1,
      marker: { summary: "Implemented calculator", qualityScore: 0.9, modifiedFiles: ["calc.ts"] },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.9);
    expect(result.currentCode).toBe("Implemented calculator");
    expect(result.modifiedFiles).toEqual(["calc.ts"]);
    expect(result.iterationCount).toBe(1);
    expect(result.validationResult!.passed).toBe(true);
    expect(result.validationResult!.errors).toEqual([]);
    expect(result.toolsUsed).toEqual(["claude-code-cli"]);
  });

  it("should fallback to 0.8 quality when marker has no qualityScore but completion detected", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: undefined,
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.8);
    expect(result.currentCode).toBe("Done");
    expect(result.validationResult!.passed).toBe(true);
  });

  it("should fallback to 0.3 quality when no completion detected", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Timed out",
      completionDetected: false,
      attempts: 3,
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.3);
    expect(result.validationResult!.passed).toBe(false);
    expect(result.validationResult!.errors[0]).toContain("did not signal completion");
    expect(result.validationResult!.errors[0]).toContain("3 attempts");
  });

  it("should fail when quality below threshold even with completion", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.5 },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState({ qualityThreshold: 0.7 }));

    expect(result.validationResult!.passed).toBe(false);
    expect(result.validationResult!.errors[0]).toContain("Quality score 0.5 < threshold 0.7");
  });

  it("should include verification output in warnings", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.9 },
      verificationOutput: "All tests pass, no issues found",
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.validationResult!.warnings).toHaveLength(1);
    expect(result.validationResult!.warnings[0]).toContain("Verification:");
    expect(result.validationResult!.warnings[0]).toContain("All tests pass");
  });

  it("should build prompt with error context for fix mode", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Fixed",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.85 },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    await node(
      makeState({
        codeContext: {
          errorReports: [
            { file: "src/calc.ts", line: 5, message: "Type error", type: "typecheck" },
          ],
        },
      }),
    );

    const taskPrompt = mockRunCoder.mock.calls[0][0] as string;
    expect(taskPrompt).toContain("Fix the code");
    expect(taskPrompt).toContain("Type error");
    expect(taskPrompt).toContain("src/calc.ts");
  });

  it("should build prompt with code context", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.8 },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    await node(
      makeState({
        codeContext: {
          requirements: "Must handle edge cases",
          skeleton: "function calc() {}",
          test: "expect(calc()).toBe(42)",
        },
      }),
    );

    const taskPrompt = mockRunCoder.mock.calls[0][0] as string;
    expect(taskPrompt).toContain("Must handle edge cases");
    expect(taskPrompt).toContain("function calc() {}");
    expect(taskPrompt).toContain("expect(calc()).toBe(42)");
  });

  it("should pass deps config to runClaudeCodeCoder", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.8 },
    });

    const node = createClaudeCodeCoderNode({
      cwd: "/my/project",
      model: "opus",
      timeoutMs: 300_000,
      maxRetries: 5,
      verificationPass: false,
      extraSystemPrompt: "Be concise",
    });
    await node(makeState());

    const config = mockRunCoder.mock.calls[0][1] as Record<string, unknown>;
    expect(config.cwd).toBe("/my/project");
    expect(config.model).toBe("opus");
    expect(config.timeoutMs).toBe(300_000);
    expect(config.maxRetries).toBe(5);
    expect(config.verificationPass).toBe(false);
    expect(config.extraSystemPrompt).toBe("Be concise");
  });

  it("should accumulate quality history", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Attempt 3",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.75 },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState({ qualityHistory: [0.3, 0.5], iterationCount: 2 }));

    expect(result.qualityHistory).toEqual([0.3, 0.5, 0.75]);
    expect(result.iterationCount).toBe(3);
  });

  it("should clean up marker file after reading", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.9 },
    });

    const node = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    await node(makeState());

    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining(".openclaw-task-done"), {
      force: true,
    });
  });
});
