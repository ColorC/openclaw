/**
 * Coder Workflow Integration Tests
 *
 * 验证 Native Coder 和 Claude Code Coder 节点
 * 通过 CoderNodeOverrides.recursiveCoder 注入到 coder 工作流后的端到端行为。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCoderGraph } from "../workflows/coder.js";

// ============================================================================
// Mock dependencies
// ============================================================================

// Mock node:fs/promises (used by claude-code-coder-node for marker cleanup)
vi.mock("node:fs/promises", () => ({
  default: {
    rm: vi.fn().mockResolvedValue(undefined),
  },
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Mock openclaw dependencies for native coder
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

// Mock claude-code-coder for CLI coder
vi.mock("../llm/claude-code-coder.js", () => ({
  runClaudeCodeCoder: vi.fn(),
}));

import { runEmbeddedPiAgent } from "../../../../src/agents/pi-embedded-runner/run.js";
import { createClaudeCodeCoderNode } from "../llm-nodes/claude-code-coder-node.js";
import { createNativeCoderNode } from "../llm-nodes/native-coder-node.js";
import { runClaudeCodeCoder } from "../llm/claude-code-coder.js";

const mockRunEmbedded = runEmbeddedPiAgent as ReturnType<typeof vi.fn>;
const mockRunCoder = runClaudeCodeCoder as ReturnType<typeof vi.fn>;

/** 构造带 task_complete 调用的 mock 返回值 */
function mockEmbeddedWithCompletion(params: {
  summary: string;
  qualityScore: number;
  modifiedFiles: string[];
  sessionId?: string;
}) {
  return {
    payloads: [{ text: "Implementation complete" }],
    meta: {
      durationMs: 1000,
      agentMeta: {
        sessionId: params.sessionId ?? "s1",
        provider: "anthropic",
        model: "claude-opus-4-6",
      },
      stopReason: "tool_calls",
      pendingToolCalls: [
        {
          id: `call_${Date.now()}`,
          name: "task_complete",
          arguments: JSON.stringify({
            summary: params.summary,
            qualityScore: params.qualityScore,
            modifiedFiles: params.modifiedFiles,
          }),
        },
      ],
    },
  };
}

/** 构造无 task_complete 调用的 mock 返回值 */
function mockEmbeddedNoCompletion(sessionId?: string) {
  return {
    payloads: [{ text: "Partial implementation" }],
    meta: {
      durationMs: 1000,
      agentMeta: { sessionId: sessionId ?? "s2", provider: "anthropic", model: "claude-opus-4-6" },
    },
  };
}

// ============================================================================
// Integration: Native Coder + Coder Workflow
// ============================================================================

describe("Integration: Native Coder + Coder Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete workflow when native coder produces high quality", async () => {
    mockRunEmbedded.mockResolvedValue(
      mockEmbeddedWithCompletion({
        summary: "Built calculator",
        qualityScore: 0.9,
        modifiedFiles: ["src/calc.ts"],
      }),
    );

    const nativeCoder = createNativeCoderNode({ cwd: "/tmp/test" });

    const graph = createCoderGraph({ recursiveCoder: nativeCoder });
    const result = await graph.invoke({
      taskDescription: "Build a calculator with add/subtract",
      codeContext: {},
      qualityThreshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.implementationSummary).toBe("Built calculator");
    expect(result.modifiedFiles).toEqual(["src/calc.ts"]);
    expect(result.qualityScore).toBe(0.9);
    expect(result.iterationCount).toBe(1);
  });

  it("should pause workflow (argue) when native coder quality is low", async () => {
    // No task_complete call → quality defaults to 0.5
    mockRunEmbedded.mockResolvedValue(mockEmbeddedNoCompletion("s2"));

    const nativeCoder = createNativeCoderNode({ cwd: "/tmp/test" });

    const graph = createCoderGraph({ recursiveCoder: nativeCoder });
    const result = await graph.invoke({
      taskDescription: "Build a calculator",
      codeContext: {},
      qualityThreshold: 0.7,
    });

    // Default handleArgue checks validationResult.passed first → "validation_failed"
    expect(result.qualityScore).toBe(0.5);
    expect(result.argueResponse).toBeDefined();
    expect(result.argueResponse!.type).toBe("validation_failed");
    // Workflow pauses at argue (doesn't reach finalize), success not set
    expect(result.success).toBeFalsy();
  });

  it("should handle fix mode with error reports", async () => {
    mockRunEmbedded.mockResolvedValue(
      mockEmbeddedWithCompletion({
        summary: "Fixed type error",
        qualityScore: 0.85,
        modifiedFiles: ["src/calc.ts"],
        sessionId: "s3",
      }),
    );

    const nativeCoder = createNativeCoderNode({ cwd: "/tmp/test" });

    const graph = createCoderGraph({ recursiveCoder: nativeCoder });
    const result = await graph.invoke({
      taskDescription: "Fix calculator",
      codeContext: {
        skeleton: "function add(a, b) { return a + b }",
        errorReports: [
          { file: "src/calc.ts", line: 1, message: "Missing return type", type: "lint" },
        ],
      },
      qualityThreshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.fixSummary).toBe("Fixed type error");
  });
});

