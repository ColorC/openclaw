/**
 * Task Converter — Checklist ↔ TaskData ↔ PM RequirementData 互转
 *
 * 功能:
 * 1. Checklist 文本行解析 → TaskData
 * 2. TaskData ↔ PMDatabase RequirementData 格式转换
 * 3. 数据验证和规范化
 * 4. PARSABLE 格式导出
 *
 * 源码参考: _personal_copilot/src/services/pm/task_converter.py
 *          _personal_copilot/src/models/task_data_model.py
 */

// ============================================================================
// 常量
// ============================================================================

export const VALID_STATUSES = ["pending", "in_progress", "completed", "failed", "blocked"] as const;
export type TaskStatus = (typeof VALID_STATUSES)[number];

export const VALID_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type TaskPriority = (typeof VALID_PRIORITIES)[number];

export const VALID_CATEGORIES = [
  "feature",
  "bug",
  "infrastructure",
  "documentation",
  "epic",
  "task",
] as const;
export type TaskCategory = (typeof VALID_CATEGORIES)[number];

export const VALID_ESTIMATE_UNITS = ["hours", "story_points", "days"] as const;
export type EstimateUnit = (typeof VALID_ESTIMATE_UNITS)[number];

/** 状态 → emoji */
export const STATUS_EMOJI_MAP: Record<TaskStatus, string> = {
  completed: "✅",
  in_progress: "🚀",
  pending: "⏸️",
  failed: "❌",
  blocked: "⏰",
};

/** emoji → 状态 */
export const EMOJI_STATUS_MAP: Record<string, TaskStatus> = {
  "✅": "completed",
  "🚀": "in_progress",
  "⏸️": "pending",
  "❌": "failed",
  "⏰": "blocked",
};

export const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

// ============================================================================
// TaskData 中间数据模型
// ============================================================================

export interface TaskData {
  taskId: string;
  topic?: string;
  description: string;
  background?: string;
  comment?: string;
  isParent?: boolean;
  filePath?: string;
  commitMessage?: string;
  sourceFile?: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  dependencies: string[];
  parentTaskId?: string;
  tags: string[];
  estimate: number;
  estimateUnit: EstimateUnit;
  actualEffort: number;
  reporter: string;
  assignedAgent?: string;
  dueDate?: string;
  blockedReason?: string;
  acceptanceCriteria: string[];
  verification?: string;
  metadata: Record<string, unknown>;
}

export function createDefaultTask(taskId: string, description: string): TaskData {
  return {
    taskId,
    description,
    status: "pending",
    priority: "medium",
    category: "task",
    dependencies: [],
    tags: [],
    estimate: 0,
    estimateUnit: "hours",
    actualEffort: 0,
    reporter: "system",
    acceptanceCriteria: [],
    metadata: {},
  };
}

// ============================================================================
// 验证
// ============================================================================

