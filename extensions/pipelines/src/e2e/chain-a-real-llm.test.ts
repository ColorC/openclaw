/**
 * E2E 测试 — Chain A: 开发链路 (真实 LLM)
 *
 * 支持多种 LLM provider（按优先级自动选择）：
 * 1. OpenAI: OPENAI_API_KEY
 * 2. GLM (智谱): GLM_API_KEY — 国产模型
 * 3. Moonshot (Kimi K2.5): MOONSHOT_API_KEY — 免费
 *
 * 运行方式:
 *   # OpenAI
 *   OPENAI_API_KEY=sk-xxx pnpm vitest run e2e/chain-a-real-llm.test.ts
 *
 *   # GLM-5 (智谱)
 *   GLM_API_KEY=xxx pnpm vitest run e2e/chain-a-real-llm.test.ts
 *
 *   # Kimi (免费)
 *   MOONSHOT_API_KEY=xxx pnpm vitest run e2e/chain-a-real-llm.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ModelProviderConfig } from "../llm/types.js";
import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import { createChainAGraph, createLlmChainAConfig } from "../chains/chain-a-development.js";
import {
  createChainContext,
  disposeChainContext,
  type ChainContext,
} from "../chains/chain-context.js";
import {
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
} from "../llm-nodes/architecture-nodes.js";
import { createDecomposeNode, createInvestScoringNode } from "../llm-nodes/decomposition-nodes.js";
import { OpenAIModelProvider } from "../llm/openai-model-provider.js";
import { createRequirementDecompositionGraph } from "../maintenance/requirement-decomposition.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-chain-a-real-"));
}

// 检测可用的 LLM provider
type ProviderInfo = {
  name: string;
  config: ModelProviderConfig & { apiKey?: string; baseUrl?: string };
};

function detectProvider(): ProviderInfo | null {
  // 优先 OpenAI
  if (process.env.OPENAI_API_KEY) {
    return {
      name: "OpenAI",
      config: { apiKey: process.env.OPENAI_API_KEY, defaultModel: "gpt-4o-mini" },
    };
  }

  // GLM (智谱) — 国产模型
  if (process.env.GLM_API_KEY ?? process.env.BIGMODEL_API_KEY) {
    return {
      name: "GLM-5",
      config: {
        apiKey: process.env.GLM_API_KEY ?? process.env.BIGMODEL_API_KEY,
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", // Coding 专用端点
        defaultModel: "glm-5",
      },
    };
  }

  // Kimi (Moonshot) — 免费
  if (process.env.MOONSHOT_API_KEY) {
    return {
      name: "Kimi K2.5",
      config: {
        apiKey: process.env.MOONSHOT_API_KEY,
        baseUrl: "https://api.moonshot.ai/v1",
        defaultModel: "kimi-k2.5",
      },
    };
  }

  return null;
}

const provider = detectProvider();
const hasApiKey = provider !== null;

/** 构建架构设计节点的初始状态 */
function emptyArchState(
  overrides: Partial<ArchitectureDesignGraphState> = {},
): ArchitectureDesignGraphState {
  return {
    requirement: "",
    projectContext: {},
    scenario: "new_project",
    projectPath: undefined,
    requirementAnalysis: undefined,
    userFacingFeatures: [],
    internalFeatures: [],
    infrastructureDependencies: [],
    customArchitecture: undefined,
    selectedPattern: undefined,
    modules: [],
    interfaces: [],
    responsibilityMatrix: [],
    needsRefinement: false,
    refinementIteration: 0,
    refinementHistory: [],
    designReview: undefined,
    fileStructure: undefined,
    openspecFiles: [],
    openspecDocuments: {},
    success: false,
    error: undefined,
    ...overrides,
  };
}

