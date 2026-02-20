/**
 * Argue 管理器 (Argue Manager)
 *
 * Agent 间争议协商机制：Argue → Argue-Back → 仲裁。
 * 不依赖 LLM，纯逻辑实现；LLM 评估通过依赖注入。
 *
 * 源码参考: _personal_copilot/src/agents/argue_manager.py
 */

import type {
  ArgueMessage,
  ArgueResponse,
  ArgueBackMessage,
  ArbitrationRequest,
  ArgueLevel,
  Evidence,
} from "./models.js";

// ============================================================================
// 类型
// ============================================================================

/** Argue 评估函数（可由 LLM 实现） */
export type ArgueEvaluator = (argue: ArgueMessage) => Promise<ArgueResponse>;

/** 仲裁回调 */
export type ArbitrationCallback = (request: ArbitrationRequest) => Promise<string | undefined>;

export interface ArgueRecord {
  argue: ArgueMessage;
  response?: ArgueResponse;
  argueBack?: ArgueBackMessage;
  arbitration?: ArbitrationRequest;
}

export interface ArgueManagerConfig {
  evaluator?: ArgueEvaluator;
  arbitrationCallback?: ArbitrationCallback;
}

// ============================================================================
// ArgueManager
// ============================================================================

export class ArgueManager {
  private history: ArgueRecord[] = [];
  private registeredAgents = new Set<string>();
  private evaluator?: ArgueEvaluator;
  private arbitrationCallback?: ArbitrationCallback;

  constructor(config: ArgueManagerConfig = {}) {
    this.evaluator = config.evaluator;
    this.arbitrationCallback = config.arbitrationCallback;
  }

  /** 注册 Agent */
  registerAgent(agentName: string): void {
    this.registeredAgents.add(agentName);
  }

  /** 设置仲裁回调 */
  setArbitrationCallback(callback: ArbitrationCallback): void {
    this.arbitrationCallback = callback;
  }

  /** 发送 Argue */
  async sendArgue(argue: ArgueMessage): Promise<ArgueResponse> {
    const response = this.evaluator ? await this.evaluator(argue) : this.defaultEvaluate(argue);

    const record: ArgueRecord = { argue, response };
    this.history.push(record);
    return response;
  }

  /** 发送 Argue-Back（拒绝后的反驳） */
  sendArgueBack(opts: {
    argueId: string;
    argueBackId: string;
    rejectionReason: string;
    counterEvidence?: Evidence[];
    counterArguments?: string[];
    alternativeSolution?: string;
    requiresArbitration?: boolean;
  }): ArgueBackMessage {
    const record = this.history.find((r) => r.argue.argueId === opts.argueId);
    const argueBack: ArgueBackMessage = {
      argueId: opts.argueId,
      argueBackId: opts.argueBackId,
      rejectionReason: opts.rejectionReason,
      counterEvidence: opts.counterEvidence ?? [],
      counterArguments: opts.counterArguments ?? [],
      alternativeSolution: opts.alternativeSolution,
      requiresArbitration: opts.requiresArbitration ?? false,
      timestamp: new Date().toISOString(),
    };

    if (record) {
      record.argueBack = argueBack;
    }
    return argueBack;
  }

  /** 请求仲裁 */
  async requestArbitration(
    argueId: string,
    requestedBy: string,
    reason: string,
  ): Promise<ArbitrationRequest> {
    const request: ArbitrationRequest = {
      argueId,
      requestedBy,
      reason,
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    if (this.arbitrationCallback) {
      const resolution = await this.arbitrationCallback(request);
      if (resolution) {
        request.status = "resolved";
        request.resolution = resolution;
      }
    }

    const record = this.history.find((r) => r.argue.argueId === argueId);
    if (record) {
      record.arbitration = request;
    }

    return request;
  }

  /** 获取历史记录 */
  getHistory(): ArgueRecord[] {
    return [...this.history];
  }

  /** 获取待仲裁请求 */
  getPendingArbitrations(): ArbitrationRequest[] {
    return this.history
      .filter((r) => r.arbitration?.status === "pending")
      .map((r) => r.arbitration!);
  }

  /** 统计 */
  getStatistics(): ArgueStats {
    const total = this.history.length;
    const accepted = this.history.filter((r) => r.response?.accepted).length;
    const rejected = this.history.filter((r) => r.response && !r.response.accepted).length;
    const withArgueBack = this.history.filter((r) => r.argueBack).length;
    const arbitrated = this.history.filter((r) => r.arbitration).length;

    const byLevel: Record<string, number> = {};
    for (const r of this.history) {
      const level = r.argue.level;
      byLevel[level] = (byLevel[level] ?? 0) + 1;
    }

    return { total, accepted, rejected, withArgueBack, arbitrated, byLevel };
  }

  // ==================== 默认评估逻辑 ====================

  private defaultEvaluate(argue: ArgueMessage): ArgueResponse {
    // 基于优先级的简单评估策略
    const levelPriority: Record<ArgueLevel, number> = {
      urgent: 4,
      serious: 3,
      normal: 2,
      suggestion: 1,
    };

    const priority = levelPriority[argue.level] ?? 2;
    const hasEvidence = argue.evidence.length > 0;
    const hasSuggestions = argue.suggestions.length > 0;

    // urgent + 有证据 → 接受; suggestion 无证据 → 拒绝
    const accepted = priority >= 3 || (hasEvidence && hasSuggestions);

    return {
      argueId: argue.argueId,
      accepted,
      feedback: accepted
        ? `Argue accepted (level: ${argue.level}, evidence: ${argue.evidence.length})`
        : `Argue rejected (insufficient evidence for level: ${argue.level})`,
      reasoning: accepted
        ? "Priority and evidence sufficient for acceptance"
        : "Low priority or missing evidence/suggestions",
      counterPoints: accepted
        ? []
        : ["More evidence needed", "Consider providing concrete suggestions"],
      timestamp: new Date().toISOString(),
    };
  }
}

export interface ArgueStats {
  total: number;
  accepted: number;
  rejected: number;
  withArgueBack: number;
  arbitrated: number;
  byLevel: Record<string, number>;
}
