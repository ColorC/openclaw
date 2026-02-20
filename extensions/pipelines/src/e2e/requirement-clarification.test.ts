/**
 * E2E 测试 — Requirement Clarification 工作流
 *
 * 不需要真实 LLM，使用 mock executor 模拟 Agent 行为。
 *
 * 验证:
 * 1. 单轮一次性模式：直接从需求生成 OpenSpec Proposal
 * 2. 多轮交互模式：对话历史 + CollectedInfo 跨轮次持久化
 * 3. 工具链路完整性：record → confirm → innovate → generate_doc
 * 4. OpenSpec 文档格式：包含 Why / What Changes / Capabilities / Impact
 * 5. 边界情况：用户取消、最大轮次、空输入
 */

import { describe, expect, it } from "vitest";
import {
  createCollectedInfo,
  createBuiltinTools,
  deserializeCollectedInfo,
  generateOpenSpecProposal,
  formatCollectedInfo,
  type CollectedInfo,
} from "../llm-nodes/requirement-clarification-nodes.js";
import {
  createRequirementClarificationGraph,
  type RequirementClarificationGraphState,
} from "../workflows/requirement-clarification.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * 模拟 Agent 执行一系列工具调用后返回结果
 *
 * @param toolSequence 每轮执行的工具调用序列
 * @param finalResponse 最后一轮的 response
 */
function createMockExecutor(
  toolSequence: Array<{
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
    response?: string;
  }>,
  finalResponse: string,
) {
  let callIndex = 0;

  return async (
    state: RequirementClarificationGraphState,
  ): Promise<Partial<RequirementClarificationGraphState>> => {
    const step = toolSequence[callIndex];

    if (!step || callIndex >= toolSequence.length) {
      // 全部工具执行完毕，返回最终响应
      return {
        completed: true,
        response: finalResponse,
        iteration: state.iteration + 1,
      };
    }

    callIndex++;

    return {
      pendingToolCalls: step.toolCalls.map((tc, i) => ({
        name: tc.name,
        args: tc.args,
        id: `tc-${callIndex}-${i}`,
      })),
      response: step.response,
      iteration: state.iteration + 1,
    };
  };
}

/**
 * 创建一个 mock executor，该 executor 直接操作 CollectedInfo 并生成文档
 * 不走 pending tool calls 路径，而是在单次 call_llm 中完成所有操作
 */
function createDirectExecutor(info: CollectedInfo) {
  const tools = createBuiltinTools(info);
  const findTool = (name: string) => tools.find((t) => t.name === name)!;

  return {
    tools,
    findTool,
    /** 创建一个 executor，执行给定的工具序列后标记完成 */
    executor(
      toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
      projectName: string,
    ) {
      let called = false;
      return async (
        state: RequirementClarificationGraphState,
      ): Promise<Partial<RequirementClarificationGraphState>> => {
        if (!called) {
          called = true;
          // 依次执行工具
          for (const tc of toolCalls) {
            await findTool(tc.name).execute(tc.args);
          }
          // 生成文档
          await findTool("generate_requirement_doc").execute({ projectName });
        }

        return {
          completed: info.requirementDocGenerated,
          response: info.requirementDocContent ?? "Processing...",
          proposalDocument: info.requirementDocContent,
          collectedInfoJson: JSON.stringify(info),
          iteration: state.iteration + 1,
        };
      };
    },
  };
}

// ============================================================================
// Test 1: 单轮一次性模式（无 LLM，默认 stub）
// ============================================================================

