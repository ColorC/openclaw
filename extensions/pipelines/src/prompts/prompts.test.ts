/**
 * Prompt Registry 测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { PromptRegistry } from "./prompt-registry.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
}

describe("PromptRegistry", () => {
  let dir: string;
  let registry: PromptRegistry;

  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, "decomposition"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "decomposition", "decompose.md"),
      "You are a requirement analyst.\n\nRequirement: {{requirement_description}}\n\nDecompose into sub-requirements.",
    );
    fs.writeFileSync(path.join(dir, "simple.md"), "Hello {{name}}!");
    registry = new PromptRegistry(dir);
  });

  it("loads a template by path", () => {
    const template = registry.getTemplate("simple");
    expect(template).toBe("Hello {{name}}!");
  });

  it("loads nested template", () => {
    const template = registry.getTemplate("decomposition/decompose");
    expect(template).toContain("requirement analyst");
    expect(template).toContain("{{requirement_description}}");
  });

  it("caches templates", () => {
    const t1 = registry.getTemplate("simple");
    const t2 = registry.getTemplate("simple");
    expect(t1).toBe(t2); // same reference from cache
  });

  it("throws for missing template", () => {
    expect(() => registry.getTemplate("nonexistent")).toThrow("not found");
  });

  it("renders with variable interpolation", () => {
    const result = registry.render("simple", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("renders nested template with variables", () => {
    const result = registry.render("decomposition/decompose", {
      requirement_description: "实现用户认证系统",
    });
    expect(result).toContain("实现用户认证系统");
    expect(result).not.toContain("{{requirement_description}}");
  });

  it("leaves unmatched variables as-is", () => {
    const result = registry.render("simple", {});
    expect(result).toBe("Hello {{name}}!");
  });

  it("replaces multiple occurrences of same variable", () => {
    fs.writeFileSync(path.join(dir, "multi.md"), "{{x}} and {{x}} again");
    const result = registry.render("multi", { x: "A" });
    expect(result).toBe("A and A again");
  });

  it("buildMessages creates system + user messages", () => {
    const messages = registry.buildMessages(
      "decomposition/decompose",
      { requirement_description: "构建 REST API" },
      "请分解这个需求",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("构建 REST API");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("请分解这个需求");
  });

  it("clearCache forces reload", () => {
    registry.getTemplate("simple");
    // Modify file
    fs.writeFileSync(path.join(dir, "simple.md"), "Changed {{name}}!");
    // Still cached
    expect(registry.getTemplate("simple")).toBe("Hello {{name}}!");
    // Clear and reload
    registry.clearCache();
    expect(registry.getTemplate("simple")).toBe("Changed {{name}}!");
  });
});

describe("PromptRegistry with real templates dir", () => {
  it("loads the quality-standards template from the actual templates directory", () => {
    const registry = new PromptRegistry();
    const template = registry.getTemplate("common/quality-standards");
    expect(template).toContain("Quality Standards");
  });
});