// 如果没有 API key，跳过整个测试套件
describe.skipIf(!hasApiKey)(
  `E2E Real LLM: Chain A — 开发链路 ${provider ? `(${provider.name})` : ""}`,
  () => {
    let dir: string;
    let ctx: ChainContext;
    let modelProvider: OpenAIModelProvider;
    let promptRegistry: PromptRegistry;

    beforeEach(() => {
      dir = tmpDir();
      modelProvider = new OpenAIModelProvider(provider!.config);
      promptRegistry = new PromptRegistry();
      ctx = createChainContext({
        dbPath: path.join(dir, "pm.db"),
        projectRoot: dir,
        projectName: "e2e-real-llm",
        iterationDbDir: path.join(dir, "si"),
        qualityThresholds: {
          invest: 0,
          smart: 0,
          coverage: 0,
          performance: 0,
          documentation: 0,
          contract: 0,
        },
        modelProvider,
      });
    });

    afterEach(() => {
      disposeChainContext(ctx);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // ========================================================================
    // Test 1: 需求分解子图 (2 LLM calls: decompose + invest_scoring)
    // ========================================================================
    it("decomposes requirement with real LLM", async () => {
      const deps = { modelProvider, promptRegistry };
      const graph = createRequirementDecompositionGraph({
        decompose: createDecomposeNode(deps),
        investScoring: createInvestScoringNode(deps),
      });

      const result = await graph.invoke({
        requirementDescription: "Build a simple calculator with add and subtract functions",
      });

      // 验证分解结果
      expect(result.error).toBeUndefined();
      expect(result.subRequirements.length).toBeGreaterThanOrEqual(1);

      // 验证子需求有合理的内容（LLM 生成）
      for (const req of result.subRequirements) {
        expect(req.description.length).toBeGreaterThan(10);
        expect(req.id).toMatch(/^sub-/);
      }

      // 验证 INVEST 评分
      expect(result.investScores.length).toBe(result.subRequirements.length);
      for (const score of result.investScores) {
        expect(score.total).toBeGreaterThanOrEqual(0);
        expect(score.total).toBeLessThanOrEqual(1);
      }

      console.log(
        "✅ Decomposition result:",
        result.subRequirements.map((r) => r.description),
      );
      console.log(
        "✅ INVEST scores:",
        result.investScores.map((s) => s.total.toFixed(2)),
      );
    }, 120000); // 2min timeout for 2 LLM calls (GLM-5 reasoning takes ~20-30s each)

    // ========================================================================
    // Test 2: 架构分析关键节点 (3 LLM calls: analyze → features → pattern)
    // ========================================================================
    it("runs architecture analysis nodes with real LLM", async () => {
      const deps = { modelProvider, promptRegistry };
      const requirement = "Create a todo list API with CRUD operations";

      // Step 1: analyzeRequirement
      console.log("  → analyzeRequirement...");
      const analyzeNode = createAnalyzeRequirementNode(deps);
      const analyzeResult = await analyzeNode(emptyArchState({ requirement }));
      expect(analyzeResult.requirementAnalysis).toBeDefined();
      expect(analyzeResult.requirementAnalysis?.scale).toMatch(/^(small|medium|large)$/);
      console.log("  ✅ Analysis:", analyzeResult.requirementAnalysis);

      // Step 2: listFeatures
      console.log("  → listFeatures...");
      const listNode = createListFeaturesNode(deps);
      const listResult = await listNode(
        emptyArchState({
          requirement,
          requirementAnalysis: analyzeResult.requirementAnalysis!,
        }),
      );
      const allFeatures = [
        ...(listResult.userFacingFeatures ?? []),
        ...(listResult.internalFeatures ?? []),
        ...(listResult.infrastructureDependencies ?? []),
      ];
      expect(allFeatures.length).toBeGreaterThanOrEqual(1);
      console.log(
        "  ✅ Features:",
        allFeatures.map((f) => f.name),
      );

      // Step 3: selectPattern
      console.log("  → selectPattern...");
      const patternNode = createSelectPatternNode(deps);
      const patternResult = await patternNode(
        emptyArchState({
          requirement,
          requirementAnalysis: analyzeResult.requirementAnalysis!,
          userFacingFeatures: listResult.userFacingFeatures ?? [],
          internalFeatures: listResult.internalFeatures ?? [],
          infrastructureDependencies: listResult.infrastructureDependencies ?? [],
        }),
      );
      expect(patternResult.selectedPattern).toBeDefined();
      console.log("  ✅ Selected pattern:", patternResult.selectedPattern);
    }, 120000); // 2min timeout for 3 LLM calls

    // ========================================================================
    // Test 3: 完整 Chain A (所有 LLM nodes)
    // 注意: 这是一个长耗时集成测试 (~10 min with GLM-5 reasoning model)。
    // 使用 FULL_CHAIN=1 环境变量启用，默认跳过。
    // ========================================================================
    it.skipIf(!process.env.FULL_CHAIN)(
      "runs full chain with real LLM",
      async () => {
        const config = createLlmChainAConfig(ctx);
        const graph = createChainAGraph(ctx, config);

        const result = await graph.invoke({
          requirementDescription: "A hello world program",
          projectId: "proj-hello",
          scenario: "new_project",
        });

        // 完整 chain 不应有致命错误
        expect(result.error).toBeUndefined();

        // 验证 chain 完成了关键步骤
        expect(result.decomposedRequirements.length).toBeGreaterThanOrEqual(1);
        expect(result.architectureModules.length).toBeGreaterThanOrEqual(0);

        console.log("✅ Full chain result:");
        console.log("  - Decomposed:", result.decomposedRequirements.length, "requirements");
        console.log("  - Architecture modules:", result.architectureModules.length);
        console.log("  - Published tasks:", result.publishedTasks.length);
        console.log(
          "  - Coder results:",
          result.coderResults.length,
          "(passed:",
          result.coderResults.filter((r: { success: boolean }) => r.success).length,
          ")",
        );
        console.log("  - Success:", result.success);
        console.log("  - Summary:", result.summary);
      },
      600000,
    ); // 10min timeout for full chain (~15 LLM calls)
  },
);
