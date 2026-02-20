/**
 * SymidGenerator 单元测试
 */

import { describe, expect, it } from "vitest";
import { SymidGenerator } from "./symid-generator.js";

describe("SymidGenerator", () => {
  const gen = new SymidGenerator("/project");

  describe("normalizePath", () => {
    it("normalizes a typical path", () => {
      expect(SymidGenerator.normalizePath("src/agents/Project.Agent.py")).toBe(
        "src-agents-project-agent",
      );
    });

    it("handles backslashes", () => {
      expect(SymidGenerator.normalizePath("src\\utils\\helper.ts")).toBe("src-utils-helper");
    });

    it("removes file extension", () => {
      expect(SymidGenerator.normalizePath("foo/bar.test.ts")).toBe("foo-bar-test");
    });

    it("collapses multiple hyphens", () => {
      expect(SymidGenerator.normalizePath("src//agents///test.py")).toBe("src-agents-test");
    });

    it("strips leading/trailing hyphens", () => {
      expect(SymidGenerator.normalizePath("/src/test.py")).toBe("src-test");
    });
  });

  describe("generateFileSymid", () => {
    it("generates FILE- prefix", () => {
      const symid = gen.generateFileSymid("src/agents/test.ts");
      expect(symid).toBe("FILE-src-agents-test");
    });

    it("handles absolute paths", () => {
      const symid = gen.generateFileSymid("/project/src/foo.ts");
      expect(symid).toBe("FILE-src-foo");
    });
  });

  describe("generateClassSymid", () => {
    it("generates CLASS- prefix", () => {
      const fileSymid = "FILE-src-agents-test";
      const symid = gen.generateClassSymid(fileSymid, "MyAgent");
      expect(symid).toBe("CLASS-FILE-src-agents-test-MyAgent");
    });

    it("throws on invalid file symid", () => {
      expect(() => gen.generateClassSymid("INVALID-id", "Cls")).toThrow("Invalid file_symid");
    });

    it("throws on empty class name", () => {
      expect(() => gen.generateClassSymid("FILE-test", "")).toThrow("className cannot be empty");
    });
  });

  describe("generateFuncSymid", () => {
    it("includes hash by default", () => {
      const symid = gen.generateFuncSymid("FILE-src-test", "myFunc");
      expect(symid).toMatch(/^FUNC-FILE-src-test-myFunc-[0-9a-f]{8}$/);
    });

    it("can exclude hash", () => {
      const symid = gen.generateFuncSymid("FILE-src-test", "myFunc", false);
      expect(symid).toBe("FUNC-FILE-src-test-myFunc");
    });

    it("accepts CLASS parent", () => {
      const symid = gen.generateFuncSymid("CLASS-FILE-test-MyClass", "process");
      expect(symid).toMatch(/^FUNC-CLASS-FILE-test-MyClass-process-/);
    });

    it("throws on invalid parent", () => {
      expect(() => gen.generateFuncSymid("SUBFLOW-bad", "fn")).toThrow("Invalid parent_symid");
    });
  });

  describe("generateSubflowSymid", () => {
    it("generates SUBFLOW- prefix", () => {
      const funcSymid = "FUNC-FILE-test-myFunc-abcd1234";
      const symid = gen.generateSubflowSymid(funcSymid, "fileScan");
      expect(symid).toBe("SUBFLOW-FUNC-FILE-test-myFunc-abcd1234-fileScan");
    });

    it("throws on non-FUNC parent", () => {
      expect(() => gen.generateSubflowSymid("FILE-test", "sub")).toThrow("Invalid func_symid");
    });
  });

  describe("shortHash", () => {
    it("generates consistent 8-char hex", () => {
      const h1 = SymidGenerator.shortHash("test");
      const h2 = SymidGenerator.shortHash("test");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(8);
      expect(h1).toMatch(/^[0-9a-f]+$/);
    });

    it("supports custom length", () => {
      expect(SymidGenerator.shortHash("test", 16)).toHaveLength(16);
    });
  });

  describe("parseSymid", () => {
    it("parses FILE symid", () => {
      const parsed = gen.parseSymid("FILE-src-agents-test");
      expect(parsed.type).toBe("FILE");
      expect(parsed.path).toBe("src-agents-test");
    });

    it("parses CLASS symid", () => {
      const parsed = gen.parseSymid("CLASS-FILE-src-test-MyClass");
      expect(parsed.type).toBe("CLASS");
      expect(parsed.parentType).toBe("FILE");
      expect(parsed.name).toBe("MyClass");
    });

    it("parses FUNC symid with hash", () => {
      const parsed = gen.parseSymid("FUNC-FILE-test-myFunc-a1b2c3d4");
      expect(parsed.type).toBe("FUNC");
      expect(parsed.name).toBe("myFunc");
      expect(parsed.hash).toBe("a1b2c3d4");
    });

    it("parses FUNC symid without hash", () => {
      const parsed = gen.parseSymid("FUNC-FILE-test-myFunc");
      expect(parsed.type).toBe("FUNC");
      expect(parsed.name).toBe("myFunc");
      expect(parsed.hash).toBeNull();
    });

    it("parses SUBFLOW symid", () => {
      const parsed = gen.parseSymid("SUBFLOW-FUNC-test-myFunc-a1b2c3d4-fileScan");
      expect(parsed.type).toBe("SUBFLOW");
      expect(parsed.parentType).toBe("FUNC");
      expect(parsed.name).toBe("fileScan");
    });

    it("returns UNKNOWN for invalid", () => {
      const parsed = gen.parseSymid("WEIRD-thing");
      expect(parsed.type).toBe("UNKNOWN");
      expect(parsed.error).toBeDefined();
    });
  });
});
