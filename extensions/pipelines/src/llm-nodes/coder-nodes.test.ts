/**
 * Coder LLM Nodes — 测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { CoderGraphState } from "../workflows/coder.js";
import { MockModelProvider, mockToolCallResponse } from "../llm/mock-model-provider.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createRecursiveCoderNode, createHandleArgueNode } from "./coder-nodes.js";

// ============================================================================
// Helpers
// ============================================================================

function makeState(overrides: Partial<CoderGraphState> = {}): CoderGraphState {
  return {
    taskDescription: "Implement a calculator with add and subtract",
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

// ============================================================================
// recursiveCoder
// ============================================================================

describe("createRecursiveCoderNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
  });

  it("should generate code via tool call", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("generate_code", {
        code: "export function add(a: number, b: number) { return a + b; }",
        modifiedFiles: ["src/calc.ts"],
        qualityScore: 0.85,
        explanation: "Implemented add function",
      }),
    ]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.currentCode).toContain("add");
    expect(result.qualityScore).toBe(0.85);
    expect(result.qualityHistory).toEqual([0.85]);
    expect(result.validationResult!.passed).toBe(true);
    expect(result.modifiedFiles).toEqual(["src/calc.ts"]);
    expect(result.iterationCount).toBe(1);
  });

  it("should include error context when fixing", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("generate_code", {
        code: "// fixed code",
        qualityScore: 0.75,
      }),
    ]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const state = makeState({
      codeContext: {
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

  it("should fallback when LLM does not call tool", async () => {
    const mp = new MockModelProvider([{ content: "text response" }]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    const result = await node(makeState());

    expect(result.currentCode).toBe("// No code generated");
    expect(result.qualityScore).toBe(0.5);
    expect(result.validationResult!.passed).toBe(false);
    expect(result.validationResult!.errors[0]).toContain("did not call generate_code");
  });

  it("should use coder modelRole", async () => {
    const mp = new MockModelProvider([
      mockToolCallResponse("generate_code", { code: "x", qualityScore: 0.8 }),
    ]);
    const node = createRecursiveCoderNode({ modelProvider: mp, promptRegistry: pr });
    await node(makeState());

    expect(mp.calls[0].options?.modelRole).toBe("coder");
  });
});

// ============================================================================
// handleArgue
// ============================================================================

describe("createHandleArgueNode", () => {
  let pr: PromptRegistry;

  beforeEach(() => {
    pr = new PromptRegistry();
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