export function isValidStatus(s: string): s is TaskStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}
export function isValidPriority(p: string): p is TaskPriority {
  return (VALID_PRIORITIES as readonly string[]).includes(p);
}
export function isValidCategory(c: string): c is TaskCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(c);
}
export function isValidEstimateUnit(u: string): u is EstimateUnit {
  return (VALID_ESTIMATE_UNITS as readonly string[]).includes(u);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTaskData(task: Partial<TaskData>): ValidationResult {
  const errors: string[] = [];
  if (!task.taskId) errors.push("缺少必需字段: taskId");
  if (!task.description) errors.push("缺少必需字段: description");
  if (task.status && !isValidStatus(task.status)) {
    errors.push(`无效的状态: ${task.status}，必须是 ${VALID_STATUSES.join("/")} 之一`);
  }
  if (task.priority && !isValidPriority(task.priority)) {
    errors.push(`无效的优先级: ${task.priority}，必须是 ${VALID_PRIORITIES.join("/")} 之一`);
  }
  if (task.category && !isValidCategory(task.category)) {
    errors.push(`无效的类别: ${task.category}，必须是 ${VALID_CATEGORIES.join("/")} 之一`);
  }
  if (task.estimateUnit && !isValidEstimateUnit(task.estimateUnit)) {
    errors.push(
      `无效的估算单位: ${task.estimateUnit}，必须是 ${VALID_ESTIMATE_UNITS.join("/")} 之一`,
    );
  }
  if (task.estimate !== undefined && task.estimate < 0) {
    errors.push(`estimate 必须 >= 0，当前值: ${task.estimate}`);
  }
  if (task.actualEffort !== undefined && task.actualEffort < 0) {
    errors.push(`actualEffort 必须 >= 0，当前值: ${task.actualEffort}`);
  }
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Checklist 解析
// ============================================================================

/**
 * 解析 checklist 格式的任务行
 *
 * 格式: `- ✅ P4-01: 实现CoderWorkflow重构 (priority: high, depends: P3-05)`
 */
export function parseChecklistLine(line: string): TaskData | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return undefined;

  let content = trimmed.slice(2).trim();

  // 解析状态 emoji
  let status: TaskStatus = "pending";
  for (const [emoji, st] of Object.entries(EMOJI_STATUS_MAP)) {
    if (content.startsWith(emoji)) {
      status = st;
      content = content.slice(emoji.length).trim();
      break;
    }
  }

  // 解析 task_id 和 description
  let taskId: string | undefined;
  let description = content;

  const idMatch = content.match(/^([\w\-.]+):\s*(.+)$/);
  if (idMatch) {
    taskId = idMatch[1];
    description = idMatch[2];
  }

  // 解析元数据 (括号内的 key: value)
  const metaMatch = description.match(/\(([^)]+)\)$/);
  let metadata: Record<string, string> = {};
  if (metaMatch) {
    description = description.slice(0, metaMatch.index).trim();
    metadata = parseMetadata(metaMatch[1]);
  }

  if (!taskId) {
    taskId = description.slice(0, 20).replace(/\s/g, "_");
  }

  const task = createDefaultTask(taskId, description);
  task.status = status;

  if (metadata.priority && isValidPriority(metadata.priority)) {
    task.priority = metadata.priority;
  }
  if (metadata.depends) {
    task.dependencies = metadata.depends.split(",").map((d) => d.trim());
  }
  if (metadata.tags) {
    task.tags = metadata.tags.split(",").map((t) => t.trim());
  }
  if (metadata.estimate) {
    const [est, unit] = parseEstimate(metadata.estimate);
    task.estimate = est;
    task.estimateUnit = unit;
  }
  if (metadata.blocked) {
    task.status = "blocked";
    task.blockedReason = metadata.blocked;
  }
  if (metadata.category && isValidCategory(metadata.category)) {
    task.category = metadata.category;
  }
  if (metadata.reporter) task.reporter = metadata.reporter;
  if (metadata.assigned) task.assignedAgent = metadata.assigned;

  return task;
}

/** 解析元数据字符串 `"key1: value1, key2: value2"` */
function parseMetadata(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+):\s*([^:]+?)(?=\s*,\s*\w+:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    result[m[1].trim()] = m[2].trim().replace(/,$/, "");
  }
  return result;
}

/** 解析工作量估算，如 `"8h"` → `[8, 'hours']` */
function parseEstimate(str: string): [number, EstimateUnit] {
  const m = str.match(/([\d.]+)\s*([a-zA-Z]*)/);
  if (!m) return [0, "hours"];
  const value = parseFloat(m[1]);
  const abbr = m[2].toLowerCase();
  if (["d", "day", "days"].includes(abbr)) return [value, "days"];
  if (["sp", "story_points", "points"].includes(abbr)) return [value, "story_points"];
  return [value, "hours"];
}

/**
 * 批量解析 checklist 文本内容
 *
 * 逐行解析，忽略非任务行。
 */
export function parseChecklistContent(content: string): TaskData[] {
  return content
    .split("\n")
    .map(parseChecklistLine)
    .filter((t): t is TaskData => t !== undefined);
}

// ============================================================================
// PARSABLE 格式解析
// ============================================================================

/**
 * 解析 PARSABLE 格式文档内容
 *
 * 格式: `- [x] [TASK-ID] 任务主题`，下级子项为 `  - **文件**: ...` 等
 */
