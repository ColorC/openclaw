/**
 * Requirement Clarification Nodes — 单元测试
 *
 * 测试 CollectedInfo 生命周期、工具执行、OpenSpec 文档生成。
 */

import { describe, expect, it } from "vitest";
import {
  createCollectedInfo,
  formatCollectedInfo,
  deserializeCollectedInfo,
  generateOpenSpecProposal,
  createBuiltinTools,
  type CollectedInfo,
} from "./requirement-clarification-nodes.js";

// ============================================================================
// CollectedInfo 基础操作
// ============================================================================

describe("CollectedInfo", () => {
  it("creates with default empty state", () => {
    const info = createCollectedInfo();
    expect(info.requirements).toEqual({});
    expect(info.techChoices).toEqual({});
    expect(info.techConfirmed).toBe(false);
    expect(info.innovations).toEqual([]);
    expect(info.reportGenerated).toBe(false);
    expect(info.requirementDocGenerated).toBe(false);
  });

  describe("serialization roundtrip", () => {
    it("empty CollectedInfo roundtrips", () => {
      const original = createCollectedInfo();
      const json = JSON.stringify(original);
      const restored = deserializeCollectedInfo(json);
      expect(restored).toEqual(original);
    });

    it("populated CollectedInfo roundtrips", () => {
      const original = createCollectedInfo();
      original.requirements.core_problem = { value: "效率低", category: "basic" };
      original.requirements.target_users = { value: "开发者", category: "basic" };
      original.techChoices.backend = { choice: "FastAPI", reason: "高性能" };
      original.techConfirmed = true;
      original.innovations = ["AI 辅助"];

      const json = JSON.stringify(original);
      const restored = deserializeCollectedInfo(json);

      expect(restored.requirements.core_problem.value).toBe("效率低");
      expect(restored.techChoices.backend.choice).toBe("FastAPI");
      expect(restored.techConfirmed).toBe(true);
      expect(restored.innovations).toEqual(["AI 辅助"]);
    });

    it("handles undefined/empty JSON gracefully", () => {
      expect(deserializeCollectedInfo(undefined)).toEqual(createCollectedInfo());
      expect(deserializeCollectedInfo("")).toEqual(createCollectedInfo());
      expect(deserializeCollectedInfo("{}")).toEqual(createCollectedInfo());
    });

    it("handles malformed JSON gracefully", () => {
      const result = deserializeCollectedInfo("{invalid json}");
      expect(result).toEqual(createCollectedInfo());
    });
  });
});

// ============================================================================
// formatCollectedInfo
// ============================================================================

describe("formatCollectedInfo", () => {
  it("reports empty state", () => {
    const info = createCollectedInfo();
    const text = formatCollectedInfo(info);
    expect(text).toContain("尚未收集任何信息");
  });

  it("includes requirement entries", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "手动操作太慢", category: "basic" };
    info.requirements.target_users = { value: "运维人员", category: "basic" };

    const text = formatCollectedInfo(info);
    expect(text).toContain("core_problem");
    expect(text).toContain("手动操作太慢");
    expect(text).toContain("target_users");
    expect(text).toContain("运维人员");
  });

  it("includes tech choices", () => {
    const info = createCollectedInfo();
    info.techChoices.backend = { choice: "Express.js", reason: "轻量" };

    const text = formatCollectedInfo(info);
    expect(text).toContain("backend");
    expect(text).toContain("Express.js");
  });

  it("includes tech confirmed status", () => {
    const info = createCollectedInfo();
    info.techConfirmed = true;
    info.techChoices.backend = { choice: "Django" };

    const text = formatCollectedInfo(info);
    expect(text).toContain("已确认");
  });
});

// ============================================================================
// Tools
// ============================================================================

