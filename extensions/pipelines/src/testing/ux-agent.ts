/**
 * UX Agent — Automated user experience testing agent
 *
 * Simulates a real user interacting with target workflows (e.g., requirement
 * clarification) and generates structured UX test reports.
 *
 * Uses createAgentRunner (agentLoop) for LLM execution, with a multi-turn
 * outer loop that injects completion reminders and detects the finish tool.
 *
 * Source: _personal_copilot/src/agents/loop_framework/agents/ux_agent_loop_adapter.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChainContext } from "../chains/chain-context.js";
import type { DevPipelineConfig } from "../chains/chain-dev-pipeline.js";
import type { ModelProviderConfig } from "../llm/types.js";
import type { FailureCollector } from "../self-iteration/failure-collector.js";
import type { KPICollector } from "../self-iteration/kpi-collector.js";
import { createAgentRunner, type PipelineAgentTool } from "../llm/agent-adapter.js";
import { ReportBuilder } from "./report-builder.js";
import { createUxTools, type FinishSignal } from "./ux-tools.js";
import { WorkflowRunner } from "./workflow-runner.js";

// ============================================================================
// Types
// ============================================================================

/** Evaluation mode determines what the UX Agent focuses on */
export type UxEvaluationMode = "e2e" | "process_health" | "full";

export interface UXAgentConfig {
  /** Test task description — tells the UX Agent what to test and how */
  task: string;
  /** ChainContext for the target workflow under test */
  targetCtx: ChainContext;
  /** Optional DevPipelineConfig for the target workflow */
  targetConfig?: DevPipelineConfig;
  /** LLM configuration */
  modelConfig: ModelProviderConfig;
  /** Max outer-loop iterations (default 15) */
  maxIterations?: number;
  /** LLM temperature (default 0.7) */
  temperature?: number;
  /** Optional KPI collector for instrumentation */
  kpiCollector?: KPICollector;
  /** Optional failure collector for instrumentation */
  failureCollector?: FailureCollector;
  /** Directory to save report files */
  reportOutputDir?: string;
  /** Working directory for file/bash tools */
  cwd?: string;
  /** Evaluation mode: "e2e" (input vs output), "process_health" (process logs), "full" (both) */
  evaluationMode?: UxEvaluationMode;
}

export interface UXTestResult {
  /** Whether the agent called finish */
  finished: boolean;
  /** Assessment level (1-5), defaults to 5 if not finished */
  assessmentLevel: number;
  /** Summary from the finish tool */
  summary: string;
  /** Generated Markdown report */
  report: string;
  /** All interaction history from workflow runner */
  interactionHistory: Array<{ prompt: string; response: string }>;
  /** Number of outer-loop iterations used */
  iterations: number;
  /** Report file path (if saved) */
  reportPath?: string;
}

// ============================================================================
// System Prompts
// ============================================================================

/**
 * Original full system prompt — used for "full" mode and interactive workflow testing.
 * Defines the 3-phase testing flow: Understand → Execute → Report.
 */
