/**
 * Web Tools Adapter
 *
 * 桥接 OpenClaw 的 web_search/web_fetch 工具到 Pipeline 的 PipelineAgentTool 格式。
 * 工具名称映射为 quick_web_search / quick_web_fetch 以匹配 system prompt 中的引用。
 *
 * 配置优先级：OpenClaw config (~/.openclaw/openclaw.json) → 环境变量 (BRAVE_API_KEY 等)
 * 无 key 时返回 null — 优雅降级。
 */

import type { PipelineAgentTool } from "./agent-adapter.js";
import { createWebSearchTool, createWebFetchTool } from "../../../../src/agents/tools/web-tools.js";
import { loadConfig } from "../../../../src/config/config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = {
  name: string;
  label?: string;
  description: string;
  parameters: any;
  execute: (...args: any[]) => any;
};

/** 尝试加载 OpenClaw 配置，失败时返回 undefined */
function tryLoadConfig() {
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

/** 将 OpenClaw AnyAgentTool 转为 PipelineAgentTool */
function adaptOpenClawTool(tool: AnyTool): PipelineAgentTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
    execute: async (args) => {
      const result = await tool.execute(undefined, args);
      return result.details ?? result.content?.[0]?.text ?? result;
    },
  };
}

/** 创建 pipeline 格式的 web search 工具 */
export function createPipelineWebSearchTool(): PipelineAgentTool | null {
  const config = tryLoadConfig();
  const tool = createWebSearchTool({ config });
  if (!tool) return null;
  const adapted = adaptOpenClawTool(tool as AnyTool);
  adapted.name = "quick_web_search";
  adapted.label = "Quick Web Search";
  return adapted;
}

/** 创建 pipeline 格式的 web fetch 工具 */
export function createPipelineWebFetchTool(): PipelineAgentTool | null {
  const config = tryLoadConfig();
  const tool = createWebFetchTool({ config });
  if (!tool) return null;
  const adapted = adaptOpenClawTool(tool as AnyTool);
  adapted.name = "quick_web_fetch";
  adapted.label = "Quick Web Fetch";
  return adapted;
}
