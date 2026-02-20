/**
 * 链式编排上下文 (Chain Context)
 *
 * 服务容器：聚合所有模块实例，供链式编排器使用。
 */

import * as path from "node:path";
import type { ModelProvider } from "../llm/types.js";
import { ComplianceChecker } from "../compliance/compliance-checker.js";
import { ProjectDocManager } from "../knowledge/project-doc-manager.js";
import { SemanticHeaderInjector } from "../knowledge/semantic-header.js";
import { SymidGenerator } from "../knowledge/symid-generator.js";
import { PMDatabase } from "../pm/database.js";
import { QualityGate } from "../pm/quality-gate.js";
import { TaskQueueManager } from "../pm/task-queue-manager.js";
import { PromptRegistry } from "../prompts/prompt-registry.js";
import { ArgueManager } from "../self-iteration/argue-manager.js";
import { FailureCollector } from "../self-iteration/failure-collector.js";
import { KPICollector } from "../self-iteration/kpi-collector.js";
import { LineageTracker } from "../self-iteration/lineage-tracker.js";
import { PatchDatabase } from "../self-iteration/patch-database.js";

// ============================================================================
// ChainContext
// ============================================================================

export interface ChainContext {
  db: PMDatabase;
  queue: TaskQueueManager;
  qualityGate: QualityGate;
  compliance: ComplianceChecker;
  symidGen: SymidGenerator;
  headerInjector: SemanticHeaderInjector;
  docManager: ProjectDocManager;
  failureCollector: FailureCollector;
  kpiCollector: KPICollector;
  lineageTracker: LineageTracker;
  patchDb: PatchDatabase;
  argueManager: ArgueManager;
  /** LLM 模型提供者（可选，用于 LLM 驱动的节点） */
  modelProvider?: ModelProvider;
  /** Prompt 模板注册表（可选，配合 modelProvider 使用） */
  promptRegistry?: PromptRegistry;
}

export interface ChainContextConfig {
  dbPath: string;
  projectRoot: string;
  projectName: string;
  iterationDbDir?: string;
  qualityThresholds?: Partial<import("../pm/quality-gate.js").QualityThresholds>;
  /** LLM 模型提供者（可选） */
  modelProvider?: ModelProvider;
  /** Prompt 模板目录（可选，默认使用内置模板） */
  promptsDir?: string;
}

/** 从配置创建完整的 ChainContext */
export function createChainContext(config: ChainContextConfig): ChainContext {
  const iterDir = config.iterationDbDir ?? path.join(path.dirname(config.dbPath), "self-iteration");

  const db = new PMDatabase(config.dbPath);
  const queue = new TaskQueueManager(db);
  const qualityGate = new QualityGate(db, config.qualityThresholds);
  const compliance = new ComplianceChecker(config.projectRoot);
  const symidGen = new SymidGenerator(config.projectRoot);
  const headerInjector = new SemanticHeaderInjector();
  const docManager = new ProjectDocManager({
    projectName: config.projectName,
    projectRoot: config.projectRoot,
  });
  const failureCollector = new FailureCollector(path.join(iterDir, "failures.db"));
  const kpiCollector = new KPICollector(path.join(iterDir, "kpi.db"));
  const lineageTracker = new LineageTracker(path.join(iterDir, "lineage.db"));
  const patchDb = new PatchDatabase(path.join(iterDir, "patches.db"));
  const argueManager = new ArgueManager();

  // LLM 相关（可选）
  const promptRegistry = config.modelProvider ? new PromptRegistry(config.promptsDir) : undefined;

  return {
    db,
    queue,
    qualityGate,
    compliance,
    symidGen,
    headerInjector,
    docManager,
    failureCollector,
    kpiCollector,
    lineageTracker,
    patchDb,
    argueManager,
    modelProvider: config.modelProvider,
    promptRegistry,
  };
}

/** 关闭所有 DB 连接 */
export function disposeChainContext(ctx: ChainContext): void {
  ctx.db.close();
  ctx.failureCollector.close();
  ctx.kpiCollector.close();
  ctx.lineageTracker.close();
  ctx.patchDb.close();
}
