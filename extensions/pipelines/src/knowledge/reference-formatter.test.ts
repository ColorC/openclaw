/**
 * ReferenceFormatter 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  formatReferencesForParsable,
  formatReferencesForMetadata,
  formatValidationSummary,
  parseReferencesFromParsable,
  type References,
  type ValidationResult,
} from "./reference-formatter.js";

const sampleRefs: References = {
  document: "design.md",
  blocks: [
    { type: "section", path: "Phase 2 完成", lineRange: [7, 40], contentHash: "a1b2c3d4e5f6a7b8" },
    {
      type: "code_block",
      path: "使用示例 > [code_block:1]",
      lineRange: [50, 92],
      contentHash: "f6e5d4c3b2a1f7e8",
    },
    { type: "table", path: "API 列表", lineRange: [100, 120], contentHash: "abcdef0123456789" },
  ],
};

describe("ReferenceFormatter", () => {
  describe("formatReferencesForParsable", () => {
    it("formats full references", () => {
      const text = formatReferencesForParsable(sampleRefs);
      expect(text).toContain("📎 引用来源");
      expect(text).toContain('章节 "Phase 2 完成"');
      expect(text).toContain("design.md#L7-40");
      expect(text).toContain("代码示例");
      expect(text).toContain("表格");
    });

    it("formats compact references", () => {
      const text = formatReferencesForParsable(sampleRefs, 5, true);
      expect(text).toContain("hash: a1b2c3d4");
      expect(text).not.toContain("design.md#");
    });

    it("limits blocks", () => {
      const text = formatReferencesForParsable(sampleRefs, 2);
      expect(text).toContain("还有 1 个引用");
    });

    it("returns empty for no refs", () => {
      expect(formatReferencesForParsable({ blocks: [] })).toBe("");
      expect(formatReferencesForParsable(null as any)).toBe("");
    });

    it("replaces code_block markers in path", () => {
      const text = formatReferencesForParsable(sampleRefs);
      expect(text).toContain("中的代码块 #1");
      expect(text).not.toContain("[code_block:1]");
    });
  });

  describe("formatReferencesForMetadata", () => {
    it("wraps in sourceReferences", () => {
      const meta = formatReferencesForMetadata(sampleRefs);
      expect(meta.sourceReferences).toBe(sampleRefs);
    });
  });

  describe("formatValidationSummary", () => {
    it("shows all valid", () => {
      const v: ValidationResult = {
        summary: { total: 5, valid: 5, invalid: 0 },
        results: {},
      };
      const text = formatValidationSummary(v);
      expect(text).toContain("✅");
      expect(text).toContain("5/5 全部有效");
    });

    it("shows invalid refs", () => {
      const v: ValidationResult = {
        summary: { total: 3, valid: 2, invalid: 1 },
        results: {
          "ref-1": { status: "valid", matchedBy: "hash", confidence: 0.95 },
          "ref-2": { status: "valid", matchedBy: "path", confidence: 0.8 },
          "ref-3": { status: "invalid", error: "Not found" },
        },
      };
      const text = formatValidationSummary(v, true);
      expect(text).toContain("⚠️");
      expect(text).toContain("2/3 有效");
      expect(text).toContain("❌ ref-3: Not found");
      expect(text).toContain("失效引用: ref-3");
    });
  });

  describe("parseReferencesFromParsable", () => {
    it("roundtrips full format", () => {
      const text = formatReferencesForParsable(sampleRefs, 5, false);
      const parsed = parseReferencesFromParsable(text);
      expect(parsed).toBeDefined();
      expect(parsed!.references).toHaveLength(3);
      expect(parsed!.references[0].type).toBe("章节");
      expect(parsed!.references[0].hash).toBe("a1b2c3d4e5f6a7b8");
      expect(parsed!.references[0].document).toBe("design.md");
    });

    it("returns undefined for no markers", () => {
      expect(parseReferencesFromParsable("just text")).toBeUndefined();
    });
  });
});
