/**
 * TaskConverter 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  parseChecklistLine,
  parseChecklistContent,
  parseParsableContent,
  validateTaskData,
  convertTaskToPmFormat,
  convertTasksToPmBatch,
  formatTaskAsChecklistLine,
  formatTaskAsParsableBlock,
  exportTasksToParsableDocument,
  createDefaultTask,
  isValidStatus,
  isValidPriority,
  isValidCategory,
  isValidEstimateUnit,
  STATUS_EMOJI_MAP,
  EMOJI_STATUS_MAP,
  PRIORITY_WEIGHTS,
} from "./task-converter.js";

describe("TaskConverter", () => {
  describe("Constants", () => {
    it("STATUS_EMOJI_MAP and EMOJI_STATUS_MAP are consistent", () => {
      for (const [status, emoji] of Object.entries(STATUS_EMOJI_MAP)) {
        expect(EMOJI_STATUS_MAP[emoji]).toBe(status);
      }
    });

    it("PRIORITY_WEIGHTS orders correctly", () => {
      expect(PRIORITY_WEIGHTS.critical).toBeLessThan(PRIORITY_WEIGHTS.high);
      expect(PRIORITY_WEIGHTS.high).toBeLessThan(PRIORITY_WEIGHTS.medium);
      expect(PRIORITY_WEIGHTS.medium).toBeLessThan(PRIORITY_WEIGHTS.low);
    });
  });

  describe("Validators", () => {
    it("validates status", () => {
      expect(isValidStatus("pending")).toBe(true);
      expect(isValidStatus("in_progress")).toBe(true);
      expect(isValidStatus("invalid")).toBe(false);
    });

    it("validates priority", () => {
      expect(isValidPriority("high")).toBe(true);
      expect(isValidPriority("urgent")).toBe(false);
    });

    it("validates category", () => {
      expect(isValidCategory("feature")).toBe(true);
      expect(isValidCategory("random")).toBe(false);
    });

    it("validates estimate unit", () => {
      expect(isValidEstimateUnit("hours")).toBe(true);
      expect(isValidEstimateUnit("weeks")).toBe(false);
    });
  });

  describe("createDefaultTask", () => {
    it("creates task with defaults", () => {
      const task = createDefaultTask("t1", "My task");
      expect(task.taskId).toBe("t1");
      expect(task.description).toBe("My task");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("medium");
      expect(task.category).toBe("task");
      expect(task.dependencies).toEqual([]);
      expect(task.tags).toEqual([]);
      expect(task.estimate).toBe(0);
    });
  });

  describe("validateTaskData", () => {
    it("passes for valid task", () => {
      const task = createDefaultTask("t1", "Valid task");
      const result = validateTaskData(task);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails for missing fields", () => {
      const result = validateTaskData({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("缺少必需字段: taskId");
      expect(result.errors).toContain("缺少必需字段: description");
    });

    it("fails for invalid status", () => {
      const result = validateTaskData({ taskId: "t1", description: "x", status: "magic" as any });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("无效的状态");
    });

    it("fails for negative estimate", () => {
      const result = validateTaskData({ taskId: "t1", description: "x", estimate: -5 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("estimate");
    });
  });

  describe("parseChecklistLine", () => {
    it("parses a full checklist line", () => {
      const line = "- ✅ P4-01: 实现CoderWorkflow重构 (priority: high, depends: P3-05)";
      const task = parseChecklistLine(line);
      expect(task).toBeDefined();
      expect(task!.taskId).toBe("P4-01");
      expect(task!.status).toBe("completed");
      expect(task!.description).toBe("实现CoderWorkflow重构");
      expect(task!.priority).toBe("high");
      expect(task!.dependencies).toEqual(["P3-05"]);
    });

    it("parses in_progress status", () => {
      const task = parseChecklistLine("- 🚀 TASK-01: 进行中的任务");
      expect(task?.status).toBe("in_progress");
    });

    it("parses pending (default) status", () => {
      const task = parseChecklistLine("- ⏸️ TASK-02: 待办任务");
      expect(task?.status).toBe("pending");
    });

    it("parses blocked status via metadata", () => {
      const task = parseChecklistLine("- ⏸️ T1: 被阻塞 (blocked: 等待依赖)");
      expect(task?.status).toBe("blocked");
      expect(task?.blockedReason).toBe("等待依赖");
    });

    it("parses tags and estimate", () => {
      const task = parseChecklistLine("- ⏸️ T1: 任务 (tags: api,backend, estimate: 4h)");
      expect(task?.tags).toEqual(["api", "backend"]);
      expect(task?.estimate).toBe(4);
      expect(task?.estimateUnit).toBe("hours");
    });

    it("parses estimate with days unit", () => {
      const task = parseChecklistLine("- ⏸️ T1: 任务 (estimate: 3d)");
      expect(task?.estimate).toBe(3);
      expect(task?.estimateUnit).toBe("days");
    });

    it("generates task ID from description if missing", () => {
      const task = parseChecklistLine("- ✅ 这是一个没有ID的任务");
      expect(task?.taskId).toBeDefined();
      expect(task?.taskId.length).toBeGreaterThan(0);
    });

    it("returns undefined for non-task lines", () => {
      expect(parseChecklistLine("普通文本")).toBeUndefined();
      expect(parseChecklistLine("# 标题")).toBeUndefined();
      expect(parseChecklistLine("")).toBeUndefined();
    });
  });

  describe("parseChecklistContent", () => {
    it("parses multiple lines", () => {
      const content = `# 任务列表
- ✅ T1: 任务一
- 🚀 T2: 任务二
普通文本行
- ⏸️ T3: 任务三`;
      const tasks = parseChecklistContent(content);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].taskId).toBe("T1");
      expect(tasks[1].status).toBe("in_progress");
      expect(tasks[2].status).toBe("pending");
    });
  });

  describe("parseParsableContent", () => {
    it("parses standard PARSABLE format", () => {
      const content = `## 任务清单

- [ ] [REQ-001] 实现用户认证
  - **文件**: src/auth/login.ts
  - **预计**: 8小时
  - **优先级**: P1
  - **依赖**: REQ-000
- [x] [REQ-002] 编写API文档
  - **标签**: docs, api`;

      const tasks = parseParsableContent(content);
      expect(tasks).toHaveLength(2);

      expect(tasks[0].taskId).toBe("REQ-001");
      expect(tasks[0].status).toBe("pending");
      expect(tasks[0].filePath).toBe("src/auth/login.ts");
      expect(tasks[0].estimate).toBe(8);
      expect(tasks[0].priority).toBe("high");
      expect(tasks[0].dependencies).toEqual(["REQ-000"]);

      expect(tasks[1].taskId).toBe("REQ-002");
      expect(tasks[1].status).toBe("completed");
      expect(tasks[1].tags).toEqual(["docs", "api"]);
    });

    it("handles hierarchical tasks", () => {
      const content = `- [ ] [PARENT] 父任务
  - [ ] [CHILD-1] 子任务1
  - [ ] [CHILD-2] 子任务2`;

      const tasks = parseParsableContent(content);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].parentTaskId).toBeUndefined();
      expect(tasks[1].parentTaskId).toBe("PARENT");
      expect(tasks[2].parentTaskId).toBe("PARENT");
    });

    it("handles simple checkbox format", () => {
      const content = `- [ ] 这是一个简单的任务描述
- [x] 另一个完成的任务`;

      const tasks = parseParsableContent(content);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe("pending");
      expect(tasks[1].status).toBe("completed");
    });
  });

  describe("convertTaskToPmFormat", () => {
    it("converts with zero info loss", () => {
      const task = createDefaultTask("T1", "实现功能");
      task.topic = "功能主题";
      task.priority = "high";
      task.dependencies = ["T0"];
      task.tags = ["backend"];
      task.filePath = "src/foo.ts";

      const pm = convertTaskToPmFormat(task);
      expect(pm.taskId).toBe("T1");
      expect(pm.description).toBe("功能主题"); // topic 优先
      expect(pm.priority).toBe("high");
      expect(pm.dependencies).toEqual(["T0"]);
      expect(pm.tags).toEqual(["T1", "backend"]); // taskId 自动加入 tags
      expect(pm.metadata.filePath).toBe("src/foo.ts");
      expect(pm.metadata.topic).toBe("功能主题");
      expect(pm.metadata.dependencies).toEqual(["T0"]);
    });

    it("batch converts", () => {
      const tasks = [createDefaultTask("T1", "A"), createDefaultTask("T2", "B")];
      const batch = convertTasksToPmBatch(tasks);
      expect(batch).toHaveLength(2);
      expect(batch[0].taskId).toBe("T1");
      expect(batch[1].taskId).toBe("T2");
    });
  });

  describe("formatTaskAsChecklistLine", () => {
    it("formats a basic task", () => {
      const task = createDefaultTask("T1", "基本任务");
      const line = formatTaskAsChecklistLine(task);
      expect(line).toBe("- ⏸️ T1: 基本任务");
    });

    it("formats a completed high priority task", () => {
      const task = createDefaultTask("T1", "重要任务");
      task.status = "completed";
      task.priority = "high";
      const line = formatTaskAsChecklistLine(task);
      expect(line).toContain("✅");
      expect(line).toContain("priority: high");
    });

    it("includes dependencies and tags", () => {
      const task = createDefaultTask("T1", "任务");
      task.dependencies = ["T0", "T2"];
      task.tags = ["api"];
      task.estimate = 8;
      const line = formatTaskAsChecklistLine(task);
      expect(line).toContain("depends: T0,T2");
      expect(line).toContain("tags: api");
      expect(line).toContain("estimate: 8h");
    });

    it("omits medium priority", () => {
      const task = createDefaultTask("T1", "任务");
      const line = formatTaskAsChecklistLine(task);
      expect(line).not.toContain("priority");
    });
  });

  describe("formatTaskAsParsableBlock", () => {
    it("formats a PARSABLE block", () => {
      const task = createDefaultTask("REQ-001", "用户认证");
      task.filePath = "src/auth.ts";
      task.estimate = 4;
      task.priority = "high";

      const block = formatTaskAsParsableBlock(task);
      expect(block).toContain("- [ ] [REQ-001] 用户认证");
      expect(block).toContain("**文件**: src/auth.ts");
      expect(block).toContain("**预计**: 4小时");
      expect(block).toContain("**优先级**: P1");
    });

    it("uses [x] for completed", () => {
      const task = createDefaultTask("T1", "Done");
      task.status = "completed";
      expect(formatTaskAsParsableBlock(task)).toContain("[x]");
    });
  });

  describe("exportTasksToParsableDocument", () => {
    it("generates a full document", () => {
      const tasks = [
        createDefaultTask("T1", "父任务"),
        { ...createDefaultTask("T2", "子任务"), parentTaskId: "T1" },
      ];
      tasks[0].status = "completed";
      tasks[0].estimate = 8;

      const doc = exportTasksToParsableDocument(tasks, "测试计划");
      expect(doc).toContain("# 测试计划");
      expect(doc).toContain("**总任务数**: 2");
      expect(doc).toContain("[T1]");
      expect(doc).toContain("[T2]");
      expect(doc).toContain("PARSABLE v1.0");
    });
  });

  describe("Roundtrip", () => {
    it("checklist → parse → format → parse roundtrip", () => {
      const original = "- ✅ TASK-01: 完成的任务 (priority: high, depends: TASK-00, tags: core)";
      const parsed = parseChecklistLine(original)!;
      const formatted = formatTaskAsChecklistLine(parsed);
      const reparsed = parseChecklistLine(formatted)!;

      expect(reparsed.taskId).toBe(parsed.taskId);
      expect(reparsed.status).toBe(parsed.status);
      expect(reparsed.priority).toBe(parsed.priority);
      expect(reparsed.dependencies).toEqual(parsed.dependencies);
      expect(reparsed.tags).toEqual(parsed.tags);
    });
  });
});
