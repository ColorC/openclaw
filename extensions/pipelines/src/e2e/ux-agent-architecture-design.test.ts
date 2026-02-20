/**
 * E2E Tests — UX Agent testing Architecture Design output quality
 *
 * Phase 1: Run architecture design graph directly with a known requirement
 * Phase 2: UX Agent evaluates the generated OpenSpec documents
 *
 * Two test cases:
 * 1. Medium-scale project (图书管理系统)
 * 2. Large-scale project (电商平台) — triggers hierarchical domain decomposition
 *
 * Run:
 *   GLM_API_KEY=xxx pnpm vitest run e2e/ux-agent-architecture-design.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

// ============================================================================
// Helpers
// ============================================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-ux-arch-"));
}

function detectProvider() {
  try {
    const realHome =
      process.env.OPENCLAW_REAL_HOME ??
      (() => {
        try {
          const passwd = fs.readFileSync("/etc/passwd", "utf-8");
          const uid = process.getuid?.();
          if (uid !== undefined) {
            const line = passwd.split("\n").find((l) => l.split(":")[2] === String(uid));
            if (line) return line.split(":")[5];
          }
        } catch {
          /* ignore */
        }
        return os.homedir();
      })();
    const cfgPath = path.join(realHome, ".openclaw", "openclaw.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    if (cfg.env && typeof cfg.env === "object") {
      for (const [k, v] of Object.entries(cfg.env)) {
        if (typeof v === "string" && !process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  } catch {
    /* ignore */
  }

  if (process.env.GLM_API_KEY ?? process.env.BIGMODEL_API_KEY) {
    return {
      name: "GLM-5",
      config: {
        apiKey: process.env.GLM_API_KEY ?? process.env.BIGMODEL_API_KEY,
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        defaultModel: "glm-5",
      },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: "OpenAI",
      config: {
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: "gpt-4o-mini",
      },
    };
  }
  return null;
}

const llmProvider = detectProvider();

const MEDIUM_REQUIREMENT = `构建一个在线图书管理系统。
目标用户：图书馆管理员和读者。
规模：中小型图书馆，约5000册图书，500个注册用户。
核心功能：图书管理CRUD、借阅/归还流程、逾期自动提醒、简单统计报表。
技术栈：Python FastAPI后端 + React前端 + PostgreSQL数据库。`;

const LARGE_REQUIREMENT = `构建一个电商平台。
目标用户：商家、消费者。
规模：支持10万+商品SKU，百万级注册用户。
核心功能：
1. 用户中心：注册/登录、个人信息管理、收货地址管理
2. 商品中心：商品发布/编辑/上下架、SKU管理、分类/标签体系、商品搜索
3. 订单中心：购物车、下单流程、订单状态机、退款/退货
技术栈：Java Spring Boot微服务 + Vue3前端 + MySQL + Redis。
非功能需求：高可用、水平扩展。`;

// ============================================================================
// Shared: run architecture + UX Agent evaluation
// ============================================================================

async function runArchitectureTest(
  requirement: string,
  dir: string,
  label: string,
  options?: { skipUxAgent?: boolean },
) {
  const { runUxTest } = await import("../testing/ux-agent.js");
  const { createChainContext, disposeChainContext } = await import("../chains/chain-context.js");
  const { OpenAIModelProvider } = await import("../llm/openai-model-provider.js");
  const { PromptRegistry } = await import("../prompts/prompt-registry.js");
  const { createArchitectureDesignGraph } = await import("../workflows/architecture-design.js");
  const { createLlmDevPipelineConfig } = await import("../chains/chain-dev-pipeline.js");
  const { generateDesignMarkdown, generateArchitectureTasksMarkdown, generateSpecMarkdown } =
    await import("../llm-nodes/openspec-generators.js");

  const modelProvider = new OpenAIModelProvider(llmProvider!.config);

  const ctx = createChainContext({
    dbPath: path.join(dir, "pm.db"),
    projectRoot: dir,
    projectName: `ux-arch-${label}`,
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

  try {
    // ── Phase 1: Run architecture design graph ──
    console.log(`[${label}] Phase 1: Running architecture design graph...`);
    const llmConfig = createLlmDevPipelineConfig(ctx);
    const archGraph = createArchitectureDesignGraph(llmConfig.architectureOverrides);
    const archResult = await archGraph.invoke({
      requirement,
      scenario: "new_project" as const,
    });

    // Generate OpenSpec documents
    const designMd = generateDesignMarkdown(archResult);
    const tasksMd = generateArchitectureTasksMarkdown(archResult);
    const specMd = generateSpecMarkdown(archResult);

    // Save to files
    const outputDir = path.join(dir, "output");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "design.md"), designMd);
    fs.writeFileSync(path.join(outputDir, "tasks.md"), tasksMd);
    fs.writeFileSync(path.join(outputDir, "spec.md"), specMd);
    fs.writeFileSync(
      path.join(outputDir, "raw-state.json"),
      JSON.stringify(
        {
          modules: archResult.modules,
          interfaces: archResult.interfaces,
          entities: archResult.entities,
          apiEndpoints: archResult.apiEndpoints,
          domains: archResult.domains,
          selectedPattern: archResult.selectedPattern,
          fileStructure: archResult.fileStructure,
          designReview: archResult.designReview,
          validationResult: archResult.validationResult,
          success: archResult.success,
          error: archResult.error,
        },
        null,
        2,
      ),
    );

    const moduleCount = archResult.modules?.length ?? 0;
    const ifaceCount = archResult.interfaces?.length ?? 0;
    const entityCount = archResult.entities?.length ?? 0;
    const endpointCount = archResult.apiEndpoints?.length ?? 0;
    const domainCount = archResult.domains?.length ?? 0;

    console.log(`[${label}] Phase 1 complete:`);
    console.log(`  - Modules: ${moduleCount}`);
    console.log(`  - Interfaces: ${ifaceCount}`);
    console.log(`  - Entities: ${entityCount}`);
    console.log(`  - API Endpoints: ${endpointCount}`);
    console.log(`  - Domains: ${domainCount}`);
    console.log(`  - design.md: ${designMd.length} chars`);
    console.log(`  - tasks.md: ${tasksMd.length} chars`);
    console.log(`  - spec.md: ${specMd.length} chars`);

    // Build condensed summary
    const moduleNames = (archResult.modules ?? []).map((m: any) => m.name).join(", ");
    const ifaceNames = (archResult.interfaces ?? []).map((i: any) => i.name).join(", ");
    const entityNames = (archResult.entities ?? []).map((e: any) => e.name).join(", ");
    const endpointPaths = (archResult.apiEndpoints ?? [])
      .map((e: any) => `${e.method} ${e.path}`)
      .join(", ");
    const domainNames = (archResult.domains ?? []).map((d: any) => d.name).join(", ");
    const pattern = archResult.selectedPattern ?? "unknown";

    const summary = `
Architecture Design Output Summary:
- Pattern: ${pattern}
- Domains (${domainCount}): ${domainNames || "(none — flat design)"}
- Modules (${moduleCount}): ${moduleNames}
- Interfaces (${ifaceCount}): ${ifaceNames}
- Entities (${entityCount}): ${entityNames}
- API Endpoints (${endpointCount}): ${endpointPaths}
- design.md: ${designMd.length} chars (${designMd.split("\n").length} lines)
- tasks.md: ${tasksMd.length} chars
- spec.md: ${specMd.length} chars
- Has File Structure: ${!!archResult.fileStructure}
- Has Design Review: ${!!archResult.designReview}
- Has Validation: ${!!archResult.validationResult}
- design.md sections: Context=${designMd.includes("## Context")}, Decisions=${designMd.includes("## Decisions")}, Modules=${designMd.includes("## Module Design")}, Interfaces=${designMd.includes("## Interface Design")}, DataModel=${designMd.includes("## Data Model")}, API=${designMd.includes("## API Endpoints")}

First 200 lines of design.md:
${designMd.split("\n").slice(0, 200).join("\n")}
`.trim();

    // ── Phase 2: UX Agent evaluates (optional) ──
    if (options?.skipUxAgent) {
      console.log(`[${label}] Skipping UX Agent evaluation (Phase 1 only).`);
      return {
        result: {
          finished: true,
          assessmentLevel: 0,
          summary: "skipped",
          iterations: 0,
          report: "",
        },
        archResult,
        moduleCount,
        ifaceCount,
        entityCount,
        endpointCount,
        domainCount,
      };
    }

    console.log(`[${label}] Phase 2: UX Agent evaluating output...`);
    const result = await runUxTest({
      task: `
Evaluate the architecture design output for: "${requirement.slice(0, 100)}..."

Original requirement (use this as the ONLY basis for evaluation):
${requirement}

${summary}

You can also read the full files if needed:
- ${outputDir}/design.md
- ${outputDir}/tasks.md
- ${outputDir}/spec.md
- ${outputDir}/raw-state.json

Evaluate and fill in report_builder fields:
- requirementUnderstanding: Does the architecture match the requirement?
- requirementCompleteness: Are all features covered? Are entities and API endpoints reasonable?
- outputQuality: Rate the design document quality (modules, interfaces, data model, API endpoints, OpenSpec format)
- assessmentLevel: 1=perfect, 2=good, 3=acceptable, 4=poor, 5=fail
- assessmentReason: Brief explanation
Then call finish with your assessment.
`.trim(),
      targetCtx: ctx,
      modelConfig: llmProvider!.config,
      maxIterations: 10,
      temperature: 0.7,
      reportOutputDir: path.join(dir, "reports"),
      evaluationMode: "e2e",
    });

    console.log(`[${label}] ✅ UX Agent test completed:`);
    console.log(`  - Finished: ${result.finished}`);
    console.log(`  - Assessment: ${result.assessmentLevel}`);
    console.log(`  - Summary: ${result.summary}`);
    console.log(`  - Iterations: ${result.iterations}`);

    return { result, archResult, moduleCount, ifaceCount, entityCount, endpointCount, domainCount };
  } finally {
    disposeChainContext(ctx);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe.skipIf(!llmProvider)(
  `UX Agent — Architecture Design E2E ${llmProvider ? `(${llmProvider.name})` : ""}`,
  () => {
    let dir: string;

    beforeEach(() => {
      dir = tmpDir();
    });
    afterEach(() => {
      console.log(
        `[cleanup] Output dir preserved: ${dir}`,
      ); /* fs.rmSync(dir, { recursive: true, force: true }); */
    });

    it("medium-scale: library management system", async () => {
      const { result, moduleCount, ifaceCount, entityCount, endpointCount, domainCount } =
        await runArchitectureTest(MEDIUM_REQUIREMENT, dir, "medium");

      // Medium project should NOT trigger domain decomposition
      expect(domainCount).toBe(0);
      // Should have reasonable module/interface counts
      expect(moduleCount).toBeGreaterThanOrEqual(2);
      expect(ifaceCount).toBeGreaterThanOrEqual(2);
      // Should have entities and endpoints (Phase 1 new features)
      expect(entityCount).toBeGreaterThanOrEqual(1);
      expect(endpointCount).toBeGreaterThanOrEqual(1);

      expect(result.report).toContain("# 用户体验测试报告");
      expect(result.iterations).toBeGreaterThan(0);
    }, 1_800_000); // 30 min (GLM-5 is slow, 16 nodes + UX Agent)

    it("large-scale: e-commerce platform (hierarchical design)", async () => {
      const { moduleCount, ifaceCount, entityCount, endpointCount, domainCount } =
        await runArchitectureTest(LARGE_REQUIREMENT, dir, "large", { skipUxAgent: true });

      // Large project SHOULD trigger domain decomposition
      expect(domainCount).toBeGreaterThanOrEqual(2);
      // Should have reasonable module/interface counts
      expect(moduleCount).toBeGreaterThanOrEqual(3);
      expect(ifaceCount).toBeGreaterThanOrEqual(2);
      // Should have entities and endpoints
      expect(entityCount).toBeGreaterThanOrEqual(2);
      expect(endpointCount).toBeGreaterThanOrEqual(3);
    }, 7_200_000); // 2h (GLM-5: ~3-5 min per structured call × ~20 calls)
  },
);
