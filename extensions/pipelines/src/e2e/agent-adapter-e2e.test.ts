/**
 * E2E Tests — agent-adapter (createAgentRunner) 改造验证
 *
 * 验证内容：
 * 1. 基本 agent 循环（带工具调用）
 * 2. 会话持久化（SessionManager）
 * 3. 多轮对话（sessionId 复用）
 * 4. getMessages / getTokenCount / deleteSession
 * 5. 原有调用方式的向后兼容性
 *
 * Run:
 *   pnpm vitest run e2e/agent-adapter-e2e.test.ts
 *   GLM_API_KEY=xxx pnpm vitest run e2e/agent-adapter-e2e.test.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { PipelineAgentTool } from "../llm/agent-adapter.js";

// ============================================================================
// Helpers
// ============================================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e2e-agent-adapter-"));
}

/** 从 openclaw 配置或环境变量获取 LLM provider */
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
    // ignore
  }

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

// ============================================================================
// Real LLM E2E Tests
// ============================================================================

describe.skipIf(!llmProvider)(
  `agent-adapter E2E ${llmProvider ? `(${llmProvider.name})` : ""}`,
  () => {
    let dir: string;
    let sessionDir: string;

    beforeEach(() => {
      dir = tmpDir();
      sessionDir = path.join(dir, "sessions");
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------
    // Test 1: 基本 agent 循环 — 无工具，纯文本对话
    // ------------------------------------------------------------------
    it("basic agent loop — text only, no tools", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      const result = await runner.run(
        "你是一个简洁的助手，回答尽量简短。",
        "1+1等于几？只回答数字。",
        [], // 无工具
        { sessionDir },
      );

      console.log("✅ Test 1 — finalResponse:", result.finalResponse);

      expect(result.finalResponse).toBeTruthy();
      expect(result.finalResponse).toContain("2");
      expect(result.sessionId).toBeTruthy();
      expect(result.sessionFile).toBeTruthy();
      expect(result.toolCalls).toHaveLength(0);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    }, 60_000);

    // ------------------------------------------------------------------
    // Test 2: 带工具调用的 agent 循环
    // ------------------------------------------------------------------
    it("agent loop with tool calls", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const calculatorResults: number[] = [];

      const calculatorTool: PipelineAgentTool = {
        name: "calculator",
        description: "计算两个数的加法。必须使用此工具来计算。",
        parameters: {
          type: "object",
          properties: {
            a: { type: "number", description: "第一个数" },
            b: { type: "number", description: "第二个数" },
          },
          required: ["a", "b"],
        },
        execute: async (args) => {
          const sum = (args.a as number) + (args.b as number);
          calculatorResults.push(sum);
          return { result: sum };
        },
      };

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      const result = await runner.run(
        "你是一个计算助手。当用户要求计算时，必须使用 calculator 工具。",
        "请帮我计算 17 + 25",
        [calculatorTool],
        { sessionDir },
      );

      console.log("✅ Test 2 — finalResponse:", result.finalResponse);
      console.log("   Tool calls:", result.toolCalls.length);
      console.log("   Calculator results:", calculatorResults);

      expect(result.finalResponse).toBeTruthy();
      expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
      expect(result.toolCalls.some((tc) => tc.name === "calculator")).toBe(true);
      expect(calculatorResults).toContain(42);
      expect(result.finalResponse).toContain("42");
    }, 60_000);

    // ------------------------------------------------------------------
    // Test 3: 会话持久化 + 多轮对话
    // ------------------------------------------------------------------
    it("session persistence — multi-turn conversation", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      // 第一轮：告诉 agent 一个信息
      const result1 = await runner.run(
        "你是一个记忆助手。记住用户告诉你的信息，后续会问你。",
        "请记住：我的猫叫小花。",
        [],
        { sessionDir },
      );

      console.log("✅ Test 3 — Round 1:", result1.finalResponse.slice(0, 100));
      const sid = result1.sessionId;

      // 验证 session 文件存在
      expect(fs.existsSync(result1.sessionFile)).toBe(true);

      // 第二轮：用相同 sessionId 继续对话
      const result2 = await runner.run(
        "你是一个记忆助手。记住用户告诉你的信息，后续会问你。",
        "我的猫叫什么名字？",
        [],
        { sessionId: sid, sessionDir },
      );

      console.log("✅ Test 3 — Round 2:", result2.finalResponse.slice(0, 100));

      // agent 应该记住"小花"
      expect(result2.finalResponse).toContain("小花");
      expect(result2.sessionId).toBe(sid);
    }, 120_000);

    // ------------------------------------------------------------------
    // Test 4: getMessages / getTokenCount
    // ------------------------------------------------------------------
    it("getMessages and getTokenCount return session data", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      const result = await runner.run("你是一个简洁的助手。", "你好", [], { sessionDir });

      const sid = result.sessionId;

      // getMessages
      const messages = await runner.getMessages(sid, { sessionDir });
      expect(messages.length).toBeGreaterThan(0);

      // getTokenCount
      const tokenCount = await runner.getTokenCount(sid, { sessionDir });
      expect(tokenCount).toBeGreaterThan(0);

      console.log("✅ Test 4 — messages:", messages.length, "tokens:", tokenCount);
    }, 60_000);

    // ------------------------------------------------------------------
    // Test 5: deleteSession
    // ------------------------------------------------------------------
    it("deleteSession removes session files", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      const result = await runner.run("你是一个简洁的助手。", "你好", [], { sessionDir });

      const sid = result.sessionId;
      expect(fs.existsSync(result.sessionFile)).toBe(true);

      // 删除会话
      await runner.deleteSession(sid, { sessionDir });

      // 文件应该不存在了
      expect(fs.existsSync(result.sessionFile)).toBe(false);

      console.log("✅ Test 5 — session deleted");
    }, 60_000);

    // ------------------------------------------------------------------
    // Test 6: 向后兼容 — history 参数（原有调用方式）
    // ------------------------------------------------------------------
    it("backward compat — history parameter works", async () => {
      const { createAgentRunner } = await import("../llm/agent-adapter.js");

      const runner = createAgentRunner({
        ...llmProvider!.config,
        sessionDir,
      });

      // 使用 history 参数（requirement-clarification-nodes.ts 的调用方式）
      const result = await runner.run("你是一个简洁的助手。", "我的宠物叫什么？", [], {
        temperature: 0.3,
        history: [
          { role: "user", content: "我有一只狗叫旺财。" },
          { role: "assistant", content: "好的，我记住了，你有一只叫旺财的狗。" },
        ],
        sessionDir,
      });

      console.log("✅ Test 6 — finalResponse:", result.finalResponse.slice(0, 100));

      expect(result.finalResponse).toContain("旺财");
    }, 60_000);
  },
);