export function parseParsableContent(content: string): TaskData[] {
  const tasks: TaskData[] = [];
  const lines = content.split("\n");
  let current: TaskData | undefined;
  let currentField: string | undefined;
  let fieldLines: string[] = [];
  let taskCounter = 1;
  const parentStack: Record<number, string> = {};

  const taskRe = /^(\s*)- \[([xX ])\] \[([A-Z0-9-]+)\] (.+)$/;
  const simpleRe = /^(\s*)- \[([xX ])\] (.+)$/;
  const fieldPatterns: Record<string, RegExp> = {
    filePath: /^\s+- \*\*文件\*\*[：:]\s*(.+)$/,
    commitMessage: /^\s+- \*\*Commit\*\*[：:]\s*(.+)$/,
    estimate: /^\s+- \*\*预计\*\*[：:]\s*([\d.]+)\s*小时/,
    dependencies: /^\s+- \*\*依赖\*\*[：:]\s*(.+)$/,
    description: /^\s+- \*\*描述\*\*[：:]\s*(.+)$/,
    background: /^\s+- \*\*背景\*\*[：:]\s*(.+)$/,
    comment: /^\s+- \*\*备注\*\*[：:]\s*(.+)$/,
    verification: /^\s+- \*\*验证\*\*[：:]\s*(.+)$/,
    priority: /^\s+- \*\*优先级\*\*[：:]\s*(P[0-3]|high|medium|low|critical)$/,
    tags: /^\s+- \*\*标签\*\*[：:]\s*(.+)$/,
  };

  const multilineFields = new Set(["description", "background", "comment", "verification"]);

  function saveMultilineField() {
    if (current && currentField && fieldLines.length > 0) {
      const val = fieldLines.join("\n");
      if (currentField === "description") current.description = val;
      else if (currentField === "background") current.background = val;
      else if (currentField === "comment") current.comment = val;
      else if (currentField === "verification") current.verification = val;
    }
    currentField = undefined;
    fieldLines = [];
  }

  function finishTask() {
    saveMultilineField();
    if (current) tasks.push(current);
    current = undefined;
  }

  for (const line of lines) {
    // 标准任务行: `- [x] [TASK-ID] topic`
    let tm = line.match(taskRe);
    if (tm) {
      finishTask();
      const indent = Math.floor(tm[1].length / 2);
      const status: TaskStatus = tm[2].toLowerCase() === "x" ? "completed" : "pending";
      const taskId = tm[3];
      current = createDefaultTask(taskId, tm[4].trim());
      current.status = status;
      if (indent > 0) current.parentTaskId = parentStack[indent - 1] ?? undefined;
      parentStack[indent] = taskId;
      // 清理比当前层级深的 parent
      for (const k of Object.keys(parentStack)) {
        if (Number(k) > indent) delete parentStack[Number(k)];
      }
      continue;
    }

    // 简单任务行: `- [ ] 任务描述`
    const sm = line.match(simpleRe);
    if (sm) {
      finishTask();
      const indent = Math.floor(sm[1].length / 2);
      const status: TaskStatus = sm[2].toLowerCase() === "x" ? "completed" : "pending";
      const topic = sm[3].trim();
      const taskId =
        topic.length >= 10
          ? topic.slice(0, 20).replace(/[\s:*]/g, "_")
          : `TASK-${String(taskCounter++).padStart(3, "0")}`;
      current = createDefaultTask(taskId, topic);
      current.status = status;
      if (indent > 0) current.parentTaskId = parentStack[indent - 1] ?? undefined;
      parentStack[indent] = taskId;
      for (const k of Object.keys(parentStack)) {
        if (Number(k) > indent) delete parentStack[Number(k)];
      }
      continue;
    }

    if (!current) continue;

    // 单值字段匹配
    let matched = false;
    for (const [field, re] of Object.entries(fieldPatterns)) {
      const fm = line.match(re);
      if (!fm) continue;
      saveMultilineField();
      matched = true;
      const val = fm[1].trim();
      switch (field) {
        case "filePath":
          current.filePath = val;
          break;
        case "commitMessage":
          current.commitMessage = val;
          break;
        case "estimate":
          current.estimate = parseFloat(val);
          current.estimateUnit = "hours";
          break;
        case "dependencies":
          current.dependencies = val.split(",").map((d) => d.trim());
          break;
        case "priority": {
          const pMap: Record<string, TaskPriority> = {
            P0: "critical",
            P1: "high",
            P2: "medium",
            P3: "low",
          };
          current.priority = pMap[val] ?? (isValidPriority(val) ? val : "medium");
          break;
        }
        case "tags":
          current.tags = val
            .replace(/#/g, ",")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          break;
        default:
          // 多行字段开始
          if (multilineFields.has(field)) {
            currentField = field;
            fieldLines = [val];
          }
      }
      break;
    }

    if (matched) continue;

    // 多行字段续行
    if (currentField && line.trim() && !line.trim().startsWith("- **") && /^\s{4,}/.test(line)) {
      fieldLines.push(line.trim());
    }
  }

  finishTask();
  return tasks;
}

// ============================================================================
// PM 格式转换
// ============================================================================

export interface PmImportData {
  taskId: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  dependencies: string[];
  estimate: number;
  estimateUnit: EstimateUnit;
  tags: string[];
  parentId?: string;
  reporter: string;
  assignedAgent?: string;
  dueDate?: string;
  blockedReason?: string;
  acceptanceCriteria: string[];
  metadata: Record<string, unknown>;
}

/**
 * TaskData → PM 数据库导入格式（零信息损失）
 */
export function convertTaskToPmFormat(task: TaskData): PmImportData {
  const tags = [...task.tags];
  if (task.taskId && !tags.includes(task.taskId)) {
    tags.unshift(task.taskId);
  }

  // 保存完整元数据
  const meta: Record<string, unknown> = { ...task.metadata };
  if (task.topic) meta.topic = task.topic;
  if (task.background) meta.background = task.background;
  if (task.comment) meta.comment = task.comment;
  if (task.filePath) meta.filePath = task.filePath;
  if (task.commitMessage) meta.commitMessage = task.commitMessage;
  if (task.sourceFile) meta.sourceDocument = task.sourceFile;
  if (task.verification) meta.verification = task.verification;
  if (task.isParent) meta.isParent = task.isParent;
  if (task.dependencies.length > 0) meta.dependencies = task.dependencies;

  return {
    taskId: task.taskId,
    description: task.topic || task.description || task.taskId,
    status: task.status,
    priority: task.priority,
    category: task.category,
    dependencies: task.dependencies,
    estimate: task.estimate,
    estimateUnit: task.estimateUnit,
    tags,
    parentId: task.parentTaskId,
    reporter: task.reporter,
    assignedAgent: task.assignedAgent,
    dueDate: task.dueDate,
    blockedReason: task.blockedReason,
    acceptanceCriteria: task.acceptanceCriteria,
    metadata: meta,
  };
}

export function convertTasksToPmBatch(tasks: TaskData[]): PmImportData[] {
  return tasks.map(convertTaskToPmFormat);
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * TaskData → checklist 行
 *
 * 例: `- ✅ P4-01: 实现CoderWorkflow重构 (priority: high, depends: P3-05)`
 */
export function formatTaskAsChecklistLine(task: TaskData): string {
  const emoji = STATUS_EMOJI_MAP[task.status] ?? "⏸️";
  let line = `- ${emoji} ${task.taskId}: ${task.description}`;

  const parts: string[] = [];
  if (task.priority !== "medium") parts.push(`priority: ${task.priority}`);
  if (task.dependencies.length > 0) parts.push(`depends: ${task.dependencies.join(",")}`);
  if (task.tags.length > 0) parts.push(`tags: ${task.tags.join(",")}`);
  if (task.estimate > 0) {
    const unitAbbr: Record<EstimateUnit, string> = { hours: "h", days: "d", story_points: "sp" };
    parts.push(`estimate: ${task.estimate}${unitAbbr[task.estimateUnit]}`);
  }
  if (task.blockedReason) parts.push(`blocked: ${task.blockedReason}`);

  if (parts.length > 0) line += ` (${parts.join(", ")})`;
  return line;
}

/**
 * TaskData → PARSABLE 格式块
 */
export function formatTaskAsParsableBlock(task: TaskData, indentLevel = 0): string {
  const indent = "  ".repeat(indentLevel);
  const checkbox = task.status === "completed" ? "[x]" : "[ ]";
  const topic = task.topic || task.description;
  const lines = [`${indent}- ${checkbox} [${task.taskId}] ${topic}`];

  if (task.filePath) lines.push(`  - **文件**: ${task.filePath}`);
  if (task.commitMessage) lines.push(`  - **Commit**: ${task.commitMessage}`);
  if (task.estimate > 0) lines.push(`  - **预计**: ${task.estimate}小时`);
  if (task.dependencies.length > 0) lines.push(`  - **依赖**: ${task.dependencies.join(", ")}`);
  if (task.priority !== "medium") {
    const pMap: Record<TaskPriority, string> = {
      critical: "P0",
      high: "P1",
      medium: "P2",
      low: "P3",
    };
    lines.push(`  - **优先级**: ${pMap[task.priority]}`);
  }
  const displayTags = task.tags.filter((t) => t !== task.taskId);
  if (displayTags.length > 0) lines.push(`  - **标签**: ${displayTags.join(", ")}`);
  if (task.background) lines.push(`  - **背景**: ${task.background}`);
  if (task.verification) lines.push(`  - **验证**: ${task.verification}`);
  if (task.comment) lines.push(`  - **备注**: ${task.comment}`);

  return lines.join("\n");
}

/**
 * 导出任务列表为 PARSABLE 格式文档
 */
export function exportTasksToParsableDocument(tasks: TaskData[], title = "计划文档"): string {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const totalEstimate = tasks.reduce((s, t) => s + t.estimate, 0);
  const now = new Date().toISOString().slice(0, 10);

  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  function getIndent(task: TaskData): number {
    if (!task.parentTaskId) return 0;
    const parent = taskMap.get(task.parentTaskId);
    return parent ? 1 + getIndent(parent) : 0;
  }

  const header = [
    `# ${title}`,
    "",
    `**创建时间**: ${now}`,
    `**状态**: ${completed === total ? "done" : "current"}`,
    `**总任务数**: ${total}`,
    `**预计工作量**: ${(totalEstimate / 8).toFixed(1)}人日`,
    "",
    "---",
    "",
    "## 任务清单",
    "",
  ];

  const body = tasks.map((t) => formatTaskAsParsableBlock(t, getIndent(t)));

  return [...header, ...body, "", "---", `**文档版本**: PARSABLE v1.0 | **导出时间**: ${now}`].join(
    "\n",
  );
}
