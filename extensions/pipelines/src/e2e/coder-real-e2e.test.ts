/**
 * Real E2E Test for Coder Implementations
 *
 * 测试 Native Coder 和 Claude Code Coder 的真实编程能力。
 * 测试产物在 /tmp 下，下一轮对话后手动清空。
 *
 * Run:
 *   pnpm vitest run extensions/pipelines/src/e2e/coder-real-e2e.test.ts
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ============================================================================
// Test Task: Todo List CLI
// ============================================================================

const TASK_DESCRIPTION = `
Implement a simple Todo List CLI in TypeScript with the following features:

1. Create a file \`todo.ts\` that exports a TodoList class
2. The TodoList class should support:
   - addTodo(text: string): void — add a new todo item
   - listTodos(): string[] — return all todo texts
   - completeTodo(index: number): boolean — mark a todo as done, return false if index invalid
   - clearCompleted(): void — remove all completed todos
3. Each todo should have: text (string), completed (boolean), createdAt (Date)
4. Include a simple test in \`todo.test.ts\` that verifies basic functionality

The implementation should be clean TypeScript with proper typing.
`;

const TEST_DIR = path.join(os.tmpdir(), "openclaw-coder-e2e-test");

// ============================================================================
// Helpers
// ============================================================================

async function setupTestDir(): Promise<void> {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });

  // Create a minimal tsconfig.json
  await fs.writeFile(
    path.join(TEST_DIR, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          outDir: "./dist",
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );

  // Create a minimal package.json
  await fs.writeFile(
    path.join(TEST_DIR, "package.json"),
    JSON.stringify(
      {
        name: "todo-test",
        version: "1.0.0",
        type: "module",
      },
      null,
      2,
    ),
  );
}

async function cleanupTestDir(): Promise<void> {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
}

async function verifyTodoImplementation(): Promise<{
  success: boolean;
  errors: string[];
  details: string[];
}> {
  const errors: string[] = [];
  const details: string[] = [];

  // Check todo.ts exists
  const todoPath = path.join(TEST_DIR, "todo.ts");
  try {
    await fs.access(todoPath);
    details.push("✅ todo.ts exists");
  } catch {
    errors.push("todo.ts not found");
    return { success: false, errors, details };
  }

  // Check todo.test.ts exists
  const testPath = path.join(TEST_DIR, "todo.test.ts");
  try {
    await fs.access(testPath);
    details.push("✅ todo.test.ts exists");
  } catch {
    errors.push("todo.test.ts not found");
  }

  // Read and verify todo.ts content
  const todoContent = await fs.readFile(todoPath, "utf-8");

  // Check for TodoList class
  if (!todoContent.includes("class TodoList") && !todoContent.includes("export class TodoList")) {
    errors.push("TodoList class not found in todo.ts");
  } else {
    details.push("✅ TodoList class defined");
  }

  // Check for required methods
  const requiredMethods = ["addTodo", "listTodos", "completeTodo", "clearCompleted"];
  for (const method of requiredMethods) {
    if (todoContent.includes(method)) {
      details.push(`✅ Method ${method} found`);
    } else {
      errors.push(`Method ${method} not found`);
    }
  }

  // Check for typing
  if (
    todoContent.includes(": string") ||
    todoContent.includes(": number") ||
    todoContent.includes(": boolean")
  ) {
    details.push("✅ TypeScript typing present");
  } else {
    errors.push("No TypeScript type annotations found");
  }

  // Try to parse with TypeScript compiler API (no subprocess needed)
  try {
    const ts = await import("typescript");
    const program = ts.createProgram([todoPath], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    // Only count errors (not suggestions/warnings), ignore "cannot find module" for imports
    const realErrors = diagnostics.filter(
      (d) =>
        d.category === ts.DiagnosticCategory.Error &&
        !d.messageText.toString().includes("Cannot find module"),
    );
    if (realErrors.length === 0) {
      details.push("✅ TypeScript compilation successful");
    } else {
      const msgs = realErrors
        .slice(0, 3)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("; ");
      errors.push(`TypeScript compilation errors: ${msgs}`);
    }
  } catch (err) {
    // If typescript is not available, skip compilation check
    details.push("⚠️ TypeScript compiler not available, skipping compilation check");
  }

  return { success: errors.length === 0, errors, details };
}

// ============================================================================
// Tests
// ============================================================================

describe("Real E2E: Coder Implementations", () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  describe("Claude Code CLI Coder", () => {
    it(
      "should implement a complete TodoList CLI (requires claude CLI)",
      { timeout: 600_000 },
      async () => {
        const { createClaudeCodeCoderNode } =
          await import("../llm-nodes/claude-code-coder-node.js");
        const { createCoderGraph } = await import("../workflows/coder.js");

        const cliCoder = createClaudeCodeCoderNode({
          cwd: TEST_DIR,
          model: "sonnet",
          timeoutMs: 300_000, // 5 minutes
          maxRetries: 2,
          verificationPass: false, // Skip verification to save time
          maxTurns: 30,
        });

        const graph = createCoderGraph({ recursiveCoder: cliCoder });

        console.log("\n🚀 Starting Claude Code Coder e2e test...");
        const startTime = Date.now();

        const result = await graph.invoke({
          taskDescription: TASK_DESCRIPTION,
          codeContext: {},
          qualityThreshold: 0.7,
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n⏱️  Duration: ${duration}s`);
        console.log(`📊 Quality Score: ${result.qualityScore}`);
        console.log(`✅ Passed: ${result.validationResult?.passed}`);
        console.log(`📁 Modified Files: ${result.modifiedFiles?.join(", ")}`);
        console.log(`🔧 Tools Used: ${result.toolsUsed?.join(", ")}`);
        console.log(`📝 Summary: ${result.implementationSummary?.slice(0, 200)}...`);

        // Verify actual file creation
        const verification = await verifyTodoImplementation();
        console.log("\n📋 Verification Results:");
        for (const detail of verification.details) {
          console.log(`   ${detail}`);
        }
        if (verification.errors.length > 0) {
          console.log("\n❌ Errors:");
          for (const err of verification.errors) {
            console.log(`   ${err}`);
          }
        }

        expect(result.success).toBe(true);
        expect(verification.success).toBe(true);
      },
    );
  });

  describe("Native Coder (Embedded Agent + openclaw tools)", () => {
    it(
      "should implement a complete TodoList CLI via embedded agent",
      { timeout: 300_000 },
      async () => {
        const { createNativeCoderNode } = await import("../llm-nodes/native-coder-node.js");
        const { createCoderGraph } = await import("../workflows/coder.js");

        // Provider/model can be overridden via env vars.
        // The provider must be configured in ~/.openclaw/openclaw.json.
        const provider = process.env.LLM_PROVIDER || "anthropic";
        const model = process.env.LLM_MODEL || "claude-sonnet-4-20250514";

        const nativeCoder = createNativeCoderNode({
          cwd: TEST_DIR,
          provider,
          model,
          timeoutMs: 300_000,
        });

        const graph = createCoderGraph({ recursiveCoder: nativeCoder });

        console.log("\n🚀 Starting Native Coder e2e test...");
        console.log(`   Provider: ${provider}`);
        console.log(`   Model: ${model}`);
        const startTime = Date.now();

        const result = await graph.invoke({
          taskDescription: TASK_DESCRIPTION,
          codeContext: {},
          qualityThreshold: 0.7,
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n⏱️  Duration: ${duration}s`);
        console.log(`📊 Quality Score: ${result.qualityScore}`);
        console.log(`✅ Passed: ${result.validationResult?.passed}`);
        console.log(`📁 Modified Files: ${result.modifiedFiles?.join(", ")}`);
        console.log(`🔧 Tools Used: ${result.toolsUsed?.join(", ")}`);
        console.log(`📝 Summary: ${result.implementationSummary?.slice(0, 200)}...`);

        // Verify actual file creation
        const verification = await verifyTodoImplementation();
        console.log("\n📋 Verification Results:");
        for (const detail of verification.details) {
          console.log(`   ${detail}`);
        }
        if (verification.errors.length > 0) {
          console.log("\n❌ Errors:");
          for (const err of verification.errors) {
            console.log(`   ${err}`);
          }
        }

        expect(result.success).toBe(true);
        expect(verification.success).toBe(true);
      },
    );
  });

  describe("Verification Helper", () => {
    it("should correctly verify a pre-written implementation", async () => {
      // Write a correct implementation manually
      await fs.writeFile(
        path.join(TEST_DIR, "todo.ts"),
        `
export interface TodoItem {
  text: string;
  completed: boolean;
  createdAt: Date;
}

export class TodoList {
  private items: TodoItem[] = [];

  addTodo(text: string): void {
    this.items.push({
      text,
      completed: false,
      createdAt: new Date(),
    });
  }

  listTodos(): string[] {
    return this.items.map(item => item.text);
  }

  completeTodo(index: number): boolean {
    if (index < 0 || index >= this.items.length) {
      return false;
    }
    this.items[index].completed = true;
    return true;
  }

  clearCompleted(): void {
    this.items = this.items.filter(item => !item.completed);
  }
}
`,
      );

      await fs.writeFile(
        path.join(TEST_DIR, "todo.test.ts"),
        `
import { TodoList } from './todo.js';

const list = new TodoList();
list.addTodo("Test");
console.log(list.listTodos());
`,
      );

      const verification = await verifyTodoImplementation();
      console.log("\n📋 Verification Results for pre-written implementation:");
      for (const detail of verification.details) {
        console.log(`   ${detail}`);
      }
      if (verification.errors.length > 0) {
        console.log("\n❌ Errors:");
        for (const err of verification.errors) {
          console.log(`   ${err}`);
        }
      }

      expect(verification.success).toBe(true);
    });
  });
});

console.log(`\n📍 Test artifacts will be in: ${TEST_DIR}`);
console.log("📍 Run 'rm -rf /tmp/openclaw-coder-e2e-test' to clean up manually\n");
