/**
 * Bridge Client - JSON-RPC client for Python subprocess
 *
 * Spawns the Python bridge process and communicates via stdin/stdout.
 */

import { spawn, ChildProcess } from "child_process";

// ============================================================================
// Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number;
}

export interface PipelineResult {
  current_stage: string;
  error: string | null;
  project_id: string | null;
  snapshot_id: string | null;
  proposal: string | null;
  design: string | null;
  tasks: string | null;
  spec: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings: Array<{ path: string; message: string }>;
}

// ============================================================================
// Bridge Client
// ============================================================================

export class BridgeClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private buffer = "";
  private pythonPath: string;
  private bridgeModule: string;

  constructor(options?: { pythonPath?: string; bridgeModule?: string }) {
    this.pythonPath = options?.pythonPath || "python3";
    this.bridgeModule = options?.bridgeModule || "toyshop.bridge";
  }

  /**
   * Start the Python bridge process
   */
  start(): void {
    if (this.process) return;

    this.process = spawn(this.pythonPath, ["-m", this.bridgeModule], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      // Log to console but don't interfere with JSON-RPC
      console.error("[toyshop-bridge]", data.toString().trim());
    });

    this.process.on("error", (err) => {
      console.error("[toyshop-bridge] Process error:", err);
    });

    this.process.on("exit", (code) => {
      console.error("[toyshop-bridge] Process exited with code:", code);
      this.process = null;
    });
  }

  /**
   * Stop the Python bridge process
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Call a JSON-RPC method
   */
  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("Bridge process not started"));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        method,
        params,
        id,
      };

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      const line = JSON.stringify(request) + "\n";
      this.process.stdin.write(line);
    });
  }

  /**
   * Run the complete development pipeline
   */
  async runPipeline(
    userInput: string,
    projectName: string,
    workspaceDir: string,
  ): Promise<PipelineResult> {
    return this.call<PipelineResult>("run_pipeline", {
      user_input: userInput,
      project_name: projectName,
      workspace_dir: workspaceDir,
    });
  }

  /**
   * Run only the requirement stage
   */
  async runRequirement(
    userInput: string,
    projectName: string,
  ): Promise<{
    current_step: string;
    error: string | null;
    proposal: string | null;
  }> {
    return this.call("run_requirement", {
      user_input: userInput,
      project_name: projectName,
    });
  }

  /**
   * Run only the architecture stage
   */
  async runArchitecture(proposalMarkdown: string): Promise<{
    current_step: string;
    error: string | null;
    design: string | null;
    tasks: string | null;
    spec: string | null;
  }> {
    return this.call("run_architecture", {
      proposal_markdown: proposalMarkdown,
    });
  }

  /**
   * Validate an OpenSpec document
   */
  async validateOpenSpec(
    type: "proposal" | "design" | "tasks" | "spec",
    content: string,
  ): Promise<ValidationResult> {
    return this.call("validate_openspec", { type, content });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        console.error("[toyshop-bridge] Failed to parse response:", line, err);
      }
    }
  }
}

// Singleton for convenience
let _client: BridgeClient | null = null;

export function getBridgeClient(): BridgeClient {
  if (!_client) {
    _client = new BridgeClient();
    _client.start();
  }
  return _client;
}

export function closeBridgeClient(): void {
  if (_client) {
    _client.stop();
    _client = null;
  }
}
