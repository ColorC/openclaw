/**
 * ToyShop Extension - OpenClaw extension entry point
 *
 * This extension provides software factory capabilities using
 * a Python backend via JSON-RPC bridge.
 */

import { BridgeClient } from "./bridge-client.js";

// Type definition for OpenClaw plugin API
interface OpenClawPluginApi {
  id: string;
  name: string;
  config: { workspaceDir: string };
  pluginConfig?: Record<string, unknown>;
  registerService: (service: {
    id: string;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }) => void;
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (params: unknown) => Promise<unknown>;
  }) => void;
}

// Re-export types
export { BridgeClient };
export type { PipelineResult, ValidationResult } from "./bridge-client.js";

// ============================================================================
// Extension Definition
// ============================================================================

export interface ToyShopConfig {
  /** Maximum time to wait for pipeline completion (ms) */
  pipelineTimeout: number;
  /** Python executable path */
  pythonPath: string;
}

const DEFAULT_CONFIG: ToyShopConfig = {
  pipelineTimeout: 600000, // 10 minutes
  pythonPath: "python3",
};

export class ToyShopExtension {
  private config: ToyShopConfig;
  private workspaceDir: string;
  private bridge: BridgeClient | null = null;

  constructor(workspaceDir: string, config?: Partial<ToyShopConfig>) {
    this.workspaceDir = workspaceDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the extension
   */
  async initialize(): Promise<void> {
    this.bridge = new BridgeClient({
      pythonPath: this.config.pythonPath,
    });
    this.bridge.start();
  }

  /**
   * Shutdown the extension
   */
  async shutdown(): Promise<void> {
    if (this.bridge) {
      this.bridge.stop();
      this.bridge = null;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ToyShopConfig {
    return { ...this.config };
  }

  /**
   * Get workspace directory
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Run the development pipeline
   */
  async runPipeline(
    userInput: string,
    projectName: string,
  ): Promise<{
    success: boolean;
    error?: string;
    proposal?: string;
    design?: string;
    tasks?: string;
    spec?: string;
  }> {
    if (!this.bridge) {
      return { success: false, error: "Extension not initialized" };
    }

    try {
      const result = await this.bridge.runPipeline(userInput, projectName, this.workspaceDir);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        proposal: result.proposal || undefined,
        design: result.design || undefined,
        tasks: result.tasks || undefined,
        spec: result.spec || undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Validate an OpenSpec document
   */
  async validateOpenSpec(
    type: "proposal" | "design" | "tasks" | "spec",
    content: string,
  ): Promise<{ valid: boolean; errors: string[] }> {
    if (!this.bridge) {
      return { valid: false, errors: ["Extension not initialized"] };
    }

    try {
      const result = await this.bridge.validateOpenSpec(type, content);
      return {
        valid: result.valid,
        errors: result.errors.map((e) => `${e.path}: ${e.message}`),
      };
    } catch (err) {
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }
}

// ============================================================================
// OpenClaw Plugin Registration
// ============================================================================

export default function createExtension(api: OpenClawPluginApi): ToyShopExtension {
  const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;
  const config: Partial<ToyShopConfig> = {
    pipelineTimeout:
      (pluginConfig?.pipelineTimeout as number | undefined) ?? DEFAULT_CONFIG.pipelineTimeout,
    pythonPath: (pluginConfig?.pythonPath as string | undefined) ?? DEFAULT_CONFIG.pythonPath,
  };

  const extension = new ToyShopExtension(api.config.workspaceDir, config);

  // Register service for lifecycle management
  api.registerService({
    id: "toyshop",
    start: async () => {
      await extension.initialize();
    },
    stop: async () => {
      await extension.shutdown();
    },
  });

  // Register tool for agent to call
  api.registerTool({
    name: "toyshop_run_pipeline",
    description: "Run the ToyShop development pipeline to generate software from requirements",
    parameters: {
      type: "object",
      properties: {
        user_input: {
          type: "string",
          description: "User's project description and requirements",
        },
        project_name: {
          type: "string",
          description: "Name for the project",
        },
      },
      required: ["user_input", "project_name"],
    },
    execute: async (params: unknown) => {
      const { user_input, project_name } = params as { user_input: string; project_name: string };
      const result = await extension.runPipeline(user_input, project_name);
      return {
        success: result.success,
        message: result.success
          ? "Pipeline completed successfully"
          : `Pipeline failed: ${result.error}`,
        data: result,
      };
    },
  });

  return extension;
}
