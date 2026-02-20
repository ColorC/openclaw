/**
 * TaskQueueManager 单元测试
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PMDatabase } from "./database.js";
import { TaskQueueManager } from "./task-queue-manager.js";

async function withQueue(fn: (queue: TaskQueueManager, db: PMDatabase) => Promise<void>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-queue-"));
  const db = new PMDatabase(path.join(tempDir, "pm.db"));
  const queue = new TaskQueueManager(db);
  try {
    await fn(queue, db);
  } finally {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("TaskQueueManager", () => {
  it("publishes a task to the queue", async () => {
    await withQueue(async (queue) => {
      const task = queue.publishTask({
        taskId: "task-001",
        prompt: "创建用户注册 API",
        executorType: "claude_code",
        priority: "high",
      });

      expect(task.id).toBe("task-001");
      expect(task.description).toBe("创建用户注册 API");
      expect(task.status).toBe("pending");
    });
  });

  it("lists queued tasks", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "Task 1" });
      queue.publishTask({ taskId: "t2", prompt: "Task 2" });
      queue.publishTask({ taskId: "t3", prompt: "Task 3" });

      const all = queue.listQueue();
      expect(all.length).toBe(3);

      const limited = queue.listQueue({ limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  it("gets the next pending task", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "First" });
      queue.publishTask({ taskId: "t2", prompt: "Second" });

      const next = queue.getNextTask();
      expect(next).toBeDefined();
      // 应该返回 pending 状态的第一个任务
      expect(next?.status).toBe("pending");
    });
  });

  it("returns undefined when no pending tasks", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "Task" });
      queue.updateTaskStatus("t1", "completed");

      const next = queue.getNextTask();
      expect(next).toBeUndefined();
    });
  });

  it("updates task status with result", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "Task" });

      queue.updateTaskStatus("t1", "in_progress");
      let task = queue.getTask("t1");
      expect(task?.status).toBe("in_progress");

      queue.updateTaskStatus("t1", "completed", { output: "Done" }, undefined, 30);
      task = queue.getTask("t1");
      expect(task?.status).toBe("completed");
      expect(task?.executionResult).toEqual({ output: "Done" });
      expect(task?.executionTimeSeconds).toBe(30);
    });
  });

  it("updates task status with error", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "Task" });

      queue.updateTaskStatus("t1", "failed", undefined, "Something went wrong");
      const task = queue.getTask("t1");
      expect(task?.status).toBe("failed");
      expect(task?.executionError).toBe("Something went wrong");
    });
  });

  it("removes a task", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "Task" });

      expect(queue.removeTask("t1")).toBe(true);
      expect(queue.getTask("t1")).toBeUndefined();
      expect(queue.removeTask("non-existent")).toBe(false);
    });
  });

  it("batch removes tasks", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "A" });
      queue.publishTask({ taskId: "t2", prompt: "B" });
      queue.publishTask({ taskId: "t3", prompt: "C" });

      const removed = queue.batchRemove(["t1", "t3", "non-existent"]);
      expect(removed).toBe(2);
      expect(queue.listQueue().length).toBe(1);
    });
  });

  it("clears completed tasks", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "A" });
      queue.publishTask({ taskId: "t2", prompt: "B" });
      queue.publishTask({ taskId: "t3", prompt: "C" });
      queue.updateTaskStatus("t1", "completed");
      queue.updateTaskStatus("t3", "completed");

      const cleared = queue.clearCompleted();
      expect(cleared).toBe(2);

      const remaining = queue.listQueue();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe("t2");
    });
  });

  it("returns queue stats", async () => {
    await withQueue(async (queue) => {
      queue.publishTask({ taskId: "t1", prompt: "A" });
      queue.publishTask({ taskId: "t2", prompt: "B" });
      queue.publishTask({ taskId: "t3", prompt: "C" });
      queue.updateTaskStatus("t1", "in_progress");
      queue.updateTaskStatus("t2", "completed");

      const stats = queue.getQueueStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });
});
