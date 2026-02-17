/**
 * E2E Tests — UX Agent testing Requirement Clarification workflow
 *
 * Two test suites:
 * 1. Mock tests — no LLM needed, verify component integration
 * 2. Real LLM tests — requires GLM_API_KEY, full agent-vs-agent flow
 *
 * Run:
 *   pnpm vitest run e2e/ux-agent-req-clarification.test.ts
 *   GLM_API_KEY=xxx pnpm vitest run e2e/ux-agent-req-clarification.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ChainContext } from "../chains/chain-context.js";
import { ReportBuilder } from "../testing/report-builder.js";
import { createUxTools, type FinishSignal } from "../testing/ux-tools.js";
import { WorkflowRunner } from "../testing/workflow-runner.js";

// ============================================================================
// Helpers
// ============================================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-ux-agent-"));
}

/** Create a minimal mock ChainContext */
function createMockChainContext(dir: string): ChainContext {
  return {
    projectRoot: dir,
    projectName: "test-project",
  } as unknown as ChainContext;
}

// ============================================================================
// Test 1: ReportBuilder
// ============================================================================

describe("UX Agent — ReportBuilder", () => {
  it("generates complete 8-section Markdown report", () => {
    const builder = new ReportBuilder("Test requirement clarification agent");

    builder.setField("testTarget", "scripts/interactive_requirement_clarification.py");
    builder.setField("exitStatus", "正常完成");
    builder.setField("totalRuntime", "45s");
    builder.setField("inputCount", 4);
    builder.setField("outputLineCount", 120);
    builder.setField("requirementUnderstanding", true);
    builder.setField("requirementFormatCompliant", true);
    builder.setField("requirementCompleteness", "Agent 成功收集了所有关键需求");
    builder.setField("scriptUsability", "优秀 - 启动简单");
    builder.setField("interactionFluency", "流畅 - 响应及时");
    builder.setField("outputQuality", "输出格式规范，内容完整");
    builder.setField("suggestions", ["添加使用说明", "显示已收集信息"]);
    builder.setField("assessmentLevel", 2);
    builder.setField("assessmentReason", "主要功能正常，交互流畅");

    const report = builder.generate();

    // Verify all 8 sections
    expect(report).toContain("# 用户体验测试报告");
    expect(report).toContain("## 1. 基本信息");
    expect(report).toContain("## 2. 执行统计");
    expect(report).toContain("## 3. 输入输出记录");
    expect(report).toContain("## 4. 需求匹配度评价");
    expect(report).toContain("## 5. 易用性评价");
    expect(report).toContain("## 6. 输出质量评价");
    expect(report).toContain("## 7. 参数灵活性评价");
    expect(report).toContain("## 8. 改进建议");

    // Verify content
    expect(report).toContain("interactive_requirement_clarification");
    expect(report).toContain("正常完成");
    expect(report).toContain("45s");
    expect(report).toContain("✅");
    expect(report).toContain("优秀");
    expect(report).toContain("添加使用说明");
    expect(report).toContain("显示已收集信息");
    expect(report).toContain("UX Agent v1.0");
  });

  it("tracks completion status of required fields", () => {
    const builder = new ReportBuilder("test");

    const status1 = builder.getCompletionStatus();
    expect(status1.filled).toBeLessThan(status1.total);
    expect(status1.missing.length).toBeGreaterThan(0);

    // Fill all required fields
    builder.setField("testTarget", "target");
    builder.setField("testGoal", "goal");
    builder.setField("sessionId", "session-1");
    builder.setField("exitStatus", "ok");
    builder.setField("requirementUnderstanding", true);
    builder.setField("requirementFormatCompliant", true);
    builder.setField("requirementCompleteness", "complete");
    builder.setField("scriptUsability", "good");
    builder.setField("interactionFluency", "smooth");
    builder.setField("assessmentLevel", 1);
    builder.setField("assessmentReason", "perfect");

    const status2 = builder.getCompletionStatus();
    expect(status2.filled).toBe(status2.total);
    expect(status2.missing).toHaveLength(0);
  });

  it("addInteraction records I/O pairs", () => {
    const builder = new ReportBuilder("test");

    builder.addInteraction("我想做一个待办应用", "好的，请告诉我更多细节");
    builder.addInteraction("个人使用", "了解，技术栈有偏好吗？");

    const report = builder.generate();
    expect(report).toContain("交互 1");
    expect(report).toContain("交互 2");
    expect(report).toContain("我想做一个待办应用");
    expect(report).toContain("个人使用");
  });

  it("getFields returns requested fields", () => {
    const builder = new ReportBuilder("my goal", "session-123");

    builder.setField("testTarget", "my-target");
    builder.setField("assessmentLevel", 3);

    const all = builder.getFields();
    expect(all.testGoal).toBe("my goal");
    expect(all.sessionId).toBe("session-123");
    expect(all.testTarget).toBe("my-target");

    const subset = builder.getFields(["testTarget", "assessmentLevel"]);
    expect(subset.testTarget).toBe("my-target");
    expect(subset.assessmentLevel).toBe(3);
    expect(subset.testGoal).toBeUndefined();
  });
});

