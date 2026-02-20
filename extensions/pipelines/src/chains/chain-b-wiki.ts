/**
 * Chain B — 整理链路 (Wiki 生成/更新)
 *
 * B1 (new): explore → annotate → save_docs → organize → synthesize_wiki → END
 * B2 (existing): explore → update_headers → update_docs → organize → END
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { FileAnnotation } from "../adapters/exploration-to-knowledge.js";
import type { ArchExploreNodeOverrides } from "../maintenance/architecture-exploration.js";
import type { DocOrgNodeOverrides } from "../maintenance/document-organization.js";
import type { ExplorationFinding } from "../maintenance/states.js";
import type { ChainContext } from "./chain-context.js";
import {
  annotateDiscoveredFiles,
  saveExplorationToProjectDocs,
} from "../adapters/exploration-to-knowledge.js";
import {
  annotationsToDiscoveredFiles,
  synthesizeWikiPages,
} from "../adapters/knowledge-to-wiki.js";
import { createArchitectureExplorationGraph } from "../maintenance/architecture-exploration.js";
import { createDocumentOrganizationGraph } from "../maintenance/document-organization.js";
import { withStepHook, type StepHookConfig } from "./step-hook.js";

// ============================================================================
// State
// ============================================================================

export const ChainBAnnotation = Annotation.Root({
  // 输入
  projectPath: Annotation<string>({ default: () => "." }),
  projectName: Annotation<string>({ default: () => "project" }),
  mode: Annotation<"new_project" | "existing_project">({ default: () => "new_project" }),
  userInput: Annotation<string>({ default: () => "探索项目架构并生成 Wiki" }),
  maxExplorationIterations: Annotation<number>({ default: () => 3 }),
  // 中间
  explorationFindings: Annotation<ExplorationFinding[]>({ default: () => [] }),
  architectureSummary: Annotation<string>({ default: () => "" }),
  fileAnnotations: Annotation<FileAnnotation[]>({ default: () => [] }),
  // 输出
  wikiPages: Annotation<Array<{ pageName: string; content: string }>>({ default: () => [] }),
  success: Annotation<boolean>({ default: () => false }),
  error: Annotation<string | undefined>({ default: () => undefined }),
  summary: Annotation<string>({ default: () => "" }),
});

export type ChainBState = typeof ChainBAnnotation.State;

export type ChainBNodeExecutor = (state: ChainBState) => Promise<Partial<ChainBState>>;

export interface ChainBConfig {
  exploreOverrides?: ArchExploreNodeOverrides;
  docOrgOverrides?: DocOrgNodeOverrides;
}

// ============================================================================
// Default Nodes
// ============================================================================

function createDefaultNodes(ctx: ChainContext, config: ChainBConfig = {}) {
  return {
    async explore(state: ChainBState): Promise<Partial<ChainBState>> {
      const graph = createArchitectureExplorationGraph(config.exploreOverrides);
      const result = await graph.invoke({
        userInput: state.userInput,
        maxIterations: state.maxExplorationIterations,
        projectPath: state.projectPath,
      });
      if (result.error) return { error: result.error };
      return {
        explorationFindings: result.findings,
        architectureSummary: result.architectureSummary,
      };
    },

    async annotateFiles(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error || !state.explorationFindings?.length) return {};
      const annotations = annotateDiscoveredFiles(
        ctx.symidGen,
        ctx.headerInjector,
        state.explorationFindings,
        { lifecycleStatus: "experimental" },
      );
      return { fileAnnotations: annotations };
    },

    async saveDocs(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error || !state.fileAnnotations?.length) return {};
      saveExplorationToProjectDocs(
        ctx.docManager,
        { architectureSummary: state.architectureSummary, keyFindings: [] },
        state.fileAnnotations,
      );
      return {};
    },

    async updateHeaders(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error || !state.explorationFindings?.length) return {};
      // 增量模式：只更新已有语义头
      const annotations = annotateDiscoveredFiles(
        ctx.symidGen,
        ctx.headerInjector,
        state.explorationFindings,
        { lifecycleStatus: "stable" },
      );
      // 更新已有文档
      for (const ann of annotations) {
        ctx.docManager.saveFileDoc(
          ann.filePath,
          [
            `# ${ann.filePath} (updated)`,
            "",
            `SymID: \`${ann.symid}\``,
            "",
            "## Updated Findings",
            ...ann.findings.map((f) => `- [${f.type}] ${f.content}`),
          ].join("\n"),
        );
      }
      return { fileAnnotations: annotations };
    },

    async organize(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error || !state.fileAnnotations?.length) return {};
      const discoveredFiles = annotationsToDiscoveredFiles(state.fileAnnotations);
      const graph = createDocumentOrganizationGraph(config.docOrgOverrides);
      await graph.invoke({
        sourceDir: state.projectPath,
        projectRoot: state.projectPath,
        importToPm: false,
        discoveredFiles,
      });
      return {};
    },

    async synthesizeWiki(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error || !state.fileAnnotations?.length) {
        return { success: false, summary: state.error ?? "No annotations to synthesize" };
      }
      const pages = synthesizeWikiPages(ctx.docManager, state.fileAnnotations, state.projectName);
      return {
        wikiPages: pages,
        success: true,
        summary: `Generated ${pages.length} wiki pages from ${state.fileAnnotations.length} annotated files`,
      };
    },

    async finalizeExisting(state: ChainBState): Promise<Partial<ChainBState>> {
      if (state.error) {
        return { success: false, summary: state.error };
      }
      return {
        success: true,
        summary: `Updated ${state.fileAnnotations?.length ?? 0} file annotations (incremental mode)`,
      };
    },
  };
}

// ============================================================================
// Router
// ============================================================================

function routeByMode(state: ChainBState): "annotate_files" | "update_headers" {
  return state.mode === "new_project" ? "annotate_files" : "update_headers";
}

function routeAfterOrganize(state: ChainBState): "synthesize_wiki" | "finalize_existing" {
  return state.mode === "new_project" ? "synthesize_wiki" : "finalize_existing";
}

// ============================================================================
// Graph Builder
// ============================================================================

export function createChainBGraph(ctx: ChainContext, config: ChainBConfig = {}) {
  const nodes = createDefaultNodes(ctx, config);
  const workflowId = `chain-b-${Date.now()}`;
  const hookConfig: StepHookConfig = { workflowId, chainId: "B" };

  const wrap = <T extends ChainBNodeExecutor>(nodeId: string, fn: T) =>
    withStepHook(nodeId, fn, ctx, hookConfig) as unknown as T;

  const workflow = new StateGraph(ChainBAnnotation)
    .addNode("explore", wrap("explore", nodes.explore))
    .addNode("annotate_files", wrap("annotate_files", nodes.annotateFiles))
    .addNode("save_docs", wrap("save_docs", nodes.saveDocs))
    .addNode("update_headers", wrap("update_headers", nodes.updateHeaders))
    .addNode("organize", wrap("organize", nodes.organize))
    .addNode("synthesize_wiki", wrap("synthesize_wiki", nodes.synthesizeWiki))
    .addNode("finalize_existing", wrap("finalize_existing", nodes.finalizeExisting))
    // 流程
    .addEdge(START, "explore")
    .addConditionalEdges("explore", routeByMode, {
      annotate_files: "annotate_files",
      update_headers: "update_headers",
    })
    // B1 路径
    .addEdge("annotate_files", "save_docs")
    .addEdge("save_docs", "organize")
    // B2 路径
    .addEdge("update_headers", "organize")
    // 共同 → 分叉
    .addConditionalEdges("organize", routeAfterOrganize, {
      synthesize_wiki: "synthesize_wiki",
      finalize_existing: "finalize_existing",
    })
    .addEdge("synthesize_wiki", END)
    .addEdge("finalize_existing", END);

  return workflow.compile();
}