describe("Builtin Tools", () => {
  it("creates 7 tools", () => {
    const info = createCollectedInfo();
    const tools = createBuiltinTools(info);
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    expect(names).toContain("record_requirement");
    expect(names).toContain("record_tech_choice");
    expect(names).toContain("confirm_tech_choice");
    expect(names).toContain("read_context");
    expect(names).toContain("generate_report");
    expect(names).toContain("identify_innovation");
    expect(names).toContain("generate_requirement_doc");
  });

  describe("record_requirement", () => {
    it("records a requirement", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "record_requirement")!;

      const result = await tool.execute({ key: "core_problem", value: "数据处理慢" });
      expect(result).toBeDefined();
      expect(info.requirements.core_problem.value).toBe("数据处理慢");
    });

    it("records with category", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "record_requirement")!;

      await tool.execute({ key: "project_goals", value: "提升效率 50%", category: "goals" });
      expect(info.requirements.project_goals.category).toBe("goals");
    });
  });

  describe("record_tech_choice", () => {
    it("records a tech choice", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "record_tech_choice")!;

      await tool.execute({ category: "database", choice: "PostgreSQL", reason: "可靠性高" });
      expect(info.techChoices.database.choice).toBe("PostgreSQL");
      expect(info.techChoices.database.reason).toBe("可靠性高");
    });

    it("normalizes module names via MODULE_MAPPING", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "record_tech_choice")!;

      await tool.execute({ category: "数据库", choice: "MySQL" });
      expect(info.techChoices.database.choice).toBe("MySQL");
    });
  });

  describe("confirm_tech_choice", () => {
    it("confirms tech stack and reports missing modules", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "confirm_tech_choice")!;

      const result = (await tool.execute({
        tech_stack: { backend: ["FastAPI"], frontend: ["React"] },
        reason: "团队熟悉",
      })) as { confirmed_modules: string[]; missing_modules: string[] };

      expect(info.techConfirmed).toBe(true);
      expect(result.confirmed_modules).toContain("backend");
      expect(result.confirmed_modules).toContain("frontend");
      // database, ai, storage should be reported as missing
      expect(result.missing_modules).toContain("database");
    });

    it("records all modules in techChoices", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "confirm_tech_choice")!;

      await tool.execute({
        tech_stack: { backend: ["Django"], database: ["MySQL"], ai: ["OpenAI"] },
        reason: "已验证",
      });

      expect(info.techChoices.backend.choice).toBe("Django");
      expect(info.techChoices.database.choice).toBe("MySQL");
      expect(info.techChoices.ai.choice).toBe("OpenAI");
    });
  });

  describe("read_context", () => {
    it("returns all collected info", async () => {
      const info = createCollectedInfo();
      info.requirements.core_problem = { value: "效率低", category: "basic" };
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "read_context")!;

      const result = (await tool.execute({ contextType: "all" })) as Record<string, unknown>;
      expect(result.requirements).toBeDefined();
      expect((result.requirements as Record<string, unknown>).core_problem).toBeDefined();
    });

    it("returns only requirements when requested", async () => {
      const info = createCollectedInfo();
      info.requirements.target_users = { value: "开发者", category: "basic" };
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "read_context")!;

      const result = (await tool.execute({ contextType: "requirements" })) as Record<
        string,
        unknown
      >;
      expect(result.target_users).toBeDefined();
    });
  });

  describe("identify_innovation", () => {
    it("identifies uncovered requirements as innovations", async () => {
      const info = createCollectedInfo();
      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "identify_innovation")!;

      const result = (await tool.execute({
        userRequirements: ["基本CRUD", "AI 语音识别", "自然语言查询"],
        existingProjects: ["crud"],
      })) as { totalRequirements: number; coveredByExisting: number; innovationPoints: string[] };

      expect(result.totalRequirements).toBe(3);
      expect(result.coveredByExisting).toBe(1); // 基本CRUD matches 'crud'
      expect(result.innovationPoints).toContain("AI 语音识别");
      expect(result.innovationPoints).toContain("自然语言查询");
      expect(info.innovationAnalysis).toBeDefined();
      expect(info.innovations).toContain("AI 语音识别");
    });
  });

  describe("generate_requirement_doc", () => {
    it("generates OpenSpec proposal with populated info", async () => {
      const info = createCollectedInfo();
      info.requirements.core_problem = { value: "手动配置表格", category: "basic" };
      info.requirements.target_users = { value: "游戏策划", category: "basic" };
      info.requirements.use_case = { value: "批量修改装备属性", category: "basic" };
      info.requirements.project_goals = { value: "提升修改效率", category: "goals" };
      info.techChoices.backend = { choice: "FastAPI", reason: "高性能" };
      info.techChoices.ai = { choice: "OpenAI GPT-4", reason: "自然语言理解" };
      info.techConfirmed = true;

      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "generate_requirement_doc")!;

      const result = (await tool.execute({ projectName: "Excel AI Assistant" })) as {
        content: string;
        generated: boolean;
      };

      expect(result.generated).toBe(true);
      expect(result.content).toContain("## Why");
      expect(result.content).toContain("## What Changes");
      expect(result.content).toContain("## Capabilities");
      expect(result.content).toContain("## Impact");
      expect(result.content).toContain("Excel AI Assistant");
      expect(result.content).toContain("手动配置表格");
      expect(result.content).toContain("FastAPI");

      // 验证持久化
      expect(info.requirementDocGenerated).toBe(true);
      expect(info.requirementDocContent).toBe(result.content);
    });

    it("handles minimal info gracefully", async () => {
      const info = createCollectedInfo();
      info.requirements.core_problem = { value: "需要一个工具", category: "basic" };

      const tools = createBuiltinTools(info);
      const tool = tools.find((t) => t.name === "generate_requirement_doc")!;

      const result = (await tool.execute({ projectName: "MinimalProject" })) as {
        content: string;
        generated: boolean;
      };

      expect(result.content).toContain("## Why");
      expect(result.content).toContain("MinimalProject");
      expect(info.requirementDocGenerated).toBe(true);
    });
  });
});

