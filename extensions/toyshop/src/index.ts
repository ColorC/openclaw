/**
 * ToyShop - Low-supervision software factory
 *
 * OpenClaw Extension for automated software development
 *
 * This TypeScript module provides a thin bridge to the Python backend
 * which handles all LLM calls via openhands-sdk.
 */

// Extension entry point
export { ToyShopExtension, type ToyShopConfig } from "./extension.js";

// Bridge client for direct access
export {
  BridgeClient,
  getBridgeClient,
  closeBridgeClient,
  type PipelineResult,
  type ValidationResult,
} from "./bridge-client.js";
