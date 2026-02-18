/**
 * Native Coder Node — 单元测试
 *
 * 通过 mock runEmbeddedPiAgent 验证节点逻辑，不需要真实 LLM。
 * 完成信号通过 clientTools → pendingToolCalls 回传。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddedPiRunResult } from "../../../../src/agents/pi-embedded-runner/types.js";
import type { CoderGraphState } from "../workflows/coder.js";

// Mock openclaw 依赖
vi.mock("../../../../src/agents/pi-embedded-runner/run.js", () => ({
  runEmbeddedPiAgent: vi.fn(),
}));

vi.mock("../../../../src/config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../../../src/config/sessions/paths.js", () => ({
  resolveSessionTranscriptPath: vi.fn((id: string) => `/tmp/sessions/${id}.jsonl`),
}));

vi.mock("../../../../src/agents/defaults.js", () => ({
  DEFAULT_PROVIDER: "anthropic",
  DEFAULT_MODEL: "claude-opus-4-6",
}));

// Mock node:fs/promises for session file cleanup
vi.mock("node:fs/promises", () => ({
  default: {
    rm: vi.fn().mockResolvedValue(undefined),
  },
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { runEmbeddedPiAgent } from "../../../../src/agents/pi-embedded-runner/run.js";
import { createNativeCoderNode } from "./native-coder-node.js";

// ============================================================================
// Helpers
// ============================================================================

function makeState(overrides: Partial<CoderGraphState> = {}): CoderGraphState {
  return {
    taskDescription: "Implement a calculator",
    codeContext: {},
    maxIterations: 10,
    qualityThreshold: 0.7,
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

/** 构造带 task_complete 调用的 EmbeddedPiRunResult */
function mockResultWithCompletion(params: {
  summary: string;
  qualityScore: number;
  modifiedFiles: string[];
}): EmbeddedPiRunResult {
  return {
    payloads: [{ text: "Implementation complete" }],
    meta: {
      durationMs: 1000,
      agentMeta: { sessionId: "test", provider: "anthropic", model: "claude-opus-4-6" },
      stopReason: "tool_calls",
      pendingToolCalls: [
        {
          id: `call_${Date.now()}`,
          name: "task_complete",
          arguments: JSON.stringify(params),
        },
      ],
    },
  };
}

/** 构造无 task_complete 调用的 EmbeddedPiRunResult */
function mockResultNoCompletion(overrides: Partial<EmbeddedPiRunResult> = {}): EmbeddedPiRunResult {
  return {
    payloads: [{ text: "I wrote some code" }],
    meta: {
      durationMs: 1000,
      agentMeta: { sessionId: "test", provider: "anthropic", model: "claude-opus-4-6" },
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("createNativeCoderNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract quality from task_complete tool call", async () => {
    (runEmbeddedPiAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResultWithCompletion({
        summary: "Implemented calculator",
        qualityScore: 0.9,
        modifiedFiles: ["src/calc.ts"],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.9);
    expect(result.modifiedFiles).toEqual(["src/calc.ts"]);
    expect(result.currentCode).toBe("Implemented calculator");
    expect(result.iterationCount).toBe(1);
    expect(result.validationResult!.passed).toBe(true);
  });

  it("should fallback to 0.5 quality when task_complete not called", async () => {
    (runEmbeddedPiAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockResultNoCompletion());

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.5);
    expect(result.currentCode).toBe("I wrote some code");
    expect(result.validationResult!.passed).toBe(false);
    expect(result.validationResult!.errors[0]).toContain("task_complete tool not called");
  });

  it("should pass when quality meets threshold", async () => {
    (runEmbeddedPiAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResultWithCompletion({
        summary: "Done",
        qualityScore: 0.7,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState({ qualityThreshold: 0.7 }));

    expect(result.validationResult!.passed).toBe(true);
    expect(result.validationResult!.errors).toEqual([]);
  });

  it("should include error context in prompt for fix mode", async () => {
    const mockRun = runEmbeddedPiAgent as ReturnType<typeof vi.fn>;
    mockRun.mockResolvedValue(
      mockResultWithCompletion({
        summary: "Fixed",
        qualityScore: 0.8,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    await node(
      makeState({
        codeContext: {
          errorReports: [
            { file: "src/calc.ts", line: 10, message: "Type error", type: "typecheck" },
          ],
        },
      }),
    );

    // Verify prompt contains error info
    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Fix the code");
    expect(callArgs.prompt).toContain("Type error");
    expect(callArgs.prompt).toContain("src/calc.ts");
  });

  it("should include code context in prompt", async () => {
    const mockRun = runEmbeddedPiAgent as ReturnType<typeof vi.fn>;
    mockRun.mockResolvedValue(
      mockResultWithCompletion({
        summary: "Done",
        qualityScore: 0.8,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    await node(
      makeState({
        codeContext: {
          requirements: "Must support add and subtract",
          skeleton: "function add(a, b) {}",
          test: "expect(add(1,2)).toBe(3)",
        },
      }),
    );

    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Must support add and subtract");
    expect(callArgs.prompt).toContain("function add(a, b) {}");
    expect(callArgs.prompt).toContain("expect(add(1,2)).toBe(3)");
  });

  it("should accumulate quality history", async () => {
    (runEmbeddedPiAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResultWithCompletion({
        summary: "Attempt 2",
        qualityScore: 0.6,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState({ qualityHistory: [0.4], iterationCount: 1 }));

    expect(result.qualityHistory).toEqual([0.4, 0.6]);
    expect(result.iterationCount).toBe(2);
  });

  it("should call runEmbeddedPiAgent with correct params including clientTools", async () => {
    const mockRun = runEmbeddedPiAgent as ReturnType<typeof vi.fn>;
    mockRun.mockResolvedValue(
      mockResultWithCompletion({
        summary: "Done",
        qualityScore: 0.8,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({
      cwd: "/tmp/test",
      provider: "openai",
      model: "gpt-4o",
      timeoutMs: 120_000,
    });
    await node(makeState());

    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.workspaceDir).toBe("/tmp/test");
    expect(callArgs.provider).toBe("openai");
    expect(callArgs.model).toBe("gpt-4o");
    expect(callArgs.timeoutMs).toBe(120_000);
    expect(callArgs.disableMessageTool).toBe(true);
    expect(callArgs.senderIsOwner).toBe(true);
    expect(callArgs.sessionId).toMatch(/^pipeline-coder-/);
    // clientTools 应包含 task_complete
    expect(callArgs.clientTools).toHaveLength(1);
    expect(callArgs.clientTools[0].function.name).toBe("task_complete");
  });

  it("should report agent errors in warnings", async () => {
    (runEmbeddedPiAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResultNoCompletion({
        meta: {
          durationMs: 1000,
          error: { kind: "context_overflow", message: "Prompt too large" },
        },
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    const result = await node(makeState());

    expect(result.validationResult!.warnings[0]).toContain("context_overflow");
    expect(result.validationResult!.warnings[0]).toContain("Prompt too large");
  });

  it("should use default provider and model when not specified", async () => {
    const mockRun = runEmbeddedPiAgent as ReturnType<typeof vi.fn>;
    mockRun.mockResolvedValue(
      mockResultWithCompletion({
        summary: "Done",
        qualityScore: 0.8,
        modifiedFiles: [],
      }),
    );

    const node = createNativeCoderNode({ cwd: "/tmp/test" });
    await node(makeState());

    const callArgs = mockRun.mock.calls[0][0];
    expect(callArgs.provider).toBe("anthropic");
    expect(callArgs.model).toBe("claude-opus-4-6");
  });
});