describe("E2E: Requirement Clarification — 单轮一次性模式", () => {
  it("completes immediately without LLM executor", async () => {
    const graph = createRequirementClarificationGraph();

    const result = await graph.invoke({
      messages: [{ content: "实现一个 TODO 应用" }],
      iteration: 0,
      completed: false,
    });

    expect(result.completed).toBe(true);
    expect(result.iteration).toBe(1);
    expect(result.response).toBeDefined();
  });

  it("generates OpenSpec proposal in single pass with mock executor", async () => {
    const info = createCollectedInfo();
    const { executor } = createDirectExecutor(info);

    const graph = createRequirementClarificationGraph({
      llmExecutor: executor(
        [
          {
            name: "record_requirement",
            args: { key: "core_problem", value: "手动管理任务效率低" },
          },
          { name: "record_requirement", args: { key: "target_users", value: "开发团队" } },
          { name: "record_requirement", args: { key: "use_case", value: "团队任务跟踪和协作" } },
          { name: "record_requirement", args: { key: "project_goals", value: "提升团队协作效率" } },
          {
            name: "record_tech_choice",
            args: { category: "backend", choice: "FastAPI", reason: "高性能" },
          },
          {
            name: "record_tech_choice",
            args: { category: "frontend", choice: "React", reason: "生态丰富" },
          },
          {
            name: "record_tech_choice",
            args: { category: "database", choice: "PostgreSQL", reason: "可靠" },
          },
        ],
        "TeamTask",
      ),
    });

    const result = await graph.invoke({
      messages: [{ content: "做一个团队任务管理工具" }],
      iteration: 0,
      completed: false,
    });

    // 验证完成
    expect(result.completed).toBe(true);
    expect(result.proposalDocument).toBeDefined();

    // 验证 OpenSpec 格式
    const doc = result.proposalDocument ?? result.response ?? "";
    expect(doc).toContain("# TeamTask");
    expect(doc).toContain("## Why");
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("## Impact");
    expect(doc).toContain("手动管理任务效率低");
    expect(doc).toContain("FastAPI");
    expect(doc).toContain("React");
    expect(doc).toContain("PostgreSQL");

    // 验证 CollectedInfo 持久化
    const savedInfo = deserializeCollectedInfo(result.collectedInfoJson);
    expect(savedInfo.requirementDocGenerated).toBe(true);
    expect(Object.keys(savedInfo.requirements)).toHaveLength(4);
    expect(Object.keys(savedInfo.techChoices)).toHaveLength(3);
  });
});

// ============================================================================
// Test 2: 工具链路完整性
// ============================================================================

describe("E2E: Requirement Clarification — 工具链路", () => {
  it("full tool chain: record → confirm → innovate → generate_doc", async () => {
    const info = createCollectedInfo();
    const tools = createBuiltinTools(info);
    const find = (name: string) => tools.find((t) => t.name === name)!;

    // Step 1: 记录需求
    await find("record_requirement").execute({ key: "core_problem", value: "数据分析太慢" });
    await find("record_requirement").execute({ key: "target_users", value: "数据分析师" });
    await find("record_requirement").execute({ key: "use_case", value: "实时数据可视化" });
    await find("record_requirement").execute({
      key: "project_goals",
      value: "分析速度提升10倍",
      category: "goals",
    });

    expect(Object.keys(info.requirements)).toHaveLength(4);

    // Step 2: 单项技术选型
    await find("record_tech_choice").execute({
      category: "backend",
      choice: "Go",
      reason: "高并发",
    });

    expect(info.techChoices.backend.choice).toBe("Go");

    // Step 3: 批量确认技术栈（含模块缺口检测）
    const confirmResult = (await find("confirm_tech_choice").execute({
      tech_stack: {
        backend: ["Go"],
        frontend: ["Vue.js"],
        database: ["ClickHouse"],
      },
      reason: "高性能数据分析技术栈",
    })) as { confirmed_modules: string[]; missing_modules: string[]; all_covered: boolean };

    expect(info.techConfirmed).toBe(true);
    expect(confirmResult.confirmed_modules).toContain("backend");
    expect(confirmResult.confirmed_modules).toContain("frontend");
    expect(confirmResult.confirmed_modules).toContain("database");
    expect(confirmResult.missing_modules).toContain("ai");
    expect(confirmResult.missing_modules).toContain("storage");
    expect(confirmResult.all_covered).toBe(false);

    // Step 4: 创新点识别
    const innovResult = (await find("identify_innovation").execute({
      userRequirements: ["基本图表展示", "AI 异常检测", "自然语言查询", "实时流处理"],
      existingProjects: ["图表", "chart"],
    })) as { totalRequirements: number; coveredByExisting: number; innovationPoints: string[] };

    expect(innovResult.totalRequirements).toBe(4);
    expect(innovResult.coveredByExisting).toBe(1); // 基本图表展示 matches 图表
    expect(innovResult.innovationPoints).toContain("AI 异常检测");
    expect(innovResult.innovationPoints).toContain("自然语言查询");
    expect(innovResult.innovationPoints).toContain("实时流处理");
    expect(info.innovations).toHaveLength(3);

    // Step 5: 生成文档
    const docResult = (await find("generate_requirement_doc").execute({
      projectName: "DataLens",
    })) as { content: string; generated: boolean };

    expect(docResult.generated).toBe(true);
    expect(info.requirementDocGenerated).toBe(true);

    // 验证文档完整性
    const doc = docResult.content;
    expect(doc).toContain("# DataLens");
    expect(doc).toContain("## Why");
    expect(doc).toContain("数据分析太慢");
    expect(doc).toContain("数据分析师");

    expect(doc).toContain("## What Changes");
    expect(doc).toContain("Go");
    expect(doc).toContain("Vue.js");
    expect(doc).toContain("ClickHouse");

    // Features to Implement（来自创新点分析的 uncoveredRequirements）
    expect(doc).toContain("AI 异常检测");
    expect(doc).toContain("自然语言查询");
    expect(doc).toContain("实时流处理");

    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("## Impact");

    // Step 6: 读取上下文验证
    const allContext = (await find("read_context").execute({ contextType: "all" })) as Record<
      string,
      unknown
    >;
    expect(allContext.requirements).toBeDefined();
    expect(allContext.techConfirmed).toBe(true);
    expect(allContext.innovations).toBeDefined();
  });

  it("MODULE_MAPPING normalizes Chinese category names", async () => {
    const info = createCollectedInfo();
    const tools = createBuiltinTools(info);
    const find = (name: string) => tools.find((t) => t.name === name)!;

    await find("record_tech_choice").execute({ category: "数据库", choice: "MySQL" });
    await find("record_tech_choice").execute({ category: "后端框架", choice: "Express" });
    await find("record_tech_choice").execute({ category: "前端", choice: "Angular" });

    expect(info.techChoices.database.choice).toBe("MySQL");
    expect(info.techChoices.backend.choice).toBe("Express");
    expect(info.techChoices.frontend.choice).toBe("Angular");
  });
});

