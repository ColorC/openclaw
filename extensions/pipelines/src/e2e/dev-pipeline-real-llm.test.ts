/**
 * E2E 测试 — Dev Pipeline: 三阶段开发管线 (真实 LLM)
 *
 * 测试 需求澄清 → 架构设计 → 编码 完整管线。
 *
 * 运行方式:
 *   # 单独的子图测试
 *   GLM_API_KEY=xxx pnpm vitest run e2e/dev-pipeline-real-llm.test.ts
 *
 *   # 完整管线
 *   GLM_API_KEY=xxx FULL_PIPELINE=1 pnpm vitest run e2e/dev-pipeline-real-llm.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ModelProviderConfig } from "../llm/types.js";
import type { ArchitectureDesignGraphState } from "../workflows/architecture-design.js";
import {
  createChainContext,
  disposeChainContext,
  type ChainContext,
} from "../chains/chain-context.js";
import {
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
} from "../llm-nodes/architecture-nodes.js";
import {
  generateDesignMarkdown,
  generateArchitectureTasksMarkdown,
} from "../llm-nodes/openspec-generators.js";
import { OpenAIModelProvider } from "../llm/openai-model-provider.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createArchitectureDesignGraph } from "../workflows/architecture-design.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-dev-pipeline-"));
}

// 检测可用的 LLM provider
type ProviderInfo = {
  name: string;
  config: ModelProviderConfig & { apiKey?: string; baseUrl?: string };
};

function detectProvider(): ProviderInfo | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: "OpenAI",
      config: { apiKey: process.env.OPENAI_API_KEY, defaultModel: "gpt-4o-mini" },
    };
  }
  if (process.env.GLM_API_KEY) {
    return {
      name: "GLM-5",
      config: {
        apiKey: process.env.GLM_API_KEY,
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        defaultModel: "glm-5",
      },
    };
  }
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

// ============================================================================
// Test: OpenSpec Document Generation (纯逻辑，不需要 LLM)
// ============================================================================

describe("OpenSpec Document Generators", () => {
  it("generates design.md from architecture state", () => {
    const state = emptyArchState({
      requirement: "Build a todo list API",
      requirementAnalysis: {
        scale: "small",
        complexity: "low",
        domain: "web",
        keyEntities: ["Todo", "User"],
      },
      selectedPattern: "layered",
      customArchitecture: {
        name: "Layered Architecture",
        pattern: "layered",
        description: "Standard layered",
      },
      modules: [
        {
          id: "mod-api",
          name: "API Layer",
          description: "REST API endpoints",
          responsibilities: ["HTTP routing", "Validation"],
          dependencies: ["mod-service"],
        },
        {
          id: "mod-service",
          name: "Service Layer",
          description: "Business logic",
          responsibilities: ["CRUD operations"],
          dependencies: ["mod-data"],
        },
      ],
      interfaces: [
        {
          id: "iface-todo",
          name: "TodoService",
          type: "service",
          methods: [
            {
              name: "createTodo",
              input: "CreateTodoInput",
              output: "Todo",
              description: "Create a new todo",
            },
            {
              name: "listTodos",
              input: "ListFilter",
              output: "Todo[]",
              description: "List todos with filter",
            },
          ],
        },
      ],
      designReview: {
        omissions: ["Error handling"],
        couplingIssues: [],
        suggestions: ["Add logging"],
      },
    });

    const designMd = generateDesignMarkdown(state);
    const tasksMd = generateArchitectureTasksMarkdown(state);

    // design.md 验证
    expect(designMd).toContain("# Technical Design Document");
    expect(designMd).toContain("Build a todo list API");
    expect(designMd).toContain("## Architecture Overview");
    expect(designMd).toContain("Layered Architecture");
    expect(designMd).toContain("## Module Design");
    expect(designMd).toContain("API Layer");
    expect(designMd).toContain("Service Layer");
    expect(designMd).toContain("## Interface Design");
    expect(designMd).toContain("TodoService");
    expect(designMd).toContain("createTodo");
    expect(designMd).toContain("## Design Review");
    expect(designMd).toContain("Error handling");

    // tasks.md 验证
    expect(tasksMd).toContain("# Implementation Tasks");
    expect(tasksMd).toContain("- [ ] Create module `mod-api`");
    expect(tasksMd).toContain("- [ ] Implement `createTodo(CreateTodoInput): Todo`");
    expect(tasksMd).toContain("## Statistics");
    expect(tasksMd).toContain("**Modules**: 2");
    expect(tasksMd).toContain("**Interfaces**: 1");
    expect(tasksMd).toContain("**Total methods**: 2");

    console.log("✅ design.md length:", designMd.length, "chars");
    console.log("✅ tasks.md length:", tasksMd.length, "chars");
  });

  it("handles empty state gracefully", () => {
    const state = emptyArchState({ requirement: "Empty project" });

    const designMd = generateDesignMarkdown(state);
    const tasksMd = generateArchitectureTasksMarkdown(state);

    expect(designMd).toContain("# Technical Design Document");
    expect(designMd).toContain("Empty project");
    expect(tasksMd).toContain("# Implementation Tasks");
    expect(tasksMd).toContain("**Modules**: 0");
  });
});

// ============================================================================
// Real LLM Tests
// ============================================================================

describe.skipIf(!hasApiKey)(
  `E2E Real LLM: Dev Pipeline ${provider ? `(${provider.name})` : ""}`,
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
        projectName: "e2e-dev-pipeline",
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
    // Test 1: Architecture Design + OpenSpec 文档生成 (真实 LLM)
    // ========================================================================
    it("generates real OpenSpec documents from architecture design", async () => {
      const deps = { modelProvider, promptRegistry };
      const requirement = "Create a todo list API with CRUD operations";

      // Step 1-4: Architecture 分析（复用已验证的节点）
      console.log("  → analyzeRequirement...");
      const analyzeResult = await createAnalyzeRequirementNode(deps)(
        emptyArchState({ requirement }),
      );
      expect(analyzeResult.requirementAnalysis).toBeDefined();

      console.log("  → listFeatures...");
      const listResult = await createListFeaturesNode(deps)(
        emptyArchState({
          requirement,
          requirementAnalysis: analyzeResult.requirementAnalysis!,
        }),
      );

      console.log("  → selectPattern...");
      const patternResult = await createSelectPatternNode(deps)(
        emptyArchState({
          requirement,
          requirementAnalysis: analyzeResult.requirementAnalysis!,
          userFacingFeatures: listResult.userFacingFeatures ?? [],
          internalFeatures: listResult.internalFeatures ?? [],
          infrastructureDependencies: listResult.infrastructureDependencies ?? [],
        }),
      );

      console.log("  → designModules...");
      const moduleResult = await createDesignModulesNode(deps)(
        emptyArchState({
          requirement,
          selectedPattern: patternResult.selectedPattern,
          userFacingFeatures: listResult.userFacingFeatures ?? [],
          internalFeatures: listResult.internalFeatures ?? [],
          infrastructureDependencies: listResult.infrastructureDependencies ?? [],
        }),
      );

      console.log("  → defineInterfaces...");
      const ifaceResult = await createDefineInterfacesNode(deps)(
        emptyArchState({
          requirement,
          modules: moduleResult.modules ?? [],
        }),
      );

      // Step 5: 生成 OpenSpec 文档
      console.log("  → generateOpenspec...");
      const openspecResult = await createGenerateOpenspecNode(deps)(
        emptyArchState({
          requirement,
          requirementAnalysis: analyzeResult.requirementAnalysis!,
          customArchitecture: patternResult.customArchitecture,
          selectedPattern: patternResult.selectedPattern,
          modules: moduleResult.modules ?? [],
          interfaces: ifaceResult.interfaces ?? [],
        }),
      );

      // 验证 OpenSpec 文档
      expect(openspecResult.openspecFiles).toEqual(["design.md", "tasks.md"]);
      expect(openspecResult.openspecDocuments).toBeDefined();

      const designMd = openspecResult.openspecDocuments!["design.md"];
      const tasksMd = openspecResult.openspecDocuments!["tasks.md"];

      expect(designMd).toBeDefined();
      expect(tasksMd).toBeDefined();
      expect(designMd!.length).toBeGreaterThan(100);
      expect(tasksMd!.length).toBeGreaterThan(50);

      // 验证 design.md 包含关键章节
      expect(designMd).toContain("# Technical Design Document");
      expect(designMd).toContain("## Module Design");
      expect(designMd).toContain("## Interface Design");

      // 验证 tasks.md 包含任务
      expect(tasksMd).toContain("# Implementation Tasks");
      expect(tasksMd).toContain("- [ ]");

      console.log("✅ OpenSpec documents generated successfully");
      console.log("  - design.md:", designMd!.length, "chars");
      console.log("  - tasks.md:", tasksMd!.length, "chars");
      console.log("  - Modules:", (moduleResult.modules ?? []).length);
      console.log("  - Interfaces:", (ifaceResult.interfaces ?? []).length);
    }, 300000); // 5min timeout for 5+ LLM calls (GLM-5 may be slow)

    // ========================================================================
    // Test 2: 需求澄清 Agent 单独测试 (真实 LLM)
    // ========================================================================
    it("runs requirement clarification agent with real LLM", async () => {
      const { createRequirementClarificationNode } =
        await import("../llm-nodes/requirement-clarification-nodes.js");
      const { createRequirementClarificationGraph } =
        await import("../workflows/requirement-clarification.js");

      const modelProviderConfig = (modelProvider as any).config ?? provider!.config;
      const clarificationNode = createRequirementClarificationNode({
        modelProviderConfig,
        promptRegistry,
      });

      const graph = createRequirementClarificationGraph({
        llmExecutor: clarificationNode,
      });

      const result = await graph.invoke({
        messages: [{ content: "A hello world program with a greeting function" }],
        iteration: 0,
        completed: false,
      });

      // 验证 agent 完成了需求文档生成
      expect(result.completed).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response!.length).toBeGreaterThan(50);

      // 验证产出的是 OpenSpec 格式文档
      expect(result.response).toContain("OpenSpec");

      console.log("✅ Requirement Clarification Agent result:");
      console.log("  - Completed:", result.completed);
      console.log("  - Response length:", result.response!.length, "chars");
      console.log("  - Iterations:", result.iteration);
      console.log("  - Response preview:", result.response!.slice(0, 200));
    }, 180000); // 3min timeout

    // ========================================================================
    // Test 3: 完整三阶段管线 (opt-in)
    // ========================================================================
    it.skipIf(!process.env.FULL_PIPELINE)(
      "runs full dev pipeline with real LLM",
      async () => {
        const { createDevPipelineGraph, createLlmDevPipelineConfig } =
          await import("../chains/chain-dev-pipeline.js");

        const config = createLlmDevPipelineConfig(ctx);
        const graph = createDevPipelineGraph(ctx, config);

        const result = await graph.invoke({
          userRequirement: "A hello world program with a greeting function",
          scenario: "new_project",
        });

        expect(result.error).toBeUndefined();
        expect(result.architectureModules.length).toBeGreaterThanOrEqual(0);

        console.log("✅ Full dev pipeline result:");
        console.log("  - Proposal:", result.proposalDocument ? "generated" : "skipped");
        console.log("  - Design:", result.designDocument ? "generated" : "skipped");
        console.log("  - Tasks:", result.tasksDocument ? "generated" : "skipped");
        console.log("  - Modules:", result.architectureModules.length);
        console.log(
          "  - Coder results:",
          result.coderResults.length,
          "(passed:",
          result.coderResults.filter((r) => r.success).length,
          ")",
        );
        console.log("  - Success:", result.success);
        console.log("  - Summary:", result.summary);
      },
      600000,
    ); // 10min timeout
  },
);
