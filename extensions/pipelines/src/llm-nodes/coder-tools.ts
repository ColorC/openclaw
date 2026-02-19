/**
 * Coder Agent Tools
 *
 * 文件操作工具集，供 Coder Agent 使用。
 * 所有写操作沙箱化到 allowedDir 内，防止路径逃逸。
 *
 * 工具列表:
 * - write_file: 创建/覆盖文件
 * - edit_file: 精确替换文件内容
 * - read_file: 读取文件
 * - list_files: 列出目录
 * - search_files: 搜索文件内容
 * - coder_done: Agent 完成信号
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PipelineAgentTool } from "../llm/agent-adapter.js";

// ============================================================================
// Path Safety
// ============================================================================

function resolveSafe(allowedDir: string, filePath: string): string | null {
  const resolved = path.resolve(allowedDir, filePath);
  if (!resolved.startsWith(path.resolve(allowedDir))) {
    console.warn(
      `[coder-tools] ⚠ PATH ESCAPE BLOCKED: "${filePath}" resolves to "${resolved}" which is outside allowedDir "${allowedDir}"`,
    );
    return null;
  }
  return resolved;
}

// ============================================================================
// Completion Tracker
// ============================================================================

export interface CoderCompletionInfo {
  done: boolean;
  summary: string;
  createdFiles: string[];
  modifiedFiles: string[];
  qualityScore: number;
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * 创建 Coder Agent 的文件操作工具集（PipelineAgentTool 格式）
 *
 * @param allowedDir 沙箱目录 — 所有文件操作限制在此目录内
 * @param completion 完成状态跟踪器 — coder_done 工具写入此对象
 */
export function createCoderTools(
  allowedDir: string,
  completion: CoderCompletionInfo,
): PipelineAgentTool[] {
  return [
    // 1. write_file
    {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing file. Path must be within the allowed directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to workspace root)" },
          content: { type: "string", description: "Complete file content" },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        const filePath = resolveSafe(allowedDir, args.path as string);
        if (!filePath) return { error: `Path "${args.path}" is outside allowed directory` };
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, args.content as string, "utf-8");
        completion.createdFiles.push(args.path as string);
        return { written: true, path: args.path };
      },
    },

    // 2. edit_file
    {
      name: "edit_file",
      description: "Make targeted edits to an existing file by replacing text.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          oldText: { type: "string", description: "Text to find and replace" },
          newText: { type: "string", description: "Replacement text" },
        },
        required: ["path", "oldText", "newText"],
      },
      execute: async (args) => {
        const filePath = resolveSafe(allowedDir, args.path as string);
        if (!filePath) return { error: `Path "${args.path}" is outside allowed directory` };
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };
        const content = fs.readFileSync(filePath, "utf-8");
        const oldText = args.oldText as string;
        if (!content.includes(oldText)) return { error: "oldText not found in file" };
        const newContent = content.replace(oldText, args.newText as string);
        fs.writeFileSync(filePath, newContent, "utf-8");
        completion.modifiedFiles.push(args.path as string);
        return { edited: true, path: args.path };
      },
    },

    // 3. read_file
    {
      name: "read_file",
      description: "Read an existing file's content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          offset: { type: "number", description: "Start line (0-based, optional)" },
          limit: { type: "number", description: "Number of lines to read (optional)" },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const filePath = resolveSafe(allowedDir, args.path as string);
        if (!filePath) return { error: `Path "${args.path}" is outside allowed directory` };
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const offset = (args.offset as number) ?? 0;
        const limit = (args.limit as number) ?? lines.length;
        return lines.slice(offset, offset + limit).join("\n");
      },
    },

    // 4. list_files
    {
      name: "list_files",
      description: "List files in a directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (optional, defaults to allowed directory)",
          },
        },
      },
      execute: async (args) => {
        const dirPath = resolveSafe(allowedDir, (args.path as string) ?? ".");
        if (!dirPath) return { error: `Path "${args.path}" is outside allowed directory` };
        if (!fs.existsSync(dirPath)) return { error: `Directory not found: ${args.path ?? "."}` };
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
      },
    },

    // 5. search_files
    {
      name: "search_files",
      description: "Search for text patterns in files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex)" },
          path: { type: "string", description: "Directory to search in (optional)" },
          glob: { type: "string", description: "File filter pattern (optional)" },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        const searchDir = resolveSafe(allowedDir, (args.path as string) ?? ".");
        if (!searchDir) return { error: "Path outside allowed directory" };
        const pattern = new RegExp(args.pattern as string, "gi");
        const results: string[] = [];
        function searchRecursive(dir: string) {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              searchRecursive(fullPath);
            } else if (entry.isFile()) {
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  if (pattern.test(lines[i])) {
                    const relPath = path.relative(allowedDir, fullPath);
                    results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                  }
                }
              } catch {
                // Skip binary files
              }
            }
          }
        }
        searchRecursive(searchDir);
        return results.length > 0 ? results.slice(0, 50).join("\n") : "No matches found";
      },
    },

    // 6. coder_done
    {
      name: "coder_done",
      description:
        "Call this when you have finished implementing all files. You MUST call this tool when done.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Brief description of what was implemented" },
          qualityScore: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Self-assessed quality score (0-1)",
          },
        },
        required: ["summary", "qualityScore"],
      },
      execute: async (args) => {
        completion.done = true;
        completion.summary = (args.summary as string) ?? "";
        completion.qualityScore = (args.qualityScore as number) ?? 0.5;
        return { done: true, summary: completion.summary };
      },
    },
  ];
}