// ============================================================================
// Test 3: 多轮交互模式（CollectedInfo 跨轮次持久化）
// ============================================================================

describe("E2E: Requirement Clarification — 多轮交互", () => {
  it("persists CollectedInfo across graph invocations", async () => {
    // --- Turn 1: 记录基本需求 ---
    const info1 = createCollectedInfo();
    const { executor: mkExec1 } = createDirectExecutor(info1);

    const graph1 = createRequirementClarificationGraph({
      llmExecutor: async (state) => {
        // 第一轮只记录需求，不生成文档
        const info = deserializeCollectedInfo(state.collectedInfoJson);
        const tools = createBuiltinTools(info);
        const find = (name: string) => tools.find((t) => t.name === name)!;

        await find("record_requirement").execute({ key: "core_problem", value: "缺少自动化测试" });
        await find("record_requirement").execute({ key: "target_users", value: "QA工程师" });

        return {
          completed: false,
          response: "我了解了你的核心问题。请告诉我更多关于项目目标的信息。",
          collectedInfoJson: JSON.stringify(info),
          conversationHistory: [
            ...(state.conversationHistory ?? []),
            { role: "user", content: "我需要自动化测试工具" },
            {
              role: "assistant",
              content: "我了解了你的核心问题。请告诉我更多关于项目目标的信息。",
            },
          ],
          iteration: state.iteration + 1,
        };
      },
    });

    const turn1Result = await graph1.invoke({
      messages: [{ content: "我需要一个自动化测试工具" }],
      iteration: 0,
      completed: false,
    });

    // 验证第一轮状态
    expect(turn1Result.completed).toBe(false);
    expect(turn1Result.collectedInfoJson).toBeDefined();
    const savedInfo1 = deserializeCollectedInfo(turn1Result.collectedInfoJson);
    expect(savedInfo1.requirements.core_problem.value).toBe("缺少自动化测试");
    expect(savedInfo1.requirements.target_users.value).toBe("QA工程师");

    // --- Turn 2: 继续收集 + 生成文档 ---
    const graph2 = createRequirementClarificationGraph({
      llmExecutor: async (state) => {
        // 从上一轮的持久化数据恢复
        const info = deserializeCollectedInfo(state.collectedInfoJson);
        const tools = createBuiltinTools(info);
        const find = (name: string) => tools.find((t) => t.name === name)!;

        // 验证上一轮的数据被保留
        expect(info.requirements.core_problem).toBeDefined();
        expect(info.requirements.target_users).toBeDefined();

        // 继续记录
        await find("record_requirement").execute({
          key: "project_goals",
          value: "自动化覆盖率达到80%",
          category: "goals",
        });
        await find("record_tech_choice").execute({
          category: "backend",
          choice: "Python",
          reason: "测试生态完善",
        });
        // 生成文档
        await find("generate_requirement_doc").execute({ projectName: "AutoTest" });

        return {
          completed: info.requirementDocGenerated,
          response: info.requirementDocContent,
          proposalDocument: info.requirementDocContent,
          collectedInfoJson: JSON.stringify(info),
          conversationHistory: [
            ...(state.conversationHistory ?? []),
            { role: "user", content: "目标是覆盖率80%，用Python" },
            { role: "assistant", content: info.requirementDocContent ?? "" },
          ],
          iteration: state.iteration + 1,
        };
      },
    });

    const turn2Result = await graph2.invoke({
      messages: [{ content: "目标是覆盖率80%，用Python" }],
      iteration: turn1Result.iteration,
      completed: false,
      // 关键：传递上一轮的持久化状态
      collectedInfoJson: turn1Result.collectedInfoJson,
      conversationHistory: turn1Result.conversationHistory,
    });

    // 验证第二轮完成
    expect(turn2Result.completed).toBe(true);
    expect(turn2Result.proposalDocument).toBeDefined();

    // 验证文档包含两轮的信息
    const doc = turn2Result.proposalDocument!;
    expect(doc).toContain("# AutoTest");
    expect(doc).toContain("缺少自动化测试"); // Turn 1 的数据
    expect(doc).toContain("QA工程师"); // Turn 1 的数据
    expect(doc).toContain("Python"); // Turn 2 的数据

    // 验证对话历史累积
    expect(turn2Result.conversationHistory!.length).toBeGreaterThanOrEqual(4); // 2 turns × 2 messages

    // 验证最终 CollectedInfo 完整
    const finalInfo = deserializeCollectedInfo(turn2Result.collectedInfoJson);
    expect(Object.keys(finalInfo.requirements)).toHaveLength(3);
    expect(finalInfo.techChoices.backend.choice).toBe("Python");
    expect(finalInfo.requirementDocGenerated).toBe(true);
  });
});

