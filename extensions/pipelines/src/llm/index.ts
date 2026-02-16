/**
 * LLM 模型提供者层导出
 */

export type {
  ModelRole,
  ChatMessage,
  ToolCallRequest,
  ToolDefinition,
  ChatOptions,
  ChatResponse,
  ModelProvider,
  ModelProviderConfig,
} from "./types.js";
export { resolveModelId } from "./types.js";

export {
  MockModelProvider,
  mockTextResponse,
  mockToolCallResponse,
} from "./mock-model-provider.js";
export type { MockResponseEntry, MockCallRecord } from "./mock-model-provider.js";

export { OpenAIModelProvider } from "./openai-model-provider.js";
export type { OpenAIModelProviderConfig } from "./openai-model-provider.js";
