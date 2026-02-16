/**
 * 链式编排层导出
 */

export { createChainContext, disposeChainContext } from "./chain-context.js";
export type { ChainContext, ChainContextConfig } from "./chain-context.js";

export {
  withStepHook,
  collectFailure,
  collectStepMetric,
  recordStepArtifact,
} from "./step-hook.js";
export type { StepHookConfig } from "./step-hook.js";

export { createChainAGraph } from "./chain-a-development.js";
export type { ChainAState, ChainAConfig } from "./chain-a-development.js";

export { createChainBGraph } from "./chain-b-wiki.js";
export type { ChainBState, ChainBConfig } from "./chain-b-wiki.js";

export { createChainCGraph, runIterationCycle } from "./chain-c-iteration.js";
export type { ChainCState } from "./chain-c-iteration.js";