// ============================================================================
// Test 4: OpenSpec 文档格式验证
// ============================================================================

describe("E2E: Requirement Clarification — OpenSpec 格式", () => {
  it("generates proposal with all required sections and metadata", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "客服响应慢", category: "basic" };
    info.requirements.target_users = { value: "电商客服团队", category: "basic" };
    info.requirements.use_case = { value: "智能问答和工单分类", category: "basic" };
    info.requirements.project_goals = { value: "平均响应时间降低60%", category: "goals" };
    info.requirements.success_criteria = { value: "客户满意度达到90%", category: "goals" };
    info.techChoices.backend = { choice: "FastAPI", reason: "异步高性能" };
    info.techChoices.frontend = { choice: "Vue.js", reason: "轻量" };
    info.techChoices.database = { choice: "MongoDB", reason: "灵活 schema" };
    info.techChoices.ai = { choice: "GPT-4", reason: "对话能力强" };
    info.techConfirmed = true;
    info.techStack = {
      backend: ["FastAPI"],
      frontend: ["Vue.js"],
      database: ["MongoDB"],
      ai: ["GPT-4"],
    };
    info.innovationAnalysis = {
      innovationPoints: [
        { feature: "多轮对话", reason: "复杂场景", complexity: "high" },
        { feature: "工单自动分类", reason: "效率提升", complexity: "medium" },
      ],
      coveredRequirements: ["基本问答"],
      uncoveredRequirements: ["多轮对话", "工单自动分类"],
    };
    info.innovations = ["多轮对话", "工单自动分类"];

    const doc = generateOpenSpecProposal("SmartCS", info);

    // ---- 元数据 ----
    expect(doc).toContain("# SmartCS");
    expect(doc).toContain("OpenSpec v1.0 Proposal");
    expect(doc).toContain("Greenfield Project");
    expect(doc).toMatch(/\*\*Generated\*\*: \d{4}-\d{2}-\d{2}/);

    // ---- Why ----
    expect(doc).toContain("## Why");
    expect(doc).toContain("客服响应慢");
    expect(doc).toContain("电商客服团队");
    expect(doc).toContain("平均响应时间降低60%");
    expect(doc).toContain("客户满意度达到90%");
    expect(doc).toContain("智能问答和工单分类");

    // ---- What Changes ----
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("### Technology Stack");
    expect(doc).toContain("BACKEND");
    expect(doc).toContain("FastAPI");
    expect(doc).toContain("FRONTEND");
    expect(doc).toContain("Vue.js");
    expect(doc).toContain("DATABASE");
    expect(doc).toContain("MongoDB");
    expect(doc).toContain("AI");
    expect(doc).toContain("GPT-4");

    // Features to Implement（来自 uncoveredRequirements）
    expect(doc).toContain("### Features to Implement");
    expect(doc).toContain("多轮对话");
    expect(doc).toContain("工单自动分类");

    // ---- Capabilities ----
    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("### New Capabilities");

    // ---- Impact ----
    expect(doc).toContain("## Impact");
    expect(doc).toContain("Affected specs");
    expect(doc).toContain("Affected code");
    expect(doc).toContain("Project Structure");
    expect(doc).toContain("External Dependencies");

    // AI 依赖出现在 Impact 中
    expect(doc).toContain("AI/LLM");

    // Implementation Notes（来自创新点）
    expect(doc).toContain("Implementation Notes");
    expect(doc).toContain("2 个功能点");
  });

  it("generates valid proposal with minimal info", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "需要一个工具", category: "basic" };

    const doc = generateOpenSpecProposal("MinProject", info);

    expect(doc).toContain("# MinProject");
    expect(doc).toContain("## Why");
    expect(doc).toContain("需要一个工具");
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("## Impact");
  });

  it("generates valid proposal with completely empty info", () => {
    const info = createCollectedInfo();
    const doc = generateOpenSpecProposal("EmptyProject", info);

    expect(doc).toContain("# EmptyProject");
    expect(doc).toContain("## Why");
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("## Impact");
    expect(doc.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// Test 5: formatCollectedInfo 输出
// ============================================================================

describe("E2E: Requirement Clarification — formatCollectedInfo", () => {
  it("generates complete formatted output for injection into system prompt", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "效率低", category: "basic" };
    info.requirements.target_users = { value: "开发者", category: "basic" };
    info.techChoices.backend = { choice: "Node.js", reason: "全栈" };
    info.techConfirmed = true;
    info.innovations = ["AI 辅助编码"];
    info.requirementDocGenerated = true;

    const text = formatCollectedInfo(info);

    expect(text).toContain("已记录的需求信息");
    expect(text).toContain("core_problem");
    expect(text).toContain("效率低");
    expect(text).toContain("已记录的技术选型");
    expect(text).toContain("Node.js");
    expect(text).toContain("已确认");
    expect(text).toContain("已识别的创新点");
    expect(text).toContain("AI 辅助编码");
    expect(text).toContain("文档状态");
    expect(text).toContain("OpenSpec 需求文档已生成");
  });
});

// ============================================================================
// Test 6: CollectedInfo 序列化边界情况
// ============================================================================

describe("E2E: Requirement Clarification — 序列化边界", () => {
  it("preserves all fields through serialization roundtrip", () => {
    const info = createCollectedInfo();
    info.requirements.a = { value: "v1", category: "basic" };
    info.requirements.b = { value: "v2", category: "goals" };
    info.techChoices.backend = { choice: "Go", reason: "fast" };
    info.techStack = { backend: ["Go"], database: ["SQLite"] };
    info.techConfirmed = true;
    info.innovations = ["x", "y"];
    info.innovationAnalysis = {
      innovationPoints: [{ feature: "x", reason: "r", complexity: "high" }],
      coveredRequirements: ["c"],
      uncoveredRequirements: ["x"],
    };
    info.reportGenerated = true;
    info.requirementDocGenerated = true;
    info.requirementDocContent = "# Doc content";

    const json = JSON.stringify(info);
    const restored = deserializeCollectedInfo(json);

    expect(restored.requirements.a.value).toBe("v1");
    expect(restored.requirements.b.category).toBe("goals");
    expect(restored.techChoices.backend.choice).toBe("Go");
    expect(restored.techStack).toEqual({ backend: ["Go"], database: ["SQLite"] });
    expect(restored.techConfirmed).toBe(true);
    expect(restored.innovations).toEqual(["x", "y"]);
    expect(restored.innovationAnalysis!.innovationPoints).toHaveLength(1);
    expect(restored.reportGenerated).toBe(true);
    expect(restored.requirementDocGenerated).toBe(true);
    expect(restored.requirementDocContent).toBe("# Doc content");
  });

  it("handles corrupted JSON gracefully", () => {
    const result = deserializeCollectedInfo("not valid json {{{");
    expect(result).toEqual(createCollectedInfo());
  });

  it("handles partial JSON (missing fields) gracefully", () => {
    const partial = JSON.stringify({ requirements: { x: { value: "v", category: "basic" } } });
    const result = deserializeCollectedInfo(partial);

    expect(result.requirements.x.value).toBe("v");
    // 缺失的字段应该有默认值
    expect(result.techChoices).toEqual({});
    expect(result.techConfirmed).toBe(false);
    expect(result.innovations).toEqual([]);
  });
});
