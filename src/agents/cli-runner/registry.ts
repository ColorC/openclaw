import type { AnyAgentTool } from "../pi-tools.types.js";
import { feishuChatMapper } from "./mappers/feishu-chat.js";
import { defaultGenericParser } from "./mappers/types.js";

// Session-aware tool stash to bridge from the Agent's in-memory tool array to the RPC Daemon
const sessionTools = new Map<string, Map<string, AnyAgentTool>>();

// Registry of custom mappers to override generic behavior
const customMappers = new Map<string, typeof feishuChatMapper>([
  [feishuChatMapper.commandKey, feishuChatMapper],
]);

export function getCustomMapper(cliCommandKey: string) {
  return customMappers.get(cliCommandKey);
}

/**
 * Stashes the instantiated tools for a specific session.
 * We convert tool names like `agents_list` or `feishu_update` into CLI subcommands
 * like `agents list` or `feishu update`.
 */
export function stashSessionTools(sessionKey: string, tools: AnyAgentTool[]) {
  const toolMap = new Map<string, AnyAgentTool>();
  for (const tool of tools) {
    // e.g. "agents_list" -> "agents list", "feishu_update" -> "feishu update"
    const cliKey = tool.name.replace(/_/g, " ");
    toolMap.set(cliKey, tool);
    // Also keep the original name just in case
    toolMap.set(tool.name, tool);
  }
  sessionTools.set(sessionKey, toolMap);
}

export function getStashedTools(sessionKey: string) {
  return sessionTools.get(sessionKey);
}

export function resolveCommand(sessionKey: string, args: string[]) {
  const toolMap = getStashedTools(sessionKey);
  if (!toolMap) {
    return null;
  }

  // Try 2-part commands first (e.g., "feishu update")
  if (args.length >= 2) {
    const key = `${args[0]} ${args[1]}`;
    const tool = toolMap.get(key);
    if (tool) {
      const mapper = getCustomMapper(key);
      return {
        tool,
        commandArgs: mapper ? mapper.parseArgs(args.slice(2)) : defaultGenericParser(args.slice(2)),
      };
    }
  }

  // Try 1-part commands (e.g., "subagents")
  if (args.length >= 1) {
    const key = args[0] || "";
    const tool = toolMap.get(key);
    if (tool) {
      const mapper = getCustomMapper(key);
      return {
        tool,
        commandArgs: mapper ? mapper.parseArgs(args.slice(1)) : defaultGenericParser(args.slice(1)),
      };
    }
  }
  return null;
}
