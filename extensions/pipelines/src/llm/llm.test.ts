/**
 * LLM 模型提供者层测试
 */

import { describe, expect, it } from "vitest";
import type { ChatMessage, ModelProviderConfig } from "./types.js";
import {
  MockModelProvider,
  mockTextResponse,
  mockToolCallResponse,
} from "./mock-model-provider.js";
import { resolveModelId } from "./types.js";

describe("resolveModelId", () => {
  it("returns role-mapped model when available", () => {
    const config: ModelProviderConfig = {
      roleMapping: { architect: "claude-sonnet", coder: "claude-opus" },
      defaultModel: "gpt-4o-mini",
    };
    expect(resolveModelId("architect", config)).toBe("claude-sonnet");
    expect(resolveModelId("coder", config)).toBe("claude-opus");
  });

  it("falls back to defaultModel for unmapped roles", () => {
    const config: ModelProviderConfig = {
      roleMapping: { architect: "claude-sonnet" },
      defaultModel: "gpt-4o-mini",
    };
    expect(resolveModelId("classifier", config)).toBe("gpt-4o-mini");
  });

  it("falls back to gpt-4o-mini when no config", () => {
    expect(resolveModelId(undefined, {})).toBe("gpt-4o-mini");
  });
});

describe("MockModelProvider", () => {
  it("returns responses sequentially", async () => {
    const provider = new MockModelProvider([mockTextResponse("first"), mockTextResponse("second")]);

    const r1 = await provider.chat([{ role: "user", content: "hi" }]);
    const r2 = await provider.chat([{ role: "user", content: "hello" }]);

    expect(r1.content).toBe("first");
    expect(r2.content).toBe("second");
  });

  it("throws when responses exhausted", async () => {
    const provider = new MockModelProvider([mockTextResponse("only")]);

    await provider.chat([{ role: "user", content: "a" }]);
    await expect(provider.chat([{ role: "user", content: "b" }])).rejects.toThrow(
      "no more responses",
    );
  });

  it("records call log", async () => {
    const provider = new MockModelProvider([mockTextResponse("ok")]);
    const messages: ChatMessage[] = [{ role: "user", content: "test" }];

    await provider.chat(messages, { modelRole: "architect", temperature: 0.3 });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].messages).toEqual(messages);
    expect(provider.calls[0].options?.modelRole).toBe("architect");
  });

  it("records tools in chatWithTools calls", async () => {
    const provider = new MockModelProvider([mockToolCallResponse("my_tool", { x: 1 })]);
    const tools = [{ name: "my_tool", description: "test", parameters: {} }];

    const result = await provider.chatWithTools([{ role: "user", content: "call tool" }], tools);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("my_tool");
    expect(result.toolCalls![0].arguments).toEqual({ x: 1 });
    expect(provider.calls[0].tools).toEqual(tools);
  });

  it("supports matcher-based responses", async () => {
    const provider = new MockModelProvider([
      {
        match: (msgs) => msgs.some((m) => m.content.includes("architecture")),
        response: mockTextResponse("arch response"),
      },
      mockTextResponse("fallback"),
    ]);

    const r1 = await provider.chat([{ role: "user", content: "design architecture" }]);
    expect(r1.content).toBe("arch response");

    // Matcher still matches on second call
    const r2 = await provider.chat([{ role: "user", content: "architecture again" }]);
    expect(r2.content).toBe("arch response");

    // Non-matching falls through to sequential
    const r3 = await provider.chat([{ role: "user", content: "something else" }]);
    expect(r3.content).toBe("fallback");
  });

  it("reset clears calls and index", async () => {
    const provider = new MockModelProvider([mockTextResponse("a"), mockTextResponse("b")]);

    await provider.chat([{ role: "user", content: "1" }]);
    expect(provider.calls).toHaveLength(1);

    provider.reset();
    expect(provider.calls).toHaveLength(0);

    const r = await provider.chat([{ role: "user", content: "2" }]);
    expect(r.content).toBe("a"); // index reset to 0
  });
});

describe("mockToolCallResponse", () => {
  it("creates response with tool call", () => {
    const r = mockToolCallResponse("decompose", { subs: [] }, "tc-1");
    expect(r.content).toBe("");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls![0]).toEqual({
      id: "tc-1",
      name: "decompose",
      arguments: { subs: [] },
    });
  });
});