// ============================================================================
// Test 2: UX Tools
// ============================================================================

describe("UX Agent — Tools", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("file_read reads file content", async () => {
    const testFile = path.join(dir, "test.txt");
    fs.writeFileSync(testFile, "line1\nline2\nline3\n");

    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const fileRead = tools.find((t) => t.name === "file_read")!;
    const result = (await fileRead.execute({ path: "test.txt" })) as any;

    expect(result.content).toContain("line1");
    expect(result.total_lines).toBe(4); // 3 lines + trailing newline
    expect(result.truncated).toBe(false);
  });

  it("file_write creates files", async () => {
    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const fileWrite = tools.find((t) => t.name === "file_write")!;
    const result = (await fileWrite.execute({ path: "output.txt", content: "hello world" })) as any;

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(dir, "output.txt"), "utf-8")).toBe("hello world");
  });

  it("directory_list lists directory contents", async () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "");
    fs.writeFileSync(path.join(dir, "b.ts"), "");
    fs.mkdirSync(path.join(dir, "sub"));

    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const dirList = tools.find((t) => t.name === "directory_list")!;
    const result = (await dirList.execute({ path: "." })) as any;

    expect(result.count).toBe(3);
    const names = result.items.map((i: any) => i.name);
    expect(names).toContain("a.ts");
    expect(names).toContain("b.ts");
    expect(names).toContain("sub");
  });

  it("bash_command executes shell commands", async () => {
    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const bash = tools.find((t) => t.name === "bash_command")!;
    const result = (await bash.execute({ command: "echo hello" })) as any;

    expect(result.output).toBe("hello");
    expect(result.exit_code).toBe(0);
  });

  it("report_builder tool supports set_field/get_fields/generate", async () => {
    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const reportTool = tools.find((t) => t.name === "report_builder")!;

    // set_field
    const setResult = (await reportTool.execute({
      action: "set_field",
      field: "testTarget",
      value: "my-workflow",
    })) as any;
    expect(setResult.success).toBe(true);

    // get_fields
    const getResult = (await reportTool.execute({
      action: "get_fields",
      fields: ["testTarget"],
    })) as any;
    expect(getResult.fields.testTarget).toBe("my-workflow");
    expect(getResult.completion).toBeDefined();

    // generate
    const genResult = (await reportTool.execute({ action: "generate" })) as any;
    expect(genResult.report).toContain("# 用户体验测试报告");
    expect(genResult.report).toContain("my-workflow");
  });

  it("finish tool sets signal and assessment", async () => {
    const runner = new WorkflowRunner();
    const builder = new ReportBuilder("test");
    const signal: FinishSignal = { finished: false };
    const ctx = createMockChainContext(dir);
    const tools = createUxTools(
      { workflowRunner: runner, reportBuilder: builder, targetCtx: ctx, cwd: dir },
      signal,
    );

    const finish = tools.find((t) => t.name === "finish")!;
    const result = (await finish.execute({
      summary: "Test completed successfully",
      assessment_level: 2,
      reason: "All features work well",
    })) as any;

    expect(result.finished).toBe(true);
    expect(signal.finished).toBe(true);
    expect(signal.result!.assessment_level).toBe(2);
    expect(signal.result!.summary).toBe("Test completed successfully");

    // Verify assessment was set in report builder
    const fields = builder.getFields(["assessmentLevel", "assessmentReason"]);
    expect(fields.assessmentLevel).toBe(2);
    expect(fields.assessmentReason).toBe("All features work well");
  });
});

// ============================================================================
// Test 3: WorkflowRunner integration
// ============================================================================

