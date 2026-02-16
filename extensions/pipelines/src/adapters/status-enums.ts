/**
 * 状态枚举映射
 *
 * TaskStatus (task-converter, 5 值) ↔ RequirementStatus (database, 7 值)
 */

import type { RequirementStatus } from "../pm/database.js";
import type { TaskStatus } from "../pm/task-converter.js";

/** TaskStatus → RequirementStatus（直接子集映射） */
export function taskStatusToRequirementStatus(ts: TaskStatus): RequirementStatus {
  return ts; // TaskStatus 是 RequirementStatus 的子集
}

/** RequirementStatus → TaskStatus */
export function requirementStatusToTaskStatus(rs: RequirementStatus): TaskStatus {
  switch (rs) {
    case "argued":
      return "blocked";
    case "cancelled":
      return "failed";
    default:
      return rs as TaskStatus;
  }
}

/** 是否为终态 */
export function isTerminalStatus(status: RequirementStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** 是否需要人工干预 */
export function needsIntervention(status: RequirementStatus): boolean {
  return status === "argued" || status === "blocked";
}
