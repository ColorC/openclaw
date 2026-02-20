/**
 * Claude Code CLI Coder — 单元测试
 *
 * 通过 mock runCommandWithTimeout 和 fs 验证 CLI 调用逻辑。
 */

import * as path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error("ENOENT")),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

// Mock runCommandWithTimeout
vi.mock("../../../../src/process/exec.js", () => ({
  runCommandWithTimeout: vi.fn(),
}));

import { rm, access, readFile } from "node:fs/promises";
import { runCommandWithTimeout } from "../../../../src/process/exec.js";
import { runClaudeCodeCoder } from "./claude-code-coder.js";

const mockRunCommand = runCommandWithTimeout as ReturnType<typeof vi.fn>;
const mockRm = rm as ReturnType<typeof vi.fn>;
const mockAccess = access as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ============================================================================
// Helpers
// ============================================================================

const TEST_CWD = "/tmp/claude-code-coder-test";
const MARKER_PATH = path.join(TEST_CWD, ".openclaw-task-done");

function mockCliSuccess(output: Record<string, unknown> = {}) {
  return {
    stdout: JSON.stringify({ session_id: "sess-123", message: "Done", ...output }),
    stderr: "",
    code: 0,
    signal: null,
    killed: false,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("runClaudeCodeCoder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults
    mockRm.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("should detect completion when marker file exists on first attempt", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    // fileExists check after CLI: found
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ summary: "Implemented X", qualityScore: 0.9, modifiedFiles: ["a.ts"] }),
    );

    const result = await runClaudeCodeCoder("Build feature X", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      verificationPass: false,
    });

    expect(result.completionDetected).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.marker?.qualityScore).toBe(0.9);
    expect(result.marker?.summary).toBe("Implemented X");
    expect(result.marker?.modifiedFiles).toEqual(["a.ts"]);
  });

  it("should retry when marker not found and detect on second attempt", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());

    // First fileExists: not found; second: found
    mockAccess.mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ summary: "Done", qualityScore: 0.85 }));

    const result = await runClaudeCodeCoder("Build feature X", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      maxRetries: 3,
      verificationPass: false,
    });

    expect(result.completionDetected).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockRunCommand).toHaveBeenCalledTimes(2);

    // Second call should use --resume
    const secondCallArgs = mockRunCommand.mock.calls[1][0] as string[];
    expect(secondCallArgs).toContain("--resume");
    expect(secondCallArgs).toContain("sess-123");
  });

  it("should exhaust retries and return completionDetected=false", async () => {
    mockRunCommand.mockResolvedValue(mockCliSuccess());
    // Marker never exists (default mock)

    const result = await runClaudeCodeCoder("Build feature X", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      maxRetries: 2,
      verificationPass: false,
    });

    expect(result.completionDetected).toBe(false);
    expect(result.attempts).toBe(2);
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
  });

  it("should use default model 'sonnet' when not specified", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.8 }));

    await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      verificationPass: false,
    });

    const args = mockRunCommand.mock.calls[0][0] as string[];
    expect(args).toContain("--model");
    const modelIdx = args.indexOf("--model");
    expect(args[modelIdx + 1]).toBe("sonnet");
  });

  it("should use custom model when specified", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.8 }));

    await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      model: "opus",
      verificationPass: false,
    });

    const args = mockRunCommand.mock.calls[0][0] as string[];
    const modelIdx = args.indexOf("--model");
    expect(args[modelIdx + 1]).toBe("opus");
  });

  it("should include --append-system-prompt on first attempt only", async () => {
    mockRunCommand.mockResolvedValue(mockCliSuccess());
    mockAccess.mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.8 }));

    await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      maxRetries: 3,
      verificationPass: false,
    });

    const firstArgs = mockRunCommand.mock.calls[0][0] as string[];
    expect(firstArgs).toContain("--append-system-prompt");

    const secondArgs = mockRunCommand.mock.calls[1][0] as string[];
    expect(secondArgs).not.toContain("--append-system-prompt");
  });

  it("should run verification pass when enabled and completion detected", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess({ message: "All tests pass" }));

    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.9, summary: "Done" }));

    const result = await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      verificationPass: true,
    });

    expect(result.completionDetected).toBe(true);
    expect(result.verificationOutput).toBe("All tests pass");
    expect(mockRunCommand).toHaveBeenCalledTimes(2);

    const verifyArgs = mockRunCommand.mock.calls[1][0] as string[];
    expect(verifyArgs).toContain("--resume");
  });

  it("should handle CLI non-zero exit gracefully", async () => {
    mockRunCommand.mockResolvedValueOnce({
      stdout: JSON.stringify({ session_id: "sess-err" }),
      stderr: "Error occurred",
      code: 1,
      signal: null,
      killed: false,
    });
    // Marker never exists (default mock)

    const result = await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      maxRetries: 1,
      verificationPass: false,
    });

    expect(result.completionDetected).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("should pass cwd to runCommandWithTimeout", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.8 }));

    await runClaudeCodeCoder("task", {
      cwd: "/my/project",
      completionMarkerPath: MARKER_PATH,
      verificationPass: false,
    });

    const opts = mockRunCommand.mock.calls[0][1] as { cwd: string };
    expect(opts.cwd).toBe("/my/project");
  });

  it("should include --dangerously-skip-permissions flag", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ qualityScore: 0.8 }));

    await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      verificationPass: false,
    });

    const args = mockRunCommand.mock.calls[0][0] as string[];
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
  });

  it("should handle malformed marker file gracefully", async () => {
    mockRunCommand.mockResolvedValueOnce(mockCliSuccess());
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce("not json");

    const result = await runClaudeCodeCoder("task", {
      cwd: TEST_CWD,
      completionMarkerPath: MARKER_PATH,
      verificationPass: false,
    });

    expect(result.completionDetected).toBe(true);
    expect(result.marker).toBeUndefined();
  });
});