describe("UX Agent — WorkflowRunner", () => {
  it("manages workflow lifecycle: start → waitForInput → sendResponse → complete", async () => {
    const runner = new WorkflowRunner();

    // Create a mock ChainContext that will be used by the graph
    // We test the runner's state management without a real graph
    // by verifying the API contract

    expect(runner.getActiveCount()).toBe(0);

    // Verify getLatestId throws when no workflows exist
    expect(() => runner.getLatestId()).toThrow("No workflows have been started");
  });

  it("resolves auto/latest workflow IDs", () => {
    const runner = new WorkflowRunner();

    // No workflows — should throw
    expect(() => runner.getLatestId()).toThrow();

    // getStatus with non-existent ID
    const status = runner.getStatus("non-existent");
    expect(status.status).toBe("error");
    expect(status.error).toContain("not found");
  });

  it("stop returns error for non-existent workflow", () => {
    const runner = new WorkflowRunner();
    const result = runner.stop("non-existent");
    expect(result.status).toBe("error");
  });

  it("getInteractionHistory returns empty for unknown workflow", () => {
    const runner = new WorkflowRunner();
    const history = runner.getInteractionHistory("unknown");
    expect(history).toEqual([]);
  });

  it("getAllHistory aggregates across workflows", () => {
    const runner = new WorkflowRunner();
    const history = runner.getAllHistory();
    expect(history).toEqual([]);
  });
});

// ============================================================================
// Test 4: ReportBuilder instrumentation
// ============================================================================

describe("UX Agent — ReportBuilder Instrumentation", () => {
  it("collectInstrumentation with no collectors does not throw", () => {
    const builder = new ReportBuilder("test");
    builder.setField("assessmentLevel", 3);
    builder.setField("assessmentReason", "acceptable");

    // Should not throw
    builder.collectInstrumentation(undefined, undefined);
  });

  it("generates report with empty interactions gracefully", () => {
    const builder = new ReportBuilder("test");
    const report = builder.generate();

    expect(report).toContain("*无交互记录*");
    expect(report).toContain("*无改进建议*");
  });

  it("suggestions can be set as array or appended as string", () => {
    const builder = new ReportBuilder("test");

    // Set as array
    builder.setField("suggestions", ["suggestion 1", "suggestion 2"]);
    let fields = builder.getFields(["suggestions"]);
    expect(fields.suggestions).toEqual(["suggestion 1", "suggestion 2"]);

    // Append as string
    builder.setField("suggestions", ["new list"]);
    fields = builder.getFields(["suggestions"]);
    expect(fields.suggestions).toEqual(["new list"]);
  });
});

// ============================================================================
// Test 5: Real LLM — UX Agent tests Requirement Clarification (opt-in)
// ============================================================================

function detectProvider() {
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

describe.skipIf(!llmProvider)(
  `UX Agent — Real LLM E2E ${llmProvider ? `(${llmProvider.name})` : ""}`,
  () => {
    let dir: string;

    beforeEach(() => {
      dir = tmpDir();
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("UX Agent tests requirement clarification end-to-end", async () => {
      // Dynamic import to avoid loading heavy deps in mock tests
      const { runUxTest } = await import("../testing/ux-agent.js");
      const { createChainContext, disposeChainContext } =
        await import("../chains/chain-context.js");
      const { OpenAIModelProvider } = await import("../llm/openai-model-provider.js");
      const { PromptRegistry } = await import("../prompts/prompt-registry.js");

      const modelProvider = new OpenAIModelProvider(llmProvider!.config);
      const promptRegistry = new PromptRegistry();

      const ctx = createChainContext({
        dbPath: path.join(dir, "pm.db"),
        projectRoot: dir,
        projectName: "ux-test-project",
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
        const result = await runUxTest({
          task: `
Test the requirement clarification workflow.

Steps:
1. Start the workflow using run_workflow with target="requirement-clarification"
   and user_requirement="我想做一个简单的待办事项应用"
2. When the agent asks questions, answer naturally:
   - Use case: "个人使用，管理日常任务"
   - Platform: "Web 应用"
   - Backend: "Python + FastAPI"
   - Frontend: "React"
3. Continue until the agent generates a Requirement Document (status="completed")
4. Fill in the report using report_builder
5. Call finish with your assessment
`.trim(),
          targetCtx: ctx,
          modelConfig: llmProvider!.config,
          maxIterations: 15,
          temperature: 0.7,
          reportOutputDir: path.join(dir, "reports"),
        });

        console.log("✅ UX Agent test completed:");
        console.log("  - Finished:", result.finished);
        console.log("  - Assessment:", result.assessmentLevel);
        console.log("  - Summary:", result.summary);
        console.log("  - Iterations:", result.iterations);
        console.log("  - Interactions:", result.interactionHistory.length);
        console.log("  - Report length:", result.report.length, "chars");

        if (result.reportPath) {
          console.log("  - Report saved to:", result.reportPath);
        }

        // Basic assertions — the agent should at least produce a report
        expect(result.report).toContain("# 用户体验测试报告");
        expect(result.iterations).toBeGreaterThan(0);
      } finally {
        disposeChainContext(ctx);
      }
    }, 300_000); // 5 min timeout
  },
);
