/**
 * QualityGate 单元测试
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PMDatabase } from "./database.js";
import { QualityGate } from "./quality-gate.js";

async function withGate(
  fn: (gate: QualityGate, db: PMDatabase) => Promise<void>,
  thresholds?: Record<string, number>,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-quality-"));
  const db = new PMDatabase(path.join(tempDir, "pm.db"));
  const gate = new QualityGate(db, thresholds);
  try {
    await fn(gate, db);
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("QualityGate", () => {
  it("returns failure for non-existent requirement", async () => {
    await withGate(async (gate) => {
      const result = gate.evaluate("non-existent");
      expect(result.passed).toBe(false);
      expect(result.blockingIssues).toContain("Requirement non-existent not found");
    });
  });

  it("evaluates a well-documented requirement positively", async () => {
    await withGate(async (gate, db) => {
      db.createRequirement({
        id: "req-001",
        description:
          "实现完整的用户认证系统，包括注册、登录、密码重置功能，使用 JWT token 进行会话管理，支持 OAuth2.0 第三方登录",
        category: "authentication",
        investScore: {
          independent: 0.9,
          negotiable: 0.8,
          valuable: 1.0,
          estimable: 0.9,
          small: 0.7,
          testable: 0.9,
        },
        acceptanceCriteria: [
          { criterion: "User can register", status: "passed" },
          { criterion: "User can login", status: "passed" },
          { criterion: "JWT token issued", status: "passed" },
        ],
        metadata: { team: "backend", sprint: 3 },
      });
      db.updateRequirement("req-001", {
        estimate: 8,
        estimateUnit: "hours",
        tags: ["auth", "api"],
      });

      const result = gate.evaluate("req-001");
      // INVEST 分数来自提供的 investScore，应该很高
      expect(result.scores.invest).toBeGreaterThan(0.8);
      // 所有验收标准都通过了
      expect(result.scores.coverage).toBe(1);
    });
  });

  it("evaluates a minimal requirement negatively", async () => {
    await withGate(async (gate, db) => {
      db.createRequirement({
        id: "req-002",
        description: "Fix bug",
      });

      const result = gate.evaluate("req-002");
      // 描述太短，没有验收标准，没有估计——应该有很多问题
      expect(result.scores.invest).toBeLessThan(0.7);
      expect(result.scores.smart).toBeLessThan(0.7);
      expect(result.scores.documentation).toBeLessThan(0.7);
      expect(result.blockingIssues.length).toBeGreaterThan(0);
    });
  });

  it("considers sub-task completion in coverage", async () => {
    await withGate(async (gate, db) => {
      db.createRequirement({
        id: "parent",
        description: "完成API模块，包括所有端点的实现和测试覆盖",
      });
      db.createRequirement({
        id: "child-1",
        description: "实现 GET /users 端点",
        parentId: "parent",
      });
      db.createRequirement({
        id: "child-2",
        description: "实现 POST /users 端点",
        parentId: "parent",
      });
      db.updateRequirementStatus("child-1", "completed");
      // child-2 remains pending

      const result = gate.evaluate("parent");
      // 只有 1/2 子任务完成了，覆盖率分数应该反映这一点
      expect(result.scores.coverage).toBeLessThan(1);
    });
  });

  it("considers performance metrics", async () => {
    await withGate(async (gate, db) => {
      db.createRequirement({
        id: "req-001",
        description: "实现缓存层以提升API响应速度，目标是将P99延迟降低50%以上",
      });

      db.logPerformance({
        requirementId: "req-001",
        workflowName: "generation",
        agentName: "claude",
        argueCount: 8, // 高争议数
        circuitBreakerTriggered: true,
      });

      const result = gate.evaluate("req-001");
      // 高争议 + 断路器 → 性能分数低
      expect(result.scores.performance).toBeLessThan(0.7);
      expect(result.details.performance).toBeDefined();
    });
  });

  it("checks blocking dependencies in contract score", async () => {
    await withGate(async (gate, db) => {
      db.createRequirement({
        id: "req-001",
        description: "部署到生产环境，确保所有依赖服务就绪",
        acceptanceCriteria: [{ criterion: "Deploy succeeds", status: "pending" }],
      });
      db.createRequirement({ id: "req-002", description: "CI/CD 流水线" });
      db.createDependency("req-002", "req-001", "blocking");

      const result = gate.evaluate("req-001");
      // req-002 未完成但阻塞 req-001
      expect(result.scores.contract).toBeLessThan(1);
      expect(result.details.contract).toBeDefined();
    });
  });

  it("respects custom thresholds", async () => {
    // 用非常低的阈值，即使最差的需求也能通过
    await withGate(
      async (gate, db) => {
        db.createRequirement({ id: "req-001", description: "Minimal" });

        const result = gate.evaluate("req-001");
        expect(result.passed).toBe(true); // 阈值很低，应该通过
      },
      {
        invest: 0.1,
        smart: 0.1,
        coverage: 0.1,
        performance: 0.1,
        documentation: 0.1,
        contract: 0.1,
      },
    );
  });

  it("setThreshold clamps value to [0, 1]", async () => {
    await withGate(async (gate, db) => {
      gate.setThreshold("invest", 1.5);
      db.createRequirement({
        id: "req-001",
        description: "高质量需求描述，包含完整的实现细节和验收标准说明",
        investScore: {
          independent: 1,
          negotiable: 1,
          valuable: 1,
          estimable: 1,
          small: 1,
          testable: 1,
        },
      });

      const result = gate.evaluate("req-001");
      // Threshold clamped to 1.0, INVEST score = 1.0, should pass
      expect(result.scores.invest).toBe(1);
    });
  });
});
