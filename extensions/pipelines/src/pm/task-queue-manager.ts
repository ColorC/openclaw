/**
 * 任务队列管理器
 *
 * 管理任务执行队列：发布、排序、状态更新、批量操作。
 * 任务统一存储在 requirements 表中（v2.0 模式）。
 *
 * 源码参考：_personal_copilot/src/services/pm/task_queue_manager.py
 */

import type {
  PMDatabase,
  RequirementData,
  RequirementStatus,
  Priority,
  ExecutorType,
} from "./database.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface QueueItem extends RequirementData {
  prompt?: string;
}

export interface QueueStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface PublishTaskOptions {
  taskId: string;
  prompt: string;
  executorType?: ExecutorType;
  priority?: Priority;
  requirementId?: string;
  projectId?: string;
  executorConfig?: Record<string, unknown>;
}

// ============================================================================
// TaskQueueManager
// ============================================================================

export class TaskQueueManager {
  constructor(private db: PMDatabase) {}

  /**
   * 发布任务到队列尾部
   */
  publishTask(options: PublishTaskOptions): RequirementData {
    const {
      taskId,
      prompt,
      executorType = "user",
      priority = "medium",
      requirementId,
      projectId,
      executorConfig,
    } = options;

    // 获取最大 queue_position
    const allTasks = this.db.getAllRequirements({ limit: 1 });
    const maxPosition = allTasks.reduce(
      (max: number, t: RequirementData) => Math.max(max, t.queuePosition ?? 0),
      0,
    );

    return this.db.createRequirement({
      id: taskId,
      description: prompt,
      parentId: requirementId,
      executorType,
      priority,
      projectId,
      executorConfig,
      metadata: { prompt },
    });
  }

  /**
   * 在指定位置插入任务
   */
  insertTask(options: PublishTaskOptions & { position: number }): RequirementData {
    const req = this.publishTask(options);
    this.reorderByPosition(req.id, options.position);
    return this.db.getRequirement(req.id)!;
  }

  /**
   * 列出队列中的任务
   */
  listQueue(filter?: {
    status?: RequirementStatus;
    executorType?: ExecutorType;
    limit?: number;
  }): RequirementData[] {
    return this.db.getAllRequirements(filter);
  }

  /**
   * 获取下一个待执行任务
   */
  getNextTask(): RequirementData | undefined {
    const tasks = this.db.getAllRequirements({ status: "pending", limit: 1 });
    return tasks[0];
  }

  /**
   * 根据 ID 获取任务
   */
  getTask(taskId: string): RequirementData | undefined {
    return this.db.getRequirement(taskId);
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    taskId: string,
    status: RequirementStatus,
    result?: Record<string, unknown>,
    error?: string,
    executionTime?: number,
  ): RequirementData | undefined {
    const updates: Partial<RequirementData> = {};

    if (result) updates.executionResult = result;
    if (error) updates.executionError = error;
    if (executionTime != null) updates.executionTimeSeconds = executionTime;

    if (Object.keys(updates).length > 0) {
      this.db.updateRequirement(taskId, updates);
    }

    return this.db.updateRequirementStatus(taskId, status);
  }

  /**
   * 更新任务属性
   */
  updateTask(
    taskId: string,
    data: {
      executorType?: ExecutorType;
      status?: RequirementStatus;
      priority?: Priority;
      description?: string;
    },
  ): RequirementData | undefined {
    const updates: Partial<RequirementData> = {};
    if (data.executorType) updates.executorType = data.executorType;
    if (data.priority) updates.priority = data.priority;
    if (data.description) updates.description = data.description;

    this.db.updateRequirement(taskId, updates);

    if (data.status) {
      this.db.updateRequirementStatus(taskId, data.status);
    }

    return this.db.getRequirement(taskId);
  }

  /**
   * 按位置重排序任务
   */
  reorderByPosition(taskId: string, newPosition: number): RequirementData | undefined {
    return this.db.updateRequirement(taskId, { queuePosition: newPosition });
  }

  /**
   * 删除任务
   */
  removeTask(taskId: string): boolean {
    return this.db.deleteRequirement(taskId);
  }

  /**
   * 批量删除任务
   */
  batchRemove(taskIds: string[]): number {
    let removed = 0;
    for (const id of taskIds) {
      if (this.db.deleteRequirement(id)) removed++;
    }
    return removed;
  }

  /**
   * 清除已完成任务
   */
  clearCompleted(): number {
    const completed = this.db.getAllRequirements({ status: "completed" });
    return this.batchRemove(completed.map((t: RequirementData) => t.id));
  }

  /**
   * 获取队列统计
   */
  getQueueStats(projectId?: string): QueueStats {
    const stats = this.db.getStats(projectId);
    return {
      total: stats.total,
      pending: stats.pending,
      inProgress: stats.inProgress,
      completed: stats.completed,
      failed: stats.failed,
      cancelled: 0,
    };
  }
}
