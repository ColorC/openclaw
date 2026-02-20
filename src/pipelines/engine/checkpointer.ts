/**
 * SQLite Checkpointer 适配层
 *
 * 基于 @langchain/langgraph-checkpoint-sqlite，提供工作流状态持久化。
 * 对应 Python 版的 PostgresSaver，但使用 SQLite 作为存储后端。
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Checkpointer 配置
 */
export interface CheckpointerConfig {
  /** 数据库文件路径（绝对路径或相对于 workspace） */
  dbPath: string;
  /** 是否自动创建父目录 */
  createDir?: boolean;
}

/**
 * Checkpointer 管理器
 *
 * 管理 checkpointer 实例的生命周期，支持按 thread_id 隔离。
 */
export class CheckpointerManager {
  private static instances: Map<string, SqliteSaver> = new Map();

  /**
   * 获取或创建 checkpointer 实例
   *
   * @param config - 配置
   * @returns SqliteSaver 实例
   */
  static getCheckpointer(config: CheckpointerConfig): BaseCheckpointSaver {
    const { dbPath, createDir = true } = config;

    // 复用已有实例
    if (this.instances.has(dbPath)) {
      return this.instances.get(dbPath)!;
    }

    // 确保目录存在
    if (createDir) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // 创建 checkpointer（SqliteSaver 内部管理数据库连接）
    const checkpointer = SqliteSaver.fromConnString(dbPath);
    this.instances.set(dbPath, checkpointer);

    return checkpointer;
  }

  /**
   * 关闭指定路径的 checkpointer
   */
  static close(dbPath: string): void {
    this.instances.delete(dbPath);
  }

  /**
   * 关闭所有 checkpointer
   */
  static closeAll(): void {
    this.instances.clear();
  }
}

/**
 * 创建默认 checkpointer
 *
 * @param workspacePath - workspace 根路径
 * @param checkpointPath - checkpoint 相对路径（默认 .pipelines/checkpoints）
 */
export function createDefaultCheckpointer(
  workspacePath: string,
  checkpointPath: string = ".pipelines/checkpoints/checkpoints.db",
): BaseCheckpointSaver {
  const dbPath = path.join(workspacePath, checkpointPath);
  return CheckpointerManager.getCheckpointer({ dbPath });
}
