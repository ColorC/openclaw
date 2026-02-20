/**
 * E2E 测试 — 股市分析 Extension 完整开发管线
 *
 * 阶段 1: 新建项目 (new_project)
 *   - 需求: 模拟账户、读取股票、查询股票、模拟投资
 *   - 流程: 需求澄清 → 架构设计 → 编码
 *
 * 阶段 2: 增量修改 (modify_existing)
 *   - 需求: 多账户、统计功能
 *   - 流程: 加载现有架构 → 影响分析 → 增量设计 → 编码
 *
 * 运行方式:
 *   # 阶段 1 (新建项目)
 *   FULL_PIPELINE=1 pnpm vitest run e2e/stock-analyzer-e2e.test.ts
 *
 *   # 阶段 1 + 阶段 2 (完整流程)
 *   FULL_PIPELINE=1 INCREMENTAL=1 pnpm vitest run e2e/stock-analyzer-e2e.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { ModelProviderConfig } from "../llm/types.js";
import {
  createRequirementClarificationNode,
  createAnalyzeRequirementNode,
  createListFeaturesNode,
  createSelectPatternNode,
  createDesignModulesNode,
  createDefineInterfacesNode,
  createDesignReviewNode,
  createValidateArchitectureNode,
  createDesignFileStructureNode,
  createGenerateOpenspecNode,
  createRecursiveCoderNode,
  createHandleArgueNode,
  createLoadExistingContextNode,
  createAnalyzeChangeImpactNode,
  createDesignDeltaNode,
} from "../llm-nodes/index.js";
import {
  generateDesignMarkdown,
  generateArchitectureTasksMarkdown,
} from "../llm-nodes/openspec-generators.js";
import { OpenAIModelProvider } from "../llm/openai-model-provider.js";
import { IncrementalDB } from "../pm/incremental-db.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { createArchitectureDesignGraph } from "../workflows/architecture-design.js";
import { createCoderGraph } from "../workflows/coder.js";
import { createRequirementClarificationGraph } from "../workflows/requirement-clarification.js";

// ============================================================================
// Provider Detection
// ============================================================================

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
  const glmKey = process.env.GLM_API_KEY ?? process.env.BIGMODEL_API_KEY;
  if (glmKey) {
    return {
      name: "GLM-5",
      config: {
        apiKey: glmKey,
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
const runFullPipeline = process.env.FULL_PIPELINE === "1";
const runIncremental = process.env.INCREMENTAL === "1";

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(!hasApiKey || !runFullPipeline)(
  "Stock Analyzer Extension — 完整开发管线 E2E",
  () => {
    let tempDir: string;
    let outputDir: string;
    let dbPath: string;
    let db: IncrementalDB;
    let modelProvider: OpenAIModelProvider;
    let promptRegistry: PromptRegistry;
    let projectId: string;

    beforeAll(() => {
      // 创建临时目录
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-analyzer-e2e-"));
      outputDir = path.join(tempDir, "stock-analyzer");
      dbPath = path.join(tempDir, "incremental.db");

      // 初始化组件
      db = new IncrementalDB(dbPath);
      modelProvider = new OpenAIModelProvider(provider!.config);
      promptRegistry = new PromptRegistry();

      // 确保输出目录存在
      fs.mkdirSync(outputDir, { recursive: true });

      console.log(`[E2E] Provider: ${provider!.name}`);
      console.log(`[E2E] Temp dir: ${tempDir}`);
      console.log(`[E2E] Output dir: ${outputDir}`);
    });

    afterAll(() => {
      db.close();
      // 保留临时目录用于检查结果（可选删除）
      // fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[E2E] Results preserved at: ${tempDir}`);
    });

    // ========================================================================
    // 阶段 1: 新建项目
    // ========================================================================

    describe("阶段 1: 新建项目 (new_project)", () => {
      const requirement = `
创建一个股市分析 OpenClaw Extension，提供以下功能：

1. **模拟账户管理**
   - 创建模拟交易账户
   - 初始资金设置
   - 账户余额查询

2. **股票数据读取**
   - 从数据源读取股票行情
   - 支持股票代码查询
   - 获取股票基本信息（名称、价格、涨跌幅）

3. **股票查询**
   - 按代码搜索股票
   - 按名称模糊搜索
   - 显示实时行情

4. **模拟投资**
   - 买入股票
   - 卖出股票
   - 持仓管理
   - 交易历史记录

技术要求：
- 使用 TypeScript
- 符合 OpenClaw Extension 架构
- 提供清晰的 tool 接口
      `.trim();

      it("Step 1: 需求澄清", async () => {
        console.log("\n[阶段1-Step1] 需求澄清开始...");

        const clarificationDeps = {
          modelProviderConfig: provider!.config,
          promptRegistry,
        };

        const clarificationNode = createRequirementClarificationNode(clarificationDeps);
        const graph = createRequirementClarificationGraph({ llmExecutor: clarificationNode });

        const result = await graph.invoke({
          messages: [{ content: requirement }],
          iteration: 0,
          completed: false,
        });

        console.log("[阶段1-Step1] 需求澄清完成");
        console.log("  - Response length:", result.response?.length ?? 0);
        console.log("  - Proposal generated:", !!result.proposalDocument);

        // 保存 proposal
        if (result.proposalDocument) {
          fs.writeFileSync(path.join(outputDir, "proposal.md"), result.proposalDocument);
        } else if (result.response) {
          fs.writeFileSync(path.join(outputDir, "proposal.md"), result.response);
        }

        expect(result.response || result.proposalDocument).toBeTruthy();
      }, 300_000); // 5 min timeout

      it("Step 2: 架构设计", async () => {
        console.log("\n[阶段1-Step2] 架构设计开始...");

        const proposalPath = path.join(outputDir, "proposal.md");
        const proposalContent = fs.existsSync(proposalPath)
          ? fs.readFileSync(proposalPath, "utf-8")
          : requirement;

        const deps = { modelProvider, promptRegistry };

        const archGraph = createArchitectureDesignGraph({
          analyzeRequirement: createAnalyzeRequirementNode(deps),
          listFeatures: createListFeaturesNode(deps),
          selectPattern: createSelectPatternNode(deps),
          designModules: createDesignModulesNode(deps),
          defineInterfaces: createDefineInterfacesNode(deps),
          designReview: createDesignReviewNode(deps),
          validateArchitecture: createValidateArchitectureNode(deps),
          designFileStructure: createDesignFileStructureNode(deps),
          generateOpenspec: createGenerateOpenspecNode(deps),
        });

        const result = await archGraph.invoke({
          requirement: proposalContent,
          scenario: "new_project",
          projectPath: outputDir,
        });

        console.log("[阶段1-Step2] 架构设计完成");
        console.log("  - Modules:", result.modules?.length ?? 0);
        console.log("  - Interfaces:", result.interfaces?.length ?? 0);
        console.log("  - Success:", result.success);
        console.log("  - Error:", result.error ?? "none");

        // 生成设计文档
        const designMd = generateDesignMarkdown(result);
        const tasksMd = generateArchitectureTasksMarkdown(result);

        fs.writeFileSync(path.join(outputDir, "design.md"), designMd);
        fs.writeFileSync(path.join(outputDir, "tasks.md"), tasksMd);

        // 写入数据库
        const project = db.getOrCreateProject(outputDir, "stock-analyzer");
        projectId = project.id;

        db.createSnapshot({
          projectId,
          version: 0,
          snapshotType: "requirement",
          contentHash: IncrementalDB.contentHash(proposalContent),
          proposalPath,
        });

        db.createSnapshot({
          projectId,
          version: 0,
          snapshotType: "architecture",
          contentHash: IncrementalDB.contentHash(designMd),
          designPath: path.join(outputDir, "design.md"),
          tasksPath: path.join(outputDir, "tasks.md"),
          architectureJson: {
            modules: result.modules ?? [],
            interfaces: result.interfaces ?? [],
            entities: result.entities ?? [],
            apiEndpoints: result.apiEndpoints ?? [],
            domains: result.domains ?? [],
            selectedPattern: result.selectedPattern,
          },
        });

        console.log("  - Project ID:", projectId);

        expect(result.success).toBe(true);
        expect(result.modules?.length).toBeGreaterThan(0);
      }, 600_000); // 10 min timeout

      it("Step 3: 编码 (生成第一个模块)", async () => {
        console.log("\n[阶段1-Step3] 编码开始...");

        const deps = { modelProvider, promptRegistry, modelProviderConfig: provider!.config };

        // 读取设计文档获取任务描述
        const designPath = path.join(outputDir, "design.md");
        const designContent = fs.readFileSync(designPath, "utf-8");

        // 提取第一个模块的描述
        const taskDescription = `
基于以下设计实现 stock-analyzer extension 的核心模块：

${designContent}

请生成 TypeScript 代码，包含：
1. 类型定义
2. 核心服务类
3. Tool 接口实现
        `.trim();

        const coderGraph = createCoderGraph({
          recursiveCoder: createRecursiveCoderNode(deps),
          handleArgue: createHandleArgueNode(deps),
        });

        const result = await coderGraph.invoke({
          taskDescription,
          codeContext: {
            allowedDir: outputDir,
            skeleton: "// Stock Analyzer Extension\n",
            requirements: taskDescription,
          },
          iterationCount: 0,
          maxIterations: 3,
          qualityThreshold: 0.7,
        });

        console.log("[阶段1-Step3] 编码完成");
        console.log("  - Quality score:", result.qualityScore);
        console.log("  - Iterations:", result.iterationCount);
        console.log("  - Success:", result.success);
        console.log("  - Modified files:", result.modifiedFiles?.length ?? 0);

        // 列出 coder 生成的文件
        const generatedFiles = fs.readdirSync(outputDir, { recursive: true }) as string[];
        const codeFiles = generatedFiles.filter(
          (f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".json"),
        );
        console.log("  - Code files in outputDir:", codeFiles.length);

        expect(result.modifiedFiles?.length).toBeGreaterThan(0);
      }, 1_800_000); // 30 min timeout — GLM-5 coder agent loop is slow
    });

    // ========================================================================
    // 阶段 2: 增量修改
    // ========================================================================

    describe.skipIf(!runIncremental)("阶段 2: 增量修改 (modify_existing)", () => {
      const incrementalRequirement = `
扩展股市分析 Extension，添加以下功能：

1. **多账户支持**
   - 用户可以创建多个模拟账户
   - 账户间切换
   - 账户列表管理
   - 每个账户独立的持仓和资金

2. **统计分析功能**
   - 投资收益率计算
   - 持仓分布分析
   - 交易统计报表
   - 盈亏趋势图数据

3. **账户分组**
   - 按策略分组（如：价值投资、短线交易）
   - 按市场分组（如：A股、港股、美股）

这些功能需要：
- 新增 AccountManager 模块
- 新增 Statistics 模块
- 修改现有的 Account 模块支持多账户
- 新增账户相关的实体和接口
      `.trim();

      it("Step 1: 加载现有上下文", async () => {
        console.log("\n[阶段2-Step1] 加载现有架构...");

        const snapshot = db.getLatestSnapshot(projectId, "architecture");
        expect(snapshot).toBeDefined();
        expect(snapshot?.architectureJson).toBeDefined();

        console.log("  - 现有模块数:", snapshot?.architectureJson?.modules?.length ?? 0);
        console.log("  - 现有接口数:", snapshot?.architectureJson?.interfaces?.length ?? 0);

        // 创建变更记录
        const changeRecord = db.createChangeRecord({
          projectId,
          changeName: "add-multi-account-and-statistics",
          versionBefore: 0,
          changeDescription: incrementalRequirement,
          status: "designing",
        });

        console.log("  - Change record ID:", changeRecord.id);
      });

      it("Step 2: 影响分析", async () => {
        console.log("\n[阶段2-Step2] 变更影响分析...");

        const snapshot = db.getLatestSnapshot(projectId, "architecture");
        const existingArch = snapshot?.architectureJson!;

        const deps = { modelProvider, promptRegistry, db };

        const impactNode = createAnalyzeChangeImpactNode(deps);
        const result = await impactNode({
          requirement: incrementalRequirement,
          existingArchitecture: existingArch,
          projectId,
          scenario: "modify_existing",
        } as any);

        console.log("[阶段2-Step2] 影响分析完成");
        console.log("  - 受影响模块:", result.changeImpact?.affectedModules ?? []);
        console.log("  - 影响级别:", result.changeImpact?.impactLevel);
        console.log("  - 推理:", result.changeImpact?.reasoning?.slice(0, 100));

        // 更新变更记录
        if (result.changeImpact) {
          const changes = db.getActiveChanges(projectId);
          if (changes.length > 0) {
            db.updateChangeImpact(changes[0].id!, result.changeImpact);
          }
        }

        expect(result.changeImpact).toBeDefined();
      }, 300_000);

      it("Step 3: 增量设计", async () => {
        console.log("\n[阶段2-Step3] 增量架构设计...");

        const snapshot = db.getLatestSnapshot(projectId, "architecture");
        const existingArch = snapshot?.architectureJson!;

        const impactSnapshot = db.getLatestSnapshot(projectId, "architecture");
        const changes = db.getActiveChanges(projectId);
        const impactSummary = changes[0]?.impactSummary;

        const deps = { modelProvider, promptRegistry, db };

        const deltaNode = createDesignDeltaNode(deps);
        const result = await deltaNode({
          requirement: incrementalRequirement,
          existingArchitecture: existingArch,
          changeImpact: impactSummary,
          projectId,
          scenario: "modify_existing",
        } as any);

        console.log("[阶段2-Step3] 增量设计完成");
        console.log("  - 新增模块:", result.deltaPlan?.addedModules?.length ?? 0);
        console.log("  - 修改模块:", result.deltaPlan?.modifiedModules?.length ?? 0);
        console.log("  - 删除模块:", result.deltaPlan?.removedModules?.length ?? 0);
        console.log("  - 合并后模块数:", result.modules?.length ?? 0);

        // 生成增量设计文档
        const deltaDesignMd = `
# 增量设计文档

## 变更需求
${incrementalRequirement}

## 影响分析
${JSON.stringify(impactSummary, null, 2)}

## Delta 计划

### 新增模块
${(result.deltaPlan?.addedModules ?? []).map((m: any) => `- ${m.name}: ${m.description}`).join("\n")}

### 修改模块
${(result.deltaPlan?.modifiedModules ?? []).map((m: any) => `- ${m.id}: ${m.reason}`).join("\n")}

## 合并后架构

### 模块列表
${(result.modules ?? []).map((m: any) => `- ${m.name}: ${m.description}`).join("\n")}
        `.trim();

        fs.writeFileSync(path.join(outputDir, "delta-design.md"), deltaDesignMd);

        // 更新数据库
        db.createSnapshot({
          projectId,
          version: 1,
          snapshotType: "architecture",
          contentHash: IncrementalDB.contentHash(deltaDesignMd),
          architectureJson: {
            modules: result.modules ?? [],
            interfaces: result.interfaces ?? [],
            entities: result.entities ?? [],
            apiEndpoints: result.apiEndpoints ?? [],
            domains: result.domains ?? [],
          },
        });

        // 更新变更记录
        if (changes.length > 0) {
          db.updateChangeStatus(changes[0].id!, "ready");
        }

        expect(result.deltaPlan).toBeDefined();
        expect(result.modules?.length).toBeGreaterThan(existingArch.modules?.length ?? 0);
      }, 600_000);

      it("Step 4: 增量编码", async () => {
        console.log("\n[阶段2-Step4] 增量编码...");

        // 读取增量设计
        const deltaDesignPath = path.join(outputDir, "delta-design.md");
        const deltaDesignContent = fs.readFileSync(deltaDesignPath, "utf-8");

        const taskDescription = `
基于以下增量设计，为 stock-analyzer extension 添加新功能：

${deltaDesignContent}

请生成新增模块的 TypeScript 代码。
        `.trim();

        const deps = { modelProvider, promptRegistry, modelProviderConfig: provider!.config };

        const coderGraph = createCoderGraph({
          recursiveCoder: createRecursiveCoderNode(deps),
          handleArgue: createHandleArgueNode(deps),
        });

        const result = await coderGraph.invoke({
          taskDescription,
          codeContext: {
            allowedDir: outputDir,
            skeleton: "// Incremental additions\n",
            requirements: taskDescription,
          },
          iterationCount: 0,
          maxIterations: 3,
          qualityThreshold: 0.7,
        });

        console.log("[阶段2-Step4] 增量编码完成");
        console.log("  - Quality score:", result.qualityScore);
        console.log("  - Iterations:", result.iterationCount);
        console.log("  - Modified files:", result.modifiedFiles?.length ?? 0);

        // 标记变更已应用
        const changes = db.getActiveChanges(projectId);
        if (changes.length > 0) {
          db.updateChangeStatus(changes[0].id!, "applied", 1);
          db.updateProjectVersion(projectId, 1);
        }

        expect(result.modifiedFiles?.length).toBeGreaterThan(0);
      }, 1_800_000);
    });

    // ========================================================================
    // 结果汇总
    // ========================================================================

    it("最终结果汇总", () => {
      console.log("\n========== E2E 测试结果 ==========");

      // 列出生成的文件
      const files = fs.readdirSync(outputDir, { recursive: true });
      console.log("\n生成的文件:");
      files.forEach((f) => {
        const fullPath = path.join(outputDir, f as string);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          console.log(`  - ${f} (${stat.size} bytes)`);
        }
      });

      // 数据库状态
      console.log("\n数据库状态:");
      const project = db.getProjectByRoot(outputDir);
      if (project) {
        console.log(`  - 项目: ${project.name} (v${project.currentVersion})`);
        const snapshots = db.getSnapshotHistory(project.id, "architecture", 10);
        console.log(`  - 架构快照: ${snapshots.length} 个版本`);
        const changes = db.getChangeHistory(project.id, 10);
        console.log(`  - 变更记录: ${changes.length} 条`);
      }

      console.log("\n结果目录:", tempDir);
      console.log("==================================");
    });
  },
);
