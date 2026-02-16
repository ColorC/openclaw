/**
 * SemanticHeaderInjector 单元测试
 */

import { describe, expect, it } from "vitest";
import { SemanticHeaderInjector } from "./semantic-header.js";

describe("SemanticHeaderInjector", () => {
  const injector = new SemanticHeaderInjector();

  describe("generateSemanticHeader", () => {
    it("generates header with required fields", () => {
      const header = injector.generateSemanticHeader({ symid: "FILE-src-test" });
      expect(header).toContain("[SEMANTIC_HEADER]");
      expect(header).toContain("[/SEMANTIC_HEADER]");
      expect(header).toContain("symid: 'FILE-src-test'");
      expect(header).toContain("lifecycleStatus");
      expect(header).toContain("provenance");
    });

    it("includes optional fields", () => {
      const header = injector.generateSemanticHeader({
        symid: "FILE-src-test",
        semanticHash: "sha256:abc123",
        lifecycleStatus: "experimental",
        dependencies: ["src.models.base"],
        description: "Test file",
      });
      expect(header).toContain("sha256:abc123");
      expect(header).toContain("experimental");
      expect(header).toContain("src.models.base");
      expect(header).toContain("Test file");
    });

    it("uses custom provenance", () => {
      const header = injector.generateSemanticHeader({
        symid: "FILE-test",
        provenance: { model: "GPT-4", generatedAt: "2026-01-01T00:00:00Z" },
      });
      expect(header).toContain("GPT-4");
    });
  });

  describe("extractFromContent", () => {
    it("extracts header from content", () => {
      const content = `Some code\n[SEMANTIC_HEADER]\nsymid: 'FILE-test'\nlifecycleStatus: 'stable'\n[/SEMANTIC_HEADER]\nMore code`;
      const data = injector.extractFromContent(content);
      expect(data).toBeDefined();
      expect(data!.symid).toBe("FILE-test");
      expect(data!.lifecycleStatus).toBe("stable");
    });

    it("returns undefined when no header", () => {
      expect(injector.extractFromContent("no header here")).toBeUndefined();
    });
  });

  describe("stripHeader", () => {
    it("removes header block", () => {
      const content = "before\n[SEMANTIC_HEADER]\nsymid: test\n[/SEMANTIC_HEADER]\nafter";
      const stripped = injector.stripHeader(content);
      expect(stripped).not.toContain("[SEMANTIC_HEADER]");
      expect(stripped).toContain("before");
      expect(stripped).toContain("after");
    });

    it("returns unchanged when no header", () => {
      const content = "just code";
      expect(injector.stripHeader(content)).toBe(content);
    });
  });

  describe("injectIntoContent", () => {
    const header = "[SEMANTIC_HEADER]\nsymid: test\n[/SEMANTIC_HEADER]";

    it("injects at top", () => {
      const result = injector.injectIntoContent("existing code", header, "top");
      expect(result).toMatch(/^\[SEMANTIC_HEADER\]/);
      expect(result).toContain("existing code");
    });

    it("injects at bottom", () => {
      const result = injector.injectIntoContent("existing code", header, "bottom");
      expect(result).toMatch(/existing code/);
      expect(result).toMatch(/\[SEMANTIC_HEADER\]/);
      expect(result.indexOf("existing code")).toBeLessThan(result.indexOf("[SEMANTIC_HEADER]"));
    });

    it("replaces existing header", () => {
      const existing = "code\n[SEMANTIC_HEADER]\nold data\n[/SEMANTIC_HEADER]\nmore code";
      const newHeader = "[SEMANTIC_HEADER]\nnew data\n[/SEMANTIC_HEADER]";
      const result = injector.injectIntoContent(existing, newHeader, "top");
      expect(result).not.toContain("old data");
      expect(result).toContain("new data");
      expect(result).toContain("more code");
    });
  });

  describe("updateInContent", () => {
    it("updates existing header fields", () => {
      const content = `code\n[SEMANTIC_HEADER]\nsymid: 'FILE-test'\nlifecycleStatus: 'stable'\n[/SEMANTIC_HEADER]\nmore`;
      const updated = injector.updateInContent(content, { lifecycleStatus: "deprecated" });
      expect(updated).toContain("deprecated");
      expect(updated).toContain("FILE-test");
      expect(updated).toContain("more");
    });

    it("returns unchanged when no header exists", () => {
      const content = "no header";
      expect(injector.updateInContent(content, { symid: "new" })).toBe(content);
    });
  });

  describe("roundtrip", () => {
    it("generate → extract roundtrip", () => {
      const header = injector.generateSemanticHeader({
        symid: "FILE-src-test",
        semanticHash: "sha256:abc",
        lifecycleStatus: "stable",
        description: "Test module",
      });

      const data = injector.extractFromContent(header);
      expect(data).toBeDefined();
      expect(data!.symid).toBe("FILE-src-test");
      expect(data!.semanticHash).toBe("sha256:abc");
      expect(data!.description).toBe("Test module");
    });

    it("inject → extract roundtrip", () => {
      const header = injector.generateSemanticHeader({ symid: "FILE-roundtrip" });
      const content = injector.injectIntoContent("module code", header);
      const extracted = injector.extractFromContent(content);
      expect(extracted!.symid).toBe("FILE-roundtrip");
    });
  });
});