const UX_AGENT_SYSTEM_PROMPT_FULL = `# UX Agent — 自动化用户体验测试 Agent

## 角色定义
你是一个专业的用户体验测试 Agent。你的职责是模拟真实用户与被测系统进行交互，评估系统的易用性、功能完整性和输出质量，最终生成结构化的测试报告。

## 核心原则
1. 基于实际交互评估，不要编造测试结果
2. 模拟真实用户行为，使用自然语言回答问题
3. 系统性地覆盖被测系统的主要功能
4. 客观、公正地评价系统表现

## 测试三阶段

### Phase 1: 理解 (1-2 轮)
目标：充分理解被测系统和测试任务

操作步骤：
1. 仔细阅读任务描述，理解测试目标
2. 如果任务中提到了脚本文件，使用 file_read 读取源码
3. 分析被测系统的预期行为、交互模式和输入输出格式
4. 制定测试策略：准备要输入的测试数据

注意：
- 不要在这个阶段启动工作流
- 确保理解了被测系统期望的交互方式

### Phase 2: 执行 (2-5 轮)
目标：与被测系统进行完整的交互测试

操作步骤：
1. 使用 run_workflow 启动被测工作流
2. 阅读工作流的输出和提问（在返回的 prompt 和 output 中）
3. 使用 respond_input 模拟用户回答
4. 持续交互直到工作流完成（status="completed"）或出错

交互策略：
- 第一次输入：提供一个模糊但合理的需求描述
- 后续输入：根据 Agent 的提问自然回答
- 如果 Agent 问技术选型，给出具体的技术栈
- 如果 Agent 问使用场景，描述具体的使用场景
- 如果工作流卡住（超过 60 秒无响应），记录错误并继续

注意：
- 必须使用 run_workflow 启动工作流（不要用 bash_command）
- 必须使用 respond_input 发送响应（workflow_id 用 "auto"）
- 每次 respond_input 后检查返回的 status

### Phase 3: 报告 (1-2 轮)
目标：生成完整的 UX 测试报告

操作步骤：
1. 使用 report_builder(action="set_field") 逐步填写以下字段：
   - testTarget: 被测系统名称/路径
   - exitStatus: 正常完成/异常退出/超时
   - requirementUnderstanding: true/false — Agent 是否正确理解了需求
   - requirementFormatCompliant: true/false — 输出格式是否符合预期
   - requirementCompleteness: 功能完整性描述
   - scriptUsability: 脚本易用性评价
   - interactionFluency: 交互流畅度评价
   - outputQuality: 输出质量评价（可选）
   - suggestions: 改进建议数组
   - assessmentLevel: 1-5 评估等级
   - assessmentReason: 评估理由
2. 使用 report_builder(action="generate") 生成完整报告
3. 使用 finish 工具提交最终结果

## 评估标准
- 1 = 完美：所有功能正常，交互流畅，输出高质量
- 2 = 优秀：主要功能正常，小瑕疵不影响使用
- 3 = 可接受：核心功能可用，但有明显改进空间
- 4 = 不可接受：关键功能缺失或严重 bug
- 5 = 失败：无法完成基本交互或系统崩溃

## 工具使用规范
- file_read: 读取文件内容（理解被测系统）
- bash_command: 执行简单 shell 命令（检查环境）
- run_workflow: 启动被测工作流（Phase 2 开始时使用）
- respond_input: 向工作流发送用户响应（Phase 2 交互时使用）
- directory_list: 列出目录内容
- grep_search: 搜索文件内容
- glob_search: 按模式搜索文件
- file_write: 写入文件
- report_builder: 构建测试报告（Phase 3 使用）
- finish: 标记任务完成（最后调用）

## 重要约束
- 每个阶段不超过指定的轮次限制
- 必须按 Phase 1 → 2 → 3 的顺序执行
- 最后必须调用 finish 工具
- 如果遇到错误，记录错误信息并继续完成报告
`;

/**
 * E2E evaluation system prompt — focuses strictly on input vs output comparison.
 * No workflow interaction, no "brain-supplementing" requirements.
 */
const UX_AGENT_SYSTEM_PROMPT_E2E = `# UX Agent — 端到端输出质量评估

## 角色定义
你是一个严格的架构设计输出质量评估 Agent。你的职责是对比原始需求和最终输出文档，评估设计质量。

## 核心原则
1. **严格基于原始需求评价** — 只评价需求中明确提到的功能，绝不"脑补"需求中没有的功能
2. 不需要启动工作流或进行交互 — 你只需要读取文件并评估
3. 客观、公正，基于事实

## 评估流程

### Step 1: 理解任务 (1 轮)
- 仔细阅读任务描述中的原始需求
- 提取需求中明确列出的功能点作为 checklist
- 注意：只提取需求中**明确写出**的功能，不要推断隐含功能

### Step 2: 读取输出文件 (1-3 轮)
- 使用 file_read 读取 design.md、tasks.md、spec.md
- 如需要可读取 raw-state.json 查看结构化数据

### Step 3: 逐项对照评估 (1-2 轮)
对照 Step 1 的 checklist，逐项检查：
- 每个明确需求是否有对应的模块/接口/实体/API 设计
- 设计是否合理（架构层次、模块职责、接口方向）
- 输出格式是否完整（design.md 包含所有必需 section）

### Step 4: 填写报告并完成 (1 轮)
使用 report_builder 填写：
- requirementCompleteness: 逐项列出需求 checklist 的覆盖情况
- outputQuality: 设计文档质量评价（结构、一致性、完整性）
- assessmentLevel: 1-5
- assessmentReason: 基于事实的评估理由
然后调用 finish。

## 评估标准
- 1 = 完美：所有明确需求都有高质量设计覆盖
- 2 = 优秀：所有明确需求有覆盖，设计有小瑕疵
- 3 = 可接受：核心需求有覆盖，但设计有明显问题（层次违规、实体重复等）
- 4 = 不可接受：部分明确需求缺失设计覆盖
- 5 = 失败：大量需求未覆盖或输出格式严重不合规

## 重要约束
- **禁止评价需求中没有明确提到的功能缺失** — 例如需求没提"评论系统"，就不能因为缺少评论系统而扣分
- 不要启动工作流（不使用 run_workflow / respond_input）
- 最后必须调用 finish
`;

