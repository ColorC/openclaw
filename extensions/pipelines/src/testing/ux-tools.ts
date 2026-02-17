/**
 * UX Agent Tools — 10 tools for automated UX testing
 *
 * Migrated from Python UXAgentLoopAdapter.get_tools() (11 tools).
 * bash_interact is replaced by run_workflow + respond_input.
 *
 * Source: _personal_copilot/src/agents/loop_framework/agents/ux_agent_loop_adapter.py
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { globSync } from "node:fs";
import * as path from "node:path";
import type { ChainContext } from "../chains/chain-context.js";
import type { DevPipelineConfig } from "../chains/chain-dev-pipeline.js";
import type { PipelineAgentTool } from "../llm/agent-adapter.js";
import type { ReportBuilder } from "./report-builder.js";
import type { WorkflowRunner } from "./workflow-runner.js";

// ============================================================================
// Types
// ============================================================================

export interface UxToolsDeps {
  workflowRunner: WorkflowRunner;
  reportBuilder: ReportBuilder;
  targetCtx: ChainContext;
  targetConfig?: DevPipelineConfig;
  /** Working directory for file/bash operations */
  cwd?: string;
}

/** Signal holder for the finish tool */
export interface FinishSignal {
  finished: boolean;
  result?: { summary: string; assessment_level: number; reason: string };
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createUxTools(deps: UxToolsDeps, finishSignal: FinishSignal): PipelineAgentTool[] {
  const { workflowRunner, reportBuilder, targetCtx, targetConfig } = deps;
  const cwd = deps.cwd ?? process.cwd();

  return [
    // 1. file_read
    {
      name: "file_read",
      description: "读取文件内容。用于理解被测脚本的源码和行为。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径（相对或绝对）" },
          max_lines: { type: "number", description: "最大读取行数（默认 200）" },
        },
        required: ["path"],
      },
      execute: async (args) => {
        try {
          const filePath = path.resolve(cwd, args.path as string);
          const content = fs.readFileSync(filePath, "utf-8");
          const maxLines = (args.max_lines as number) ?? 200;
          const lines = content.split("\n");
          const truncated = lines.length > maxLines;
          const result = truncated ? lines.slice(0, maxLines).join("\n") : content;
          return {
            content: result,
            total_lines: lines.length,
            truncated,
            path: filePath,
          };
        } catch (err) {
          return { error: `Failed to read file: ${(err as Error).message}` };
        }
      },
    },

    // 2. bash_command
    {
      name: "bash_command",
      description:
        "执行 shell 命令并返回输出。用于检查环境、运行简单命令。不要用于启动交互式脚本。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" },
          timeout: { type: "number", description: "超时秒数（默认 30）" },
        },
        required: ["command"],
      },
      execute: async (args) => {
        try {
          const timeout = ((args.timeout as number) ?? 30) * 1000;
          const output = execSync(args.command as string, {
            cwd,
            timeout,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { output: output.trim(), exit_code: 0 };
        } catch (err: any) {
          return {
            output: err.stdout?.toString() ?? "",
            stderr: err.stderr?.toString() ?? "",
            exit_code: err.status ?? 1,
            error: err.message,
          };
        }
      },
    },

    // 3. run_workflow
    {
      name: "run_workflow",
      description:
        "启动目标工作流并等待第一次输入请求。返回 workflow_id、status、prompt（Agent 的提问）和 output。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "工作流标识符（如脚本路径或工作流名称）",
          },
          user_requirement: {
            type: "string",
            description: "初始用户需求（可选，默认使用 target）",
          },
        },
        required: ["target"],
      },
      execute: async (args) => {
        try {
          const target = args.target as string;
          const userReq = args.user_requirement as string | undefined;
          const wfId = workflowRunner.start(target, targetCtx, targetConfig, userReq);
          const result = await workflowRunner.waitForInput(wfId, 60);
          return {
            workflow_id: wfId,
            status: result.status,
            prompt: result.prompt,
            output: result.output,
          };
        } catch (err) {
          return { error: `Failed to start workflow: ${(err as Error).message}` };
        }
      },
    },

    // 4. respond_input
    {
      name: "respond_input",
      description:
        '向等待输入的工作流发送响应，并等待下一次输入请求或完成。workflow_id 可用 "auto" 表示最近的工作流。',
      parameters: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: '工作流 ID，或 "auto" 使用最近的工作流',
          },
          response: { type: "string", description: "要发送的响应内容" },
        },
        required: ["workflow_id", "response"],
      },
      execute: async (args) => {
        try {
          const wfId = args.workflow_id as string;
          const response = args.response as string;
          const result = await workflowRunner.sendResponse(wfId, response);

          // Auto-record interaction in report builder
          reportBuilder.addInteraction(response, result.prompt ?? result.output ?? "");

          return {
            status: result.status,
            prompt: result.prompt,
            output: result.output,
            error: result.error,
          };
        } catch (err) {
          return { error: `Failed to send response: ${(err as Error).message}` };
        }
      },
    },

    // 5. directory_list
    {
      name: "directory_list",
      description: "列出目录内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径（默认当前目录）" },
          recursive: { type: "boolean", description: "是否递归（默认 false）" },
        },
      },
      execute: async (args) => {
        try {
          const dirPath = path.resolve(cwd, (args.path as string) ?? ".");
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          }));
          return { path: dirPath, items, count: items.length };
        } catch (err) {
          return { error: `Failed to list directory: ${(err as Error).message}` };
        }
      },
    },

    // 6. grep_search
    {
      name: "grep_search",
      description: "在文件中搜索文本模式。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "搜索模式（正则表达式）" },
          path: { type: "string", description: "搜索路径（默认当前目录）" },
          max_results: { type: "number", description: "最大结果数（默认 20）" },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        try {
          const searchPath = path.resolve(cwd, (args.path as string) ?? ".");
          const maxResults = (args.max_results as number) ?? 20;
          const output = execSync(
            `grep -rn --include='*.ts' --include='*.js' --include='*.py' --include='*.md' "${args.pattern}" "${searchPath}" | head -${maxResults}`,
            { encoding: "utf-8", timeout: 10000, maxBuffer: 512 * 1024 },
          );
          const matches = output.trim().split("\n").filter(Boolean);
          return { matches, count: matches.length, pattern: args.pattern };
        } catch (err: any) {
          if (err.status === 1) return { matches: [], count: 0, pattern: args.pattern };
          return { error: `Grep failed: ${err.message}` };
        }
      },
    },

    // 7. glob_search
    {
      name: "glob_search",
      description: "按文件名模式搜索文件。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob 模式（如 **/*.ts）" },
          path: { type: "string", description: "搜索根目录（默认当前目录）" },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        try {
          const searchPath = path.resolve(cwd, (args.path as string) ?? ".");
          // Use find as a portable glob alternative
          const output = execSync(
            `find "${searchPath}" -name "${args.pattern}" -type f 2>/dev/null | head -50`,
            { encoding: "utf-8", timeout: 10000 },
          );
          const files = output.trim().split("\n").filter(Boolean);
          return { files, count: files.length, pattern: args.pattern };
        } catch (err) {
          return { error: `Glob search failed: ${(err as Error).message}` };
        }
      },
    },

    // 8. file_write
    {
      name: "file_write",
      description: "写入文件内容。用于保存测试报告等。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" },
          append: { type: "boolean", description: "是否追加模式（默认 false）" },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        try {
          const filePath = path.resolve(cwd, args.path as string);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          if (args.append) {
            fs.appendFileSync(filePath, args.content as string, "utf-8");
          } else {
            fs.writeFileSync(filePath, args.content as string, "utf-8");
          }
          return { success: true, path: filePath };
        } catch (err) {
          return { error: `Failed to write file: ${(err as Error).message}` };
        }
      },
    },

    // 9. report_builder (3-in-1: set_field / get_fields / generate)
    {
      name: "report_builder",
      description: [
        "构建 UX 测试报告。三种操作：",
        '- action="set_field": 设置报告字段（field + value）',
        '- action="get_fields": 获取已填写的字段（可选 fields 数组过滤）',
        '- action="generate": 生成完整 Markdown 报告',
      ].join("\n"),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["set_field", "get_fields", "generate"],
            description: "操作类型",
          },
          field: { type: "string", description: "字段名（set_field 时必填）" },
          value: { description: "字段值（set_field 时必填）" },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "要获取的字段列表（get_fields 时可选）",
          },
        },
        required: ["action"],
      },
      execute: async (args) => {
        const action = args.action as string;

        if (action === "set_field") {
          if (!args.field) return { error: "field is required for set_field" };
          return reportBuilder.setField(args.field as string, args.value);
        }

        if (action === "get_fields") {
          const fieldNames = args.fields as string[] | undefined;
          const fields = reportBuilder.getFields(fieldNames);
          const status = reportBuilder.getCompletionStatus();
          return { fields, completion: status };
        }

        if (action === "generate") {
          const report = reportBuilder.generate();
          return { report, length: report.length };
        }

        return { error: `Unknown action: ${action}` };
      },
    },

    // 10. finish
    {
      name: "finish",
      description: "标记测试任务完成。必须在生成报告后调用。提供评估等级（1-5）和总结。",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "测试总结" },
          assessment_level: {
            type: "number",
            description:
              "评估等级：1=完美, 2=优秀, 3=可接受(需优化), 4=不可接受(需优化), 5=失败(需修复)",
          },
          reason: { type: "string", description: "评估理由" },
        },
        required: ["summary", "assessment_level", "reason"],
      },
      execute: async (args) => {
        const summary = args.summary as string;
        const level = args.assessment_level as number;
        const reason = args.reason as string;

        // Set assessment in report builder
        reportBuilder.setField("assessmentLevel", level);
        reportBuilder.setField("assessmentReason", reason);

        // Signal finish
        finishSignal.finished = true;
        finishSignal.result = { summary, assessment_level: level, reason };

        return { finished: true, summary, assessment_level: level };
      },
    },
  ];
}
