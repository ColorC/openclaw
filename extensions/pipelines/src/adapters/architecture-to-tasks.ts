/**
 * 架构设计 → 任务队列适配器
 *
 * ModuleDefinition[] + InterfaceDefinition[] → PublishTaskOptions[]
 */

import type { PMDatabase, RequirementData, Priority, ExecutorType } from "../pm/database.js";
import type { PublishTaskOptions } from "../pm/task-queue-manager.js";
import type { TaskQueueManager } from "../pm/task-queue-manager.js";
import type { ModuleDefinition, InterfaceDefinition } from "../workflows/states.js";

export interface TaskGenerationOptions {
  requirementId: string;
  projectId?: string;
  defaultPriority?: Priority;
  executorType?: ExecutorType;
}

/** 从单个 module 生成任务 */
export function moduleToTask(
  mod: ModuleDefinition,
  index: number,
  opts: TaskGenerationOptions,
): PublishTaskOptions {
  return {
    taskId: `task-mod-${mod.id || index}`,
    prompt: `Implement module "${mod.name}": ${mod.description}\n\nResponsibilities:\n${mod.responsibilities.map((r) => `- ${r}`).join("\n")}`,
    executorType: opts.executorType ?? "claude_code",
    priority: opts.defaultPriority ?? "medium",
    requirementId: opts.requirementId,
    projectId: opts.projectId,
  };
}

/** 从 interface 的 methods 生成任务 */
export function interfaceToTasks(
  iface: InterfaceDefinition,
  opts: TaskGenerationOptions,
): PublishTaskOptions[] {
  return iface.methods.map((method, i) => ({
    taskId: `task-iface-${iface.id}-${i}`,
    prompt: `Implement ${iface.type} interface "${iface.name}.${method.name}"\nInput: ${method.input}\nOutput: ${method.output}\nDescription: ${method.description}`,
    executorType: opts.executorType ?? "claude_code",
    priority: opts.defaultPriority ?? "medium",
    requirementId: opts.requirementId,
    projectId: opts.projectId,
  }));
}

/** 从架构设计输出生成全部任务 */
export function modulesToTasks(
  modules: ModuleDefinition[],
  interfaces: InterfaceDefinition[],
  opts: TaskGenerationOptions,
): PublishTaskOptions[] {
  const moduleTasks = modules.map((mod, i) => moduleToTask(mod, i, opts));
  const ifaceTasks = interfaces.flatMap((iface) => interfaceToTasks(iface, opts));
  return [...moduleTasks, ...ifaceTasks];
}

/** 生成并发布全部任务到队列 */
export function publishArchitectureTasks(
  queue: TaskQueueManager,
  modules: ModuleDefinition[],
  interfaces: InterfaceDefinition[],
  opts: TaskGenerationOptions,
): RequirementData[] {
  const tasks = modulesToTasks(modules, interfaces, opts);
  return tasks.map((t) => queue.publishTask(t));
}
