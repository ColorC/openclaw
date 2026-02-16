/**
 * 自我迭代系统测试
 *
 * 覆盖: FailureCollector, KPICollector, LineageTracker, PatchDatabase, ArgueManager
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Patch, ArgueMessage } from "./models.js";
import { ArgueManager } from "./argue-manager.js";
import { FailureCollector } from "./failure-collector.js";
import { KPICollector } from "./kpi-collector.js";
import { LineageTracker } from "./lineage-tracker.js";
import { PatchDatabase } from "./patch-database.js";

// ============================================================================
// 测试工具
// ============================================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "si-test-"));
}

// ============================================================================
// FailureCollector
// ============================================================================

describe("FailureCollector", () => {
  let collector: FailureCollector;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    collector = new FailureCollector(path.join(dir, "failures.db"));
  });

  afterEach(() => {
    collector.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("collects and queries by workflow", () => {
    collector.collectFailure({
      failureId: "f-1",
      workflowId: "wf-a",
      nodeId: "node-1",
      failureType: "execution_error",
      severity: "high",
      errorMessage: "Something broke",
    });
    collector.collectFailure({
      failureId: "f-2",
      workflowId: "wf-b",
      nodeId: "node-2",
      failureType: "quality_gate",
      severity: "medium",
      errorMessage: "Quality too low",
    });

    const wfA = collector.queryByWorkflow("wf-a");
    expect(wfA).toHaveLength(1);
    expect(wfA[0].failureId).toBe("f-1");
    expect(wfA[0].severity).toBe("high");
  });

  it("queries by node", () => {
    collector.collectFailure({
      failureId: "f-3",
      workflowId: "wf-a",
      nodeId: "coder",
      failureType: "argue",
      severity: "low",
      errorMessage: "Argue triggered",
    });
    expect(collector.queryByNode("coder")).toHaveLength(1);
  });

  it("queries by type", () => {
    collector.collectFailure({
      failureId: "f-4",
      workflowId: "wf-a",
      nodeId: "n",
      failureType: "circuit_breaker",
      severity: "critical",
      errorMessage: "Circuit open",
    });
    expect(collector.queryByType("circuit_breaker")).toHaveLength(1);
  });

  it("resolves failure", () => {
    collector.collectFailure({
      failureId: "f-5",
      workflowId: "wf-a",
      nodeId: "n",
      failureType: "execution_error",
      severity: "high",
      errorMessage: "Error",
    });
    expect(collector.getUnresolved()).toHaveLength(1);
    expect(collector.resolveFailure("f-5", "auto_patch")).toBe(true);
    expect(collector.getUnresolved()).toHaveLength(0);
  });

  it("collects with input snapshot", () => {
    collector.collectFailure({
      failureId: "f-6",
      workflowId: "wf-a",
      nodeId: "n",
      failureType: "input_validation",
      severity: "medium",
      errorMessage: "Bad input",
      inputSnapshot: { key: "value" },
      stackTrace: "Error at line 42",
    });
    const result = collector.queryByWorkflow("wf-a");
    expect(result[0].inputSnapshot).toEqual({ key: "value" });
    expect(result[0].stackTrace).toBe("Error at line 42");
  });

  it("returns statistics", () => {
    collector.collectFailure({
      failureId: "f-7",
      workflowId: "wf-a",
      nodeId: "n",
      failureType: "execution_error",
      severity: "high",
      errorMessage: "E",
    });
    collector.collectFailure({
      failureId: "f-8",
      workflowId: "wf-a",
      nodeId: "n",
      failureType: "quality_gate",
      severity: "low",
      errorMessage: "E",
    });
    const stats = collector.getStatistics(30);
    expect(stats.total).toBe(2);
    expect(stats.unresolved).toBe(2);
    expect(stats.byType.execution_error).toBe(1);
  });
});

// ============================================================================
// KPICollector
// ============================================================================

describe("KPICollector", () => {
  let collector: KPICollector;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    collector = new KPICollector(path.join(dir, "kpi.db"));
  });

  afterEach(() => {
    collector.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("collects and queries metrics", () => {
    collector.collectMetric({
      metricId: "m-1",
      kpiType: "latency",
      value: 1200,
      unit: "ms",
      workflowId: "wf-a",
      nodeId: "node-1",
      timestamp: "",
      tags: { env: "prod" },
    });
    const metrics = collector.queryMetrics({ workflowId: "wf-a" });
    expect(metrics).toHaveLength(1);
    expect(metrics[0].value).toBe(1200);
    expect(metrics[0].tags.env).toBe("prod");
  });

  it("collects and queries evaluations", () => {
    collector.collectEvaluation({
      evaluationId: "e-1",
      kpiType: "quality_score",
      score: 0.85,
      workflowId: "wf-a",
      evaluator: "claude",
      comment: "Good",
      criteria: { readability: 0.9 },
      timestamp: "",
    });
    const evals = collector.queryEvaluations({ kpiType: "quality_score" });
    expect(evals).toHaveLength(1);
    expect(evals[0].score).toBe(0.85);
    expect(evals[0].evaluator).toBe("claude");
  });

  it("sets and gets active expectations", () => {
    collector.setExpectation({
      expectationId: "exp-1",
      kpiType: "latency",
      targetValue: 1000,
      operator: "<",
      description: "Under 1s",
      level: "hard",
      flexibility: 0,
      active: true,
      createdAt: new Date().toISOString(),
    });
    collector.setExpectation({
      expectationId: "exp-2",
      kpiType: "success_rate",
      targetValue: 0.95,
      operator: ">=",
      description: "95%+ success",
      level: "soft",
      flexibility: 0.05,
      active: true,
      createdAt: new Date().toISOString(),
    });
    const all = collector.getActiveExpectations();
    expect(all).toHaveLength(2);
    const latency = collector.getActiveExpectations("latency");
    expect(latency).toHaveLength(1);
    expect(latency[0].operator).toBe("<");
  });

  it("collects and queries assessments", () => {
    collector.collectAssessment({
      assessmentId: "a-1",
      level: 3,
      reasoning: "Partially unmet requirements",
      workflowId: "wf-a",
      nodeId: "coder",
      evaluator: "claude",
      modelId: "claude-3",
      agentId: "agent-1",
      unmetRequirements: ["edge case handling"],
      inappropriateApproaches: [],
      recommendations: ["Add error handling"],
      timestamp: "",
    });
    const assessments = collector.queryAssessments({ minLevel: 3 });
    expect(assessments).toHaveLength(1);
    expect(assessments[0].unmetRequirements).toContain("edge case handling");
  });

  it("rejects assessment without reasoning", () => {
    expect(() =>
      collector.collectAssessment({
        assessmentId: "a-2",
        level: 1,
        reasoning: "",
        workflowId: "wf",
        nodeId: "n",
        evaluator: "sys",
        modelId: "",
        agentId: "",
        unmetRequirements: [],
        inappropriateApproaches: [],
        recommendations: [],
        timestamp: "",
      }),
    ).toThrow("reasoning is required");
  });
});

// ============================================================================
// LineageTracker
// ============================================================================

describe("LineageTracker", () => {
  let tracker: LineageTracker;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    tracker = new LineageTracker(path.join(dir, "lineage.db"));
  });

  afterEach(() => {
    tracker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records and retrieves artifact", () => {
    tracker.recordArtifact({
      artifactId: "art-1",
      artifactType: "workflow_input",
      createdBy: "user",
      workflowId: "wf-a",
      content: { data: "test" },
      parentArtifacts: [],
      metadata: {},
    });
    const artifact = tracker.getArtifact("art-1");
    expect(artifact).toBeDefined();
    expect(artifact!.contentHash).toMatch(/^[a-f0-9]{32}$/);
    expect(artifact!.content).toEqual({ data: "test" });
  });

  it("traces provenance chain", () => {
    tracker.recordArtifact({
      artifactId: "root",
      artifactType: "workflow_input",
      createdBy: "user",
      workflowId: "wf",
      content: "input",
      parentArtifacts: [],
      metadata: {},
    });
    tracker.recordArtifact({
      artifactId: "mid",
      artifactType: "node_output",
      createdBy: "agent",
      workflowId: "wf",
      content: "processed",
      parentArtifacts: ["root"],
      metadata: {},
    });
    tracker.recordArtifact({
      artifactId: "leaf",
      artifactType: "workflow_output",
      createdBy: "agent",
      workflowId: "wf",
      content: "final",
      parentArtifacts: ["mid"],
      metadata: {},
    });

    const chain = tracker.traceProvenance("leaf");
    expect(chain.depth).toBe(3);
    expect(chain.chain[0]).toHaveProperty("artifactId", "root");
    expect(chain.chain[2]).toHaveProperty("artifactId", "leaf");
  });

  it("finds related artifacts", () => {
    tracker.recordArtifact({
      artifactId: "parent",
      artifactType: "workflow_input",
      createdBy: "user",
      workflowId: "wf",
      content: "x",
      parentArtifacts: [],
      metadata: {},
    });
    tracker.recordArtifact({
      artifactId: "child-a",
      artifactType: "node_output",
      createdBy: "agent",
      workflowId: "wf",
      content: "a",
      parentArtifacts: ["parent"],
      metadata: {},
    });
    tracker.recordArtifact({
      artifactId: "child-b",
      artifactType: "node_output",
      createdBy: "agent",
      workflowId: "wf",
      content: "b",
      parentArtifacts: ["parent"],
      metadata: {},
    });

    const related = tracker.findRelated("child-a");
    expect(related.some((r) => r.artifactId === "child-b")).toBe(true);
  });

  it("returns statistics", () => {
    tracker.recordArtifact({
      artifactId: "a1",
      artifactType: "workflow_input",
      createdBy: "user",
      workflowId: "wf-a",
      content: "x",
      parentArtifacts: [],
      metadata: {},
    });
    tracker.recordArtifact({
      artifactId: "a2",
      artifactType: "workflow_output",
      createdBy: "agent",
      workflowId: "wf-a",
      content: "y",
      parentArtifacts: [],
      metadata: {},
    });
    const stats = tracker.getStatistics();
    expect(stats.total).toBe(2);
    expect(stats.byType.workflow_input).toBe(1);
  });
});

// ============================================================================
// PatchDatabase
// ============================================================================

describe("PatchDatabase", () => {
  let db: PatchDatabase;
  let dir: string;

  const samplePatch: Patch = {
    patchId: "p-1",
    patchType: "prompt_optimization",
    target: "coder_agent",
    title: "Improve coder prompt",
    description: "Add context about error handling",
    rationale: "Frequent validation failures",
    priority: 7,
    estimatedEffort: "1 hour",
    status: "suggested",
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    dir = tmpDir();
    db = new PatchDatabase(path.join(dir, "patches.db"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("saves and retrieves patch", () => {
    db.savePatch(samplePatch);
    const patch = db.getPatch("p-1");
    expect(patch).toBeDefined();
    expect(patch!.title).toBe("Improve coder prompt");
  });

  it("queries patches by status", () => {
    db.savePatch(samplePatch);
    db.savePatch({ ...samplePatch, patchId: "p-2", status: "applied" });
    const pending = db.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].patchId).toBe("p-1");
  });

  it("updates patch status", () => {
    db.savePatch(samplePatch);
    expect(db.updateStatus("p-1", "approved")).toBe(true);
    expect(db.getPatch("p-1")!.status).toBe("suggested"); // patch_data 不变
    // 但 queryPatches 按 SQL status 列查询
    expect(db.queryPatches({ status: "approved" })).toHaveLength(1);
  });

  it("records and gets effects", () => {
    db.savePatch(samplePatch);
    db.recordEffect({
      effectId: "eff-1",
      patchId: "p-1",
      effectType: "performance",
      metricName: "latency",
      metricValueBefore: 1200,
      metricValueAfter: 800,
      measuredAt: new Date().toISOString(),
    });
    const effects = db.getEffects("p-1");
    expect(effects).toHaveLength(1);
    expect(effects[0].improvementPct).toBeCloseTo(-33.33, 1);
  });

  it("adds and gets reviews", () => {
    db.savePatch(samplePatch);
    db.addReview({
      reviewId: "rev-1",
      patchId: "p-1",
      reviewer: "human",
      decision: "approved",
      comments: "Looks good",
      reviewedAt: new Date().toISOString(),
    });
    const reviews = db.getReviews("p-1");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewer).toBe("human");
  });

  it("returns statistics", () => {
    db.savePatch(samplePatch);
    db.savePatch({ ...samplePatch, patchId: "p-3", patchType: "agent_memory" });
    const stats = db.getStatistics();
    expect(stats.total).toBe(2);
    expect(stats.byType.prompt_optimization).toBe(1);
    expect(stats.byType.agent_memory).toBe(1);
  });

  it("queries by attribution", () => {
    db.savePatch({ ...samplePatch, suggestedAttributionId: "attr-1" });
    const patches = db.getByAttribution("attr-1");
    expect(patches).toHaveLength(1);
  });
});

// ============================================================================
// ArgueManager
// ============================================================================

describe("ArgueManager", () => {
  const makeArgue = (overrides?: Partial<ArgueMessage>): ArgueMessage => ({
    argueId: "arg-1",
    fromAgent: "reviewer",
    toAgent: "coder",
    taskId: "task-1",
    reason: "quality_issue",
    level: "serious",
    details: "Code quality too low",
    suggestions: ["Add error handling"],
    evidence: [
      {
        evidenceType: "execution_log",
        content: "log data",
        description: "Error log",
        metadata: {},
      },
    ],
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  it("sends argue with default evaluator", async () => {
    const manager = new ArgueManager();
    const response = await manager.sendArgue(makeArgue());
    expect(response.argueId).toBe("arg-1");
    // serious + has evidence + has suggestions → accepted
    expect(response.accepted).toBe(true);
  });

  it("rejects low-priority argue without evidence", async () => {
    const manager = new ArgueManager();
    const response = await manager.sendArgue(
      makeArgue({
        argueId: "arg-2",
        level: "suggestion",
        evidence: [],
        suggestions: [],
      }),
    );
    expect(response.accepted).toBe(false);
  });

  it("uses custom evaluator", async () => {
    const manager = new ArgueManager({
      evaluator: async (argue) => ({
        argueId: argue.argueId,
        accepted: true,
        feedback: "Custom accept",
        reasoning: "LLM decided",
        counterPoints: [],
        timestamp: new Date().toISOString(),
      }),
    });
    const response = await manager.sendArgue(makeArgue({ level: "suggestion", evidence: [] }));
    expect(response.accepted).toBe(true);
    expect(response.feedback).toBe("Custom accept");
  });

  it("sends argue-back", async () => {
    const manager = new ArgueManager();
    await manager.sendArgue(makeArgue());
    const argueBack = manager.sendArgueBack({
      argueId: "arg-1",
      argueBackId: "ab-1",
      rejectionReason: "Not reproducible",
      counterArguments: ["Works on my machine"],
    });
    expect(argueBack.argueId).toBe("arg-1");
    expect(argueBack.rejectionReason).toBe("Not reproducible");
  });

  it("requests arbitration", async () => {
    const manager = new ArgueManager({
      arbitrationCallback: async () => "Side with reviewer",
    });
    await manager.sendArgue(makeArgue());
    const arb = await manager.requestArbitration("arg-1", "reviewer", "Cannot agree");
    expect(arb.status).toBe("resolved");
    expect(arb.resolution).toBe("Side with reviewer");
  });

  it("tracks history and statistics", async () => {
    const manager = new ArgueManager();
    await manager.sendArgue(makeArgue({ argueId: "a1", level: "urgent" }));
    await manager.sendArgue(
      makeArgue({ argueId: "a2", level: "suggestion", evidence: [], suggestions: [] }),
    );

    expect(manager.getHistory()).toHaveLength(2);
    const stats = manager.getStatistics();
    expect(stats.total).toBe(2);
    expect(stats.accepted).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.byLevel.urgent).toBe(1);
  });

  it("registers agents", () => {
    const manager = new ArgueManager();
    manager.registerAgent("coder");
    manager.registerAgent("reviewer");
    // No assertion needed — smoke test
  });
});