// ============================================================================
// OpenSpec Proposal Generation
// ============================================================================

describe("generateOpenSpecProposal", () => {
  it("generates complete proposal with all sections", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "手动操作太慢", category: "basic" };
    info.requirements.target_users = { value: "运维工程师", category: "basic" };
    info.requirements.use_case = { value: "自动化部署", category: "basic" };
    info.requirements.project_goals = { value: "减少部署时间", category: "goals" };
    info.requirements.success_criteria = { value: "部署时间减少80%", category: "goals" };
    info.techChoices.backend = { choice: "Go", reason: "高并发" };
    info.techChoices.database = { choice: "PostgreSQL", reason: "成熟" };
    info.techConfirmed = true;

    const doc = generateOpenSpecProposal("AutoDeploy", info);

    // Header
    expect(doc).toContain("# AutoDeploy");
    expect(doc).toContain("OpenSpec");
    expect(doc).toContain("Proposal");

    // Why section
    expect(doc).toContain("## Why");
    expect(doc).toContain("手动操作太慢");
    expect(doc).toContain("运维工程师");

    // What Changes section
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("Go");
    expect(doc).toContain("PostgreSQL");

    // Capabilities section
    expect(doc).toContain("## Capabilities");

    // Impact section
    expect(doc).toContain("## Impact");
  });

  it("handles empty info gracefully", () => {
    const info = createCollectedInfo();
    const doc = generateOpenSpecProposal("EmptyProject", info);

    expect(doc).toContain("# EmptyProject");
    expect(doc).toContain("## Why");
    expect(doc).toContain("## What Changes");
    expect(doc).toContain("## Capabilities");
    expect(doc).toContain("## Impact");
  });

  it("includes uncovered requirements in What Changes when innovation analysis present", () => {
    const info = createCollectedInfo();
    info.requirements.core_problem = { value: "test", category: "basic" };
    info.innovationAnalysis = {
      innovationPoints: [{ feature: "AI 代码审查", reason: "独特功能", complexity: "high" }],
      coveredRequirements: ["基本编辑"],
      uncoveredRequirements: ["AI 代码审查"],
    };

    const doc = generateOpenSpecProposal("InnoProject", info);
    // uncoveredRequirements appear in "Features to Implement" section
    expect(doc).toContain("AI 代码审查");
  });
});