// ============================================================================
// Integration: Claude Code Coder + Coder Workflow
// ============================================================================

describe("Integration: Claude Code Coder + Coder Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete workflow when CLI coder succeeds", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "All done",
      completionDetected: true,
      attempts: 1,
      marker: { summary: "Built calculator", qualityScore: 0.92, modifiedFiles: ["calc.ts"] },
    });

    const cliCoder = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const graph = createCoderGraph({ recursiveCoder: cliCoder });
    const result = await graph.invoke({
      taskDescription: "Build a calculator",
      codeContext: {},
      qualityThreshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.implementationSummary).toBe("Built calculator");
    expect(result.qualityScore).toBe(0.92);
    expect(result.toolsUsed).toEqual(["claude-code-cli"]);
  });

  it("should pause workflow when CLI coder fails to complete", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Timed out",
      completionDetected: false,
      attempts: 3,
    });

    const cliCoder = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const graph = createCoderGraph({ recursiveCoder: cliCoder });
    const result = await graph.invoke({
      taskDescription: "Build a calculator",
      codeContext: {},
      qualityThreshold: 0.7,
    });

    expect(result.qualityScore).toBe(0.3);
    expect(result.argueResponse).toBeDefined();
    expect(result.argueResponse!.type).toBe("validation_failed");
    // Workflow pauses at argue (doesn't reach finalize), success not set
    expect(result.success).toBeFalsy();
  });

  it("should handle fix mode with verification output", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Fixed",
      completionDetected: true,
      attempts: 1,
      marker: { summary: "Fixed lint errors", qualityScore: 0.88, modifiedFiles: ["calc.ts"] },
      verificationOutput: "All tests pass",
    });

    const cliCoder = createClaudeCodeCoderNode({
      cwd: "/tmp/test",
      verificationPass: true,
    });
    const graph = createCoderGraph({ recursiveCoder: cliCoder });
    const result = await graph.invoke({
      taskDescription: "Fix lint errors",
      codeContext: {
        errorReports: [{ file: "calc.ts", line: 3, message: "Unused variable", type: "lint" }],
      },
      qualityThreshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.fixSummary).toBe("Fixed lint errors");
    expect(result.validationResult!.warnings[0]).toContain("Verification:");
  });

  it("should fail validation when quality below threshold despite completion", async () => {
    mockRunCoder.mockResolvedValueOnce({
      output: "Done but low quality",
      completionDetected: true,
      attempts: 1,
      marker: { qualityScore: 0.4, summary: "Partial implementation" },
    });

    const cliCoder = createClaudeCodeCoderNode({ cwd: "/tmp/test" });
    const graph = createCoderGraph({ recursiveCoder: cliCoder });
    const result = await graph.invoke({
      taskDescription: "Build a calculator",
      codeContext: {},
      qualityThreshold: 0.7,
    });

    expect(result.qualityScore).toBe(0.4);
    expect(result.validationResult!.passed).toBe(false);
    expect(result.argueResponse).toBeDefined();
    expect(result.argueResponse!.type).toBe("validation_failed");
  });
});
