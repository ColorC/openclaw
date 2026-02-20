/**
 * Chain A LLM 集成测试
 *
 * 使用 MockModelProvider 验证 LLM 节点在整个链路中的正确集成。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ChatResponse } from "../llm/types.js";
import { createChainAGraph, createLlmChainAConfig } from "../chains/chain-a-development.js";
import { createChainContext, disposeChainContext } from "../chains/chain-context.js";
import { MockModelProvider, mockToolCallResponse } from "../llm/mock-model-provider.js";

// ============================================================================
// Helpers
// ============================================================================

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chain-a-llm-test-"));
}

// 创建一个完整的 mock 响应序列，覆盖 Chain A 的所有 LLM 调用
// 注意：为了简化测试，让 architecture 返回空 modules/interfaces，这样不会生成 coder 任务
function makeFullChainMockResponses(): Array<
  ChatResponse | { match: (m: any[]) => boolean; response: ChatResponse }
> {
  return [
    // Decomposition: decompose
    mockToolCallResponse("decompose_requirement", {
      sub_requirements: [
        { id: "sub-auth", description: "User authentication", category: "feature" },
        { id: "sub-api", description: "REST API endpoints", category: "task" },
      ],
    }),
    // Decomposition: investScoring
    mockToolCallResponse("score_invest", {
      scores: [
        {
          independent: 0.9,
          negotiable: 0.8,
          valuable: 0.9,
          estimable: 0.7,
          small: 0.8,
          testable: 0.9,
          total: 0.83,
        },
        {
          independent: 0.8,
          negotiable: 0.7,
          valuable: 0.8,
          estimable: 0.6,
          small: 0.7,
          testable: 0.8,
          total: 0.73,
        },
      ],
    }),
    // Architecture: analyzeRequirement
    mockToolCallResponse("analyze_requirement", {
      scale: "small",
      complexity: "low",
      domain: "web",
      keyEntities: ["User"],
    }),
    // Architecture: listFeatures
    mockToolCallResponse("list_features", { features: [] }),
    // Architecture: selectPattern
    mockToolCallResponse("select_pattern", {
      pattern: "simple",
      name: "Simple Architecture",
      description: "Minimal structure",
    }),
    // Architecture: designModules (empty - no coder tasks)
    mockToolCallResponse("design_modules", { modules: [] }),
    // Architecture: defineInterfaces (empty)
    mockToolCallResponse("define_interfaces", { interfaces: [] }),
    // Architecture: designReview
    mockToolCallResponse("design_review", { omissions: [], couplingIssues: [], suggestions: [] }),
    // Architecture: validateArchitecture
    mockToolCallResponse("validate_architecture", { needsRefinement: false }),
    // Architecture: designFileStructure
    mockToolCallResponse("design_file_structure", { structure: { src: {} } }),
    // Architecture: generateOpenspec
    mockToolCallResponse("generate_openspec", { files: [] }),
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe("Chain A with LLM nodes (mocked)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    dbPath = path.join(tempDir, "pm.db");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should run full chain with LLM nodes and mock provider", async () => {
    const modelProvider = new MockModelProvider(makeFullChainMockResponses());
    const promptRegistry = new (await import("../prompts/prompt-registry.js")).PromptRegistry();

    const ctx = createChainContext({
      dbPath,
      projectRoot: tempDir,
      projectName: "test-project",
      qualityThresholds: {
        invest: 0,
        smart: 0,
        coverage: 0,
        performance: 0,
        documentation: 0,
        contract: 0,
      },
    });

    // 注入 LLM 依赖
    (ctx as any).modelProvider = modelProvider;
    (ctx as any).promptRegistry = promptRegistry;

    const config = createLlmChainAConfig(ctx);
    expect(config.decompOverrides?.decompose).toBeDefined();
    expect(config.decompOverrides?.investScoring).toBeDefined();
    expect(config.architectureOverrides?.analyzeRequirement).toBeDefined();
    expect(config.coderOverrides?.recursiveCoder).toBeDefined();

    const graph = createChainAGraph(ctx, config);
    const result = await graph.invoke({
      requirementDescription: "Build a simple authentication system",
      projectId: "proj-1",
      scenario: "new_project",
    });

    expect(result.error).toBeUndefined();
    expect(result.decomposedRequirements.length).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Decomposed");

    // 验证 LLM 被调用了（至少 10 次：decompose, invest, analyze, listFeatures, selectPattern, designModules, defineInterfaces, designReview, validate, fileStructure, openspec, coder）
    expect(modelProvider.calls.length).toBeGreaterThanOrEqual(10);

    disposeChainContext(ctx);
  });

  it("createLlmChainAConfig returns empty config when no modelProvider", async () => {
    const ctx = createChainContext({
      dbPath,
      projectRoot: tempDir,
      projectName: "test-project",
    });

    const config = createLlmChainAConfig(ctx);
    expect(config.decompOverrides).toBeUndefined();
    expect(config.architectureOverrides).toBeUndefined();
    expect(config.coderOverrides).toBeUndefined();

    disposeChainContext(ctx);
  });
});
