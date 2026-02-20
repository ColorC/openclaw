/**
 * Coder LLM Nodes — 测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ChatResponse } from "../llm/types.js";
import type { CoderGraphState } from "../workflows/coder.js";
import { MockModelProvider, mockToolCallResponse } from "../llm/mock-model-provider.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createRecursiveCoderNode, createHandleArgueNode } from "./coder-nodes.js";

// ============================================================================
// Helpers
// ============================================================================

let tempDir: string;

function makeState(overrides: Partial<CoderGraphState> = {}): CoderGraphState {
  return {
    taskDescription: "Implement a calculator with add and subtract",
    codeContext: { allowedDir: tempDir },
    maxIterations: 10,
    qualityThreshold: 0.7,
    workDir: tempDir,
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

/** Mock a multi-turn agent sequence: write_file → coder_done */
function mockAgentSequence(
  files: Array<{ path: string; content: string }>,
  summary: string,
  qualityScore: number,
): ChatResponse[] {
  const responses: ChatResponse[] = [];

  // One response per write_file call
  for (const f of files) {
    responses.push(mockToolCallResponse("write_file", { path: f.path, content: f.content }));
  }

  // Final response: coder_done
  responses.push(
    mockToolCallResponse("coder_done", {
      summary,
      createdFiles: files.map((f) => f.path),
      modifiedFiles: [],
      qualityScore,
    }),
  );

  return responses;
}

// ============================================================================
// recursiveCoder
// ============================================================================

describe("createRecursiveCoderNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coder-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create files and complete via agent loop", async () => {
    const responses = mockAgentSequence(
      [
        {
          path: "src/calc.ts",
          content: "export function add(a: number, b: number) { return a + b; }",
        },
      ],
      "Implemented add function",
      0.85,
    );
    const mp = new MockModelProvider(responses);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.qualityScore).toBe(0.85);
    expect(result.qualityHistory).toEqual([0.85]);
    expect(result.validationResult!.passed).toBe(true);
    expect(result.modifiedFiles).toContain("src/calc.ts");
    expect(result.iterationCount).toBe(1);
    expect(result.implementationSummary).toBe("Implemented add function");

    // Verify file was actually written
    const filePath = path.join(tempDir, "src/calc.ts");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("add");
  });

  it("should include error context when fixing", async () => {
    const responses = mockAgentSequence(
      [{ path: "src/calc.ts", content: "// fixed code" }],
      "Fixed lint errors",
      0.75,
    );
    const mp = new MockModelProvider(responses);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const state = makeState({
      codeContext: {
        allowedDir: tempDir,
        skeleton: "// skeleton",
        errorReports: [
          { file: "src/calc.ts", line: 10, message: "Missing return type", type: "lint" },
        ],
      },
    });
    await node(state);

    const systemMsg = mp.calls[0].messages[0];
    expect(systemMsg.content).toContain("Fix the code");
    expect(systemMsg.content).toContain("Missing return type");
  });

  it("should handle graceful exit when LLM returns no tool calls", async () => {
    const mp = new MockModelProvider([{ content: "I'm done thinking" }]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    // Agent loop exits gracefully with default quality
    expect(result.qualityScore).toBe(0.5);
    expect(result.validationResult!.passed).toBe(false);
    expect(result.iterationCount).toBe(1);
  });

  it("should use coder modelRole", async () => {
    const responses = mockAgentSequence([{ path: "x.ts", content: "x" }], "done", 0.8);
    const mp = new MockModelProvider(responses);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    await node(makeState());

    expect(mp.calls[0].options?.modelRole).toBe("coder");
  });

  it("should enforce directory constraint", async () => {
    // write_file with path escape attempt — the tool executor should reject it
    const mp = new MockModelProvider([
      mockToolCallResponse("write_file", { path: "../../etc/passwd", content: "hacked" }),
      mockToolCallResponse("coder_done", { summary: "done", qualityScore: 0.5 }),
    ]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    await node(makeState());

    // File should NOT exist outside allowed dir
    expect(fs.existsSync(path.join(tempDir, "../../etc/passwd"))).toBe(false);
  });
});

// ============================================================================
// handleArgue
// ============================================================================

describe("createHandleArgueNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coder-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return no argue when validation passed", async () => {
    const mp = new MockModelProvider([]);
    const node = createHandleArgueNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({ validationResult: { passed: true, errors: [], warnings: [] } }),
    );

    expect(result.argueHandled).toBe(false);
    expect(result.argueResponse).toBeUndefined();
    expect(mp.calls).toHaveLength(0); // No LLM call needed
  });

  it("should decide retry when quality is low but fixable", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("decide_action", {
        action: "retry",
        reason: "Quality score below threshold, fixable errors",
      }),
    ]);
    const node = createHandleArgueNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        validationResult: { passed: false, errors: ["Missing type annotation"], warnings: [] },
        qualityScore: 0.5,
      }),
    );

    expect(result.argueResponse!.type).toBe("quality_below_threshold");
    expect(result.argueResponse!.suggestedAction).toBe("retry_with_fixes");
    expect(result.argueHandled).toBe(false);
  });

  it("should decide accept when quality is acceptable", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("decide_action", {
        action: "accept",
        reason: "Minor issues only",
      }),
    ]);
    const node = createHandleArgueNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        validationResult: { passed: false, errors: ["Minor style issue"], warnings: [] },
        qualityScore: 0.72,
      }),
    );

    expect(result.argueHandled).toBe(false);
    expect(result.argueResponse).toBeUndefined();
  });

  it("should decide argue when validation criteria are wrong", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("decide_action", {
        action: "argue",
        reason: "Validation requires 100% coverage which is unrealistic",
        suggestedAction: "Lower coverage requirement to 80%",
      }),
    ]);
    const node = createHandleArgueNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        validationResult: { passed: false, errors: ["Coverage 85% < 100%"], warnings: [] },
        qualityScore: 0.65,
      }),
    );

    expect(result.argueResponse!.type).toBe("validation_failed");
    expect(result.argueResponse!.details).toContain("unrealistic");
    expect(result.argueResponse!.suggestedAction).toContain("80%");
  });

  it("should fallback to retry when no tool call", async () => {
    const mp = new MockModelProvider([{ content: "text" }]);
    const node = createHandleArgueNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(
      makeState({
        validationResult: { passed: false, errors: ["Error"], warnings: [] },
        qualityScore: 0.4,
      }),
    );

    expect(result.argueResponse!.type).toBe("quality_below_threshold");
    expect(mp.calls[0].options?.modelRole).toBe("reviewer");
  });
});
