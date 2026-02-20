/**
 * ComplianceChecker 单元测试
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ComplianceChecker } from "./compliance-checker.js";

async function withProject(
  structure: Record<string, string>,
  fn: (checker: ComplianceChecker, root: string) => Promise<void>,
) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "compliance-"));
  try {
    for (const [filePath, content] of Object.entries(structure)) {
      const full = path.join(root, filePath);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, content, "utf-8");
    }
    const checker = new ComplianceChecker(root);
    await fn(checker, root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

describe("ComplianceChecker", () => {
  describe("RULE-INFRA-001: LLM SDK bypass", () => {
    it("detects direct openai import", async () => {
      await withProject(
        {
          "src/agents/my-agent.ts": `
import OpenAI from 'openai'
const client = new OpenAI()
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const llmViolations = report.violations.filter((v) => v.rule === "RULE-INFRA-001");
          expect(llmViolations.length).toBeGreaterThan(0);
          expect(llmViolations[0].message).toContain("Direct LLM SDK import");
        },
      );
    });

    it("detects direct anthropic import", async () => {
      await withProject(
        {
          "src/tools/helper.ts": `
import Anthropic from '@anthropic-ai/sdk'
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const llmViolations = report.violations.filter((v) => v.rule === "RULE-INFRA-001");
          expect(llmViolations.length).toBeGreaterThan(0);
        },
      );
    });

    it("allows LLM imports in whitelisted directories", async () => {
      await withProject(
        {
          "src/services/llm/client.ts": `
import OpenAI from 'openai'
export const client = new OpenAI()
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const llmViolations = report.violations.filter((v) => v.rule === "RULE-INFRA-001");
          expect(llmViolations.length).toBe(0);
        },
      );
    });
  });

  describe("RULE-INFRA-003: Workflow location", () => {
    it("detects StateGraph outside workflows directory", async () => {
      await withProject(
        {
          "src/agents/workflow.ts": `
const graph = new StateGraph(annotation)
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const violations = report.violations.filter((v) => v.rule === "RULE-INFRA-003");
          expect(violations.length).toBeGreaterThan(0);
          expect(violations[0].message).toContain("src/workflows/");
        },
      );
    });

    it("allows StateGraph in workflows directory", async () => {
      await withProject(
        {
          "src/workflows/my-flow.ts": `
const graph = new StateGraph(annotation)
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const violations = report.violations.filter((v) => v.rule === "RULE-INFRA-003");
          expect(violations.length).toBe(0);
        },
      );
    });

    it("allows StateGraph in pipelines directory", async () => {
      await withProject(
        {
          "src/pipelines/generation/graph.ts": `
const graph = new StateGraph(annotation)
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const violations = report.violations.filter((v) => v.rule === "RULE-INFRA-003");
          expect(violations.length).toBe(0);
        },
      );
    });
  });

  describe("RULE-INFRA-005: Logging bypass", () => {
    it("detects console.log usage", async () => {
      await withProject(
        {
          "src/utils/helper.ts": `
export function doSomething() {
  console.log('debug info')
  console.error('oops')
}
`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra" });
          const violations = report.violations.filter((v) => v.rule === "RULE-INFRA-005");
          expect(violations.length).toBe(2); // console.log + console.error
        },
      );
    });

    it("skips console checks in quick mode", async () => {
      await withProject(
        {
          "src/utils/helper.ts": `console.log('hello')`,
        },
        async (checker) => {
          const report = checker.run({ checkType: "infra", quick: true });
          const violations = report.violations.filter((v) => v.rule === "RULE-INFRA-005");
          expect(violations.length).toBe(0); // INFO severity skipped in quick mode
        },
      );
    });
  });

  describe("RULE-STRUCT: Directory structure", () => {
    it("detects forbidden directories", async () => {
      await withProject(
        {
          "src/data/records.ts": "export const x = 1",
          "src/tests/test1.ts": "export const y = 2",
        },
        async (checker) => {
          const report = checker.run({ checkType: "structure" });
          const forbiddenViolations = report.violations.filter((v) => v.rule === "RULE-STRUCT-001");
          expect(forbiddenViolations.length).toBe(2);
        },
      );
    });

    it("detects unknown directories", async () => {
      await withProject(
        {
          "src/helpers/util.ts": "export const x = 1",
          "src/random_dir/stuff.ts": "export const y = 2",
        },
        async (checker) => {
          const report = checker.run({ checkType: "structure" });
          const unknownViolations = report.violations.filter((v) => v.rule === "RULE-STRUCT-002");
          expect(unknownViolations.length).toBe(2);
        },
      );
    });

    it("allows known directories", async () => {
      await withProject(
        {
          "src/core/index.ts": "export const x = 1",
          "src/agents/agent.ts": "export const y = 2",
          "src/workflows/flow.ts": "export const z = 3",
          "src/utils/helper.ts": "export const w = 4",
        },
        async (checker) => {
          const report = checker.run({ checkType: "structure" });
          const structViolations = report.violations.filter(
            (v) => v.rule === "RULE-STRUCT-001" || v.rule === "RULE-STRUCT-002",
          );
          expect(structViolations.length).toBe(0);
        },
      );
    });
  });

  describe("Single file check", () => {
    it("checks a single target file", async () => {
      await withProject(
        {
          "src/agents/my-agent.ts": `
import OpenAI from 'openai'
console.log('debug')
`,
        },
        async (checker) => {
          const report = checker.run({ targetFile: "src/agents/my-agent.ts" });
          expect(report.filesScanned).toBe(1);
          expect(report.violations.length).toBeGreaterThan(0);
        },
      );
    });
  });

  describe("Custom rules", () => {
    it("supports custom rule registration", async () => {
      await withProject(
        {
          "src/core/module.ts": 'export const TODO = "something"',
        },
        async (checker) => {
          checker.registerRule({
            id: "CUSTOM-001",
            name: "No TODO in production code",
            severity: "WARNING",
            checkType: "all",
            check: (_filePath, content, relPath) => {
              const violations = [];
              if (content.includes("TODO")) {
                violations.push({
                  severity: "WARNING" as const,
                  rule: "CUSTOM-001",
                  file: relPath,
                  message: "TODO found in code",
                });
              }
              return violations;
            },
          });

          const report = checker.run();
          const custom = report.violations.filter((v) => v.rule === "CUSTOM-001");
          expect(custom.length).toBe(1);
        },
      );
    });
  });

  describe("Report", () => {
    it("correctly counts violations by severity", async () => {
      await withProject(
        {
          "src/agents/bad.ts": `
import OpenAI from 'openai'
console.log('hello')
`,
        },
        async (checker) => {
          const report = checker.run();
          expect(report.errorCount).toBeGreaterThanOrEqual(1); // LLM bypass = ERROR
          expect(report.infoCount).toBeGreaterThanOrEqual(1); // console = INFO
        },
      );
    });

    it("report passes when no critical or error violations", async () => {
      await withProject(
        {
          "src/core/clean.ts": `
export function add(a: number, b: number) { return a + b }
`,
        },
        async (checker) => {
          const report = checker.run();
          expect(report.passed).toBe(true);
        },
      );
    });

    it("formats report as text", async () => {
      await withProject(
        {
          "src/core/clean.ts": "export const x = 1",
        },
        async (checker) => {
          const report = checker.run();
          const text = checker.formatReport(report);
          expect(text).toContain("Compliance Report");
          expect(text).toContain("Result: PASSED");
        },
      );
    });
  });
});