/**
 * Process health evaluation system prompt — focuses on workflow execution quality.
 */
const UX_AGENT_SYSTEM_PROMPT_PROCESS_HEALTH = `# UX Agent — 过程健康度评估

## 角色定义
你是一个流水线过程质量评估 Agent。你的职责是分析架构设计流水线的执行过程，评估各节点的健康度。

## 核心原则
1. 关注过程指标而非最终输出内容
2. 分析执行日志、中间状态、时间分布
3. 识别异常模式（超时、重试、空输出、上下文丢失）

## 评估流程

### Step 1: 读取过程数据 (1-2 轮)
- 读取 raw-state.json 查看中间状态
- 使用 bash_command / grep_search 搜索 timing 日志
- 检查 refinement 历史和 validation 结果

### Step 2: 分析过程指标 (1-2 轮)
评估以下维度：
- **节点执行时间分布**：是否有异常慢的节点？
- **错误/重试次数**：是否有节点失败后重试？
- **上下文传递完整性**：跨域设计时，后续域是否能看到前面域的结果？
- **Refinement 效果**：如果触发了 refinement，修复了什么问题？
- **输出完整性**：每个节点是否都产生了非空输出？

### Step 3: 填写报告并完成 (1 轮)
使用 report_builder 填写：
- outputQuality: 过程健康度总结
- suggestions: 过程改进建议
- assessmentLevel: 1-5（基于过程健康度）
- assessmentReason: 过程分析结论
然后调用 finish。

## 评估标准
- 1 = 完美：所有节点正常执行，无重试，时间合理
- 2 = 优秀：偶尔重试但自动恢复，时间基本合理
- 3 = 可接受：有明显的过程问题但最终完成
- 4 = 不可接受：多次重试、超时、或关键节点输出为空
- 5 = 失败：流水线中断或关键节点完全失败

## 重要约束
- 不需要评价设计内容的业务合理性（那是 E2E 评价的职责）
- 不要启动工作流（不使用 run_workflow / respond_input）
- 最后必须调用 finish
`;

function getSystemPrompt(mode: UxEvaluationMode): string {
  switch (mode) {
    case "e2e":
      return UX_AGENT_SYSTEM_PROMPT_E2E;
    case "process_health":
      return UX_AGENT_SYSTEM_PROMPT_PROCESS_HEALTH;
    case "full":
    default:
      return UX_AGENT_SYSTEM_PROMPT_FULL;
  }
}

// ============================================================================
// Completion Reminder
// ============================================================================

/**
 * Generate dynamic progress reminder based on current state.
 * Injected as user message in later iterations to guide the agent.
 *
 * Source: Python get_completion_reminder()
 */
function getCompletionReminder(
  iteration: number,
  maxIterations: number,
  reportBuilder: ReportBuilder,
  workflowRunner: WorkflowRunner,
): string {
  const progress = iteration / maxIterations;
  if (progress <= 0.4) return "";

  const status = reportBuilder.getCompletionStatus();
  const activeCount = workflowRunner.getActiveCount();
  const lines: string[] = [];

  lines.push(`\n⏰ 进度提醒: 第 ${iteration}/${maxIterations} 轮`);
  lines.push(`📊 报告完成度: ${status.filled}/${status.total} 字段`);

  if (status.missing.length > 0) {
    lines.push(`📝 缺失字段: ${status.missing.join(", ")}`);
  }

  if (activeCount > 0) {
    lines.push(`⚠️ 还有 ${activeCount} 个活跃工作流，请尽快完成交互`);
  }

  if (progress > 0.7) {
    lines.push("🔴 即将达到迭代上限，请立即生成报告并调用 finish！");
  }

  return lines.join("\n");
}

// ============================================================================
// Tool Filtering by Evaluation Mode
// ============================================================================

/** Tools excluded in E2E mode (no workflow interaction needed) */
const E2E_EXCLUDED_TOOLS = new Set(["run_workflow", "respond_input", "check_status"]);

/** Filter tools based on evaluation mode */
function filterToolsByMode(
  tools: PipelineAgentTool[],
  mode: UxEvaluationMode,
): PipelineAgentTool[] {
  if (mode === "full") return tools;

  if (mode === "e2e" || mode === "process_health") {
    // Both non-interactive modes exclude workflow interaction tools
    return tools.filter((t) => !E2E_EXCLUDED_TOOLS.has(t.name));
  }

  return tools;
}

// ============================================================================
// Main Entry
// ============================================================================

/**
 * Run a UX test against a target workflow.
 *
 * The UX Agent uses a multi-turn outer loop:
 * - Each iteration = one agentLoop run (LLM → tools → LLM)
 * - Completion reminders are injected after 40% progress
 * - Loop exits when finish tool is called or maxIterations reached
 *
 * @example
 * ```typescript
 * const result = await runUxTest({
 *   task: 'Test the requirement clarification workflow...',
 *   targetCtx: myChainContext,
 *   modelConfig: { apiKey: 'xxx', defaultModel: 'glm-5', baseUrl: '...' },
 * })
 * console.log(result.report)
 * ```
 */
export async function runUxTest(config: UXAgentConfig): Promise<UXTestResult> {
  const maxIterations = config.maxIterations ?? 15;
  const temperature = config.temperature ?? 0.7;
  const evaluationMode = config.evaluationMode ?? "full";

  const runner = createAgentRunner(config.modelConfig);
  const workflowRunner = new WorkflowRunner();
  const reportBuilder = new ReportBuilder(config.task);

  // Finish signal — set by the finish tool
  const finishSignal: FinishSignal = { finished: false };

  // Build tool set and filter by evaluation mode
  const allTools = createUxTools(
    {
      workflowRunner,
      reportBuilder,
      targetCtx: config.targetCtx,
      targetConfig: config.targetConfig,
      cwd: config.cwd,
    },
    finishSignal,
  );

  const tools = filterToolsByMode(allTools, evaluationMode);
  const systemPrompt = getSystemPrompt(evaluationMode);

  // Multi-turn outer loop
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (let i = 0; i < maxIterations; i++) {
    // Build user message: task on first turn, reminder on subsequent turns
    let userMsg: string;
    if (i === 0) {
      userMsg = config.task;
    } else {
      const reminder = getCompletionReminder(i, maxIterations, reportBuilder, workflowRunner);
      userMsg = reminder || "继续执行任务。";
    }

    const result = await runner.run(systemPrompt, userMsg, tools, {
      temperature,
      history,
    });

    // Accumulate history
    history = [
      ...history,
      { role: "user", content: userMsg },
      { role: "assistant", content: result.finalResponse },
    ];

    // Check if finish tool was called
    if (finishSignal.finished) {
      break;
    }
  }

  // Collect instrumentation
  reportBuilder.collectInstrumentation(config.kpiCollector, config.failureCollector);

  // Save report to file if output dir specified
  let reportPath: string | undefined;
  if (config.reportOutputDir) {
    const report = reportBuilder.generate();
    const sessionId = `ux_${Date.now()}`;
    reportPath = path.join(config.reportOutputDir, `ux_report_${sessionId}.md`);
    fs.mkdirSync(config.reportOutputDir, { recursive: true });
    fs.writeFileSync(reportPath, report, "utf-8");
  }

  return {
    finished: finishSignal.finished,
    assessmentLevel: finishSignal.result?.assessment_level ?? 5,
    summary: finishSignal.result?.summary ?? "Did not complete",
    report: reportBuilder.generate(),
    interactionHistory: workflowRunner.getAllHistory(),
    iterations: Math.ceil(history.length / 2),
    reportPath,
  };
}
