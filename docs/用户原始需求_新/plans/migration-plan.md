# Personal Copilot → OpenClaw 迁移计划（修订版）

## Context

Personal Copilot 的核心理念是**低监督软件工厂**，不是零散工具的集合。它有四条核心管线：

1. **AI 项目管理体系**（PM 系统 + 合规注册 + 项目 Wiki）— 已完整实现
2. **新软件生成管线**（需求澄清 → 架构设计 → TDD Coder-Debugger 循环）— 95% 实现
3. **软件维护更新管线**（变更需求 → 架构变更 → TDD）— 70% 实现
4. **低监督自迭代系统**（多 Agent Argue + Run-Evaluate-Patch-Evaluate 闭环）— 已完整实现

OpenClaw 将替代原来的基础设施层（LLM 服务、通道、Agent 框架），同时作为"老板监视窗"（通过飞书等通道汇报开发进度、接收指令）。

---

## 架构决策

| 决策         | 方案                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM 层       | 复用 OpenClaw 模型体系                                                                                                                                     |
| 工作流编排   | 采用 **LangGraph.js** (`@langchain/langgraph` v1.1.4)，与 Python 版 API 对齐，复用 OpenClaw 的 subagent 做并行任务                                         |
| 存储         | PM 数据库用 SQLite（适配 OpenClaw 现有），工作流 checkpointer 用 `@langchain/langgraph-checkpoint-sqlite`，知识/文档为 workspace 内文件，向量用 sqlite-vec |
| 集成形态     | **核心管线基础设施 → `src/pipelines/`**；**管线工具 → `extensions/pipelines/`**；**用户入口 → `skills/`**                                                  |
| 通道集成     | 飞书作为主要"老板监视窗"，开发进度通过飞书卡片汇报                                                                                                         |
| 工具膨胀控制 | 每条管线暴露 1-2 个编排入口工具，内部步骤不暴露为独立工具                                                                                                  |

### 引擎选型说明

经调研对比以下方案后选定 LangGraph.js：

| 方案                                             | 结论                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LangGraph.js** (`@langchain/langgraph` v1.1.4) | **采用**。与 Python 版 API 1:1 对齐，迁移概念成本最低；内置 SQLite checkpointer；支持 interrupt/resume（适配 Argue 升级）；官方声明可独立于 LangChain 使用；2026-02 仍活跃更新 |
| XState v5 (v5.28.0)                              | 排除。事件驱动状态机，非数据流 DAG；迁移需重新设计事件模型，概念转换成本高；无内置 state merge/reducer                                                                         |
| Temporal TS SDK (v1.14.1)                        | 排除。需部署 Temporal Server（Java），运维过重；与 OpenClaw 轻量单体架构不匹配                                                                                                 |
| Inngest (v3.52.0)                                | 排除。需 Inngest 平台或自托管服务，面向 serverless 场景                                                                                                                        |
| Python 桥接 (python-shell)                       | 排除。双运行时维护、调试困难、桥接库老旧无维护；可作为临时过渡但不推荐长期                                                                                                     |
| 手搓轻量状态机                                   | 备选。约 300-400 行可实现核心功能，但缺少社区支持，并行分支/子图等高级特性需自行扩展                                                                                           |

**引入代价**：`@langchain/core` 作为 peer dependency 是必需的冗余依赖（~1.1MB），但不影响运行时性能。

---

## 核心概念映射

| Personal Copilot                 | OpenClaw 对应                                                         |
| -------------------------------- | --------------------------------------------------------------------- |
| LangGraph StateGraph (Python)    | LangGraph.js StateGraph (`@langchain/langgraph`，JS 版 API 1:1 对齐)  |
| LangGraph Node（纯函数）         | LangGraph.js Node（纯函数，`(state) => Partial<state>`）              |
| LangGraph Annotation (TypedDict) | LangGraph.js Annotation（TypeScript interface + channel reducers）    |
| LangGraph Conditional Edges      | LangGraph.js addConditionalEdges / Command-based 路由                 |
| PostgreSQL Checkpointer          | `@langchain/langgraph-checkpoint-sqlite`（对接 OpenClaw SQLite 体系） |
| LLM Service (GLM/Qwen)           | OpenClaw 模型体系（已配 GLM OpenAI 格式）                             |
| CrewAI Tools                     | OpenClaw AgentTool（通过 plugin 注册）                                |
| Interactive CLI / Chainlit       | OpenClaw 通道（飞书/WebChat/CLI）                                     |
| Cron（无）                       | OpenClaw Cron Service（原生支持）                                     |
| 多 Agent Argue                   | OpenClaw Subagent 系统 + 自定义 Argue 协议                            |
| OpenSpec 格式                    | 原样迁移为 TypeScript 实现                                            |

---

## Phase 0: 基础引擎（Foundation Engine）

**目标**：建立工作流引擎和 OpenSpec 系统——所有管线的共同基础

### 0.1 LangGraph.js 集成（`src/pipelines/engine/`）

引入 `@langchain/langgraph` 作为工作流引擎，与 Python 版 LangGraph API 1:1 对齐：

- **依赖安装**：
  - `@langchain/langgraph` (v1.1.4) — 核心 StateGraph
  - `@langchain/langgraph-checkpoint` (v1.0.0) — Checkpointer 抽象
  - `@langchain/langgraph-checkpoint-sqlite` (v1.0.1) — SQLite 持久化（对接 OpenClaw 现有 SQLite）
  - `@langchain/core` (v1.1.24) — peer dependency（必需但不直接使用）
- `graph-factory.ts`：工作流图构建工厂
  - 封装 StateGraph 创建、Annotation 定义、node/edge 注册
  - 统一 checkpointer 配置（默认 SQLite，路径跟随 workspace）
  - 统一执行追踪：包装每个 node 记录 stage_name, duration, token_usage
- `types.ts`：引擎类型定义
  - `WorkflowState`：各管线 state 的基础 interface（含 `messages`, `stage`, `metadata`）
  - `StageResult`：stage_name, status, data, duration, token_usage
  - `WorkflowConfig`：checkpointer, max_retries, interrupt_before/after 配置
- `checkpointer.ts`：Checkpointer 适配层
  - 基于 `@langchain/langgraph-checkpoint-sqlite`，配置 OpenClaw 的 SQLite 路径
  - 支持按 thread_id 隔离不同工作流实例
- `node-wrapper.ts`：Node 包装器
  - 为纯函数 node 添加执行追踪（duration, token_usage）
  - 错误处理：可配置 max_retries + 指数退避
  - 与 OpenClaw 模型体系对接的 LLM 调用封装

**迁移对照**：Python 版 `StateGraph` → JS 版 `StateGraph`，Python 版 `TypedDict` → JS 版 `Annotation`，Python 版 `add_node/add_edge/add_conditional_edges` → JS 版同名方法，Python 版 `PostgresSaver` → JS 版 `SqliteSaver`

### 0.2 OpenSpec 系统（`src/pipelines/openspec/`）

从 `_personal_copilot/src/services/openspec/` 迁移：

- `models.ts`：核心数据模型
  - Scenario（WHEN/THEN）、Requirement、Spec、Delta、Proposal、Design、Change、Task/TaskGroup
  - 源码：`_personal_copilot/src/services/openspec/schemas/models.py`
- `parser.ts`：Markdown 解析器
  - 源码：`_personal_copilot/src/services/openspec/markdown_parser.py`
- `validator.ts`：规范验证
- `template-generator.ts`：模板生成

### 0.3 Extension 骨架

- `extensions/pipelines/package.json`
- `extensions/pipelines/index.ts`（OpenClawPluginDefinition）

### 0.4 统一类型

- `src/pipelines/types.ts`：StatusCode、ExecutionMetadata、ErrorInfo

**关键参考文件：**

- `src/plugins/types.ts` — Plugin API 接口
- `src/agents/tools/common.ts` — AgentTool 类型
- `extensions/llm-task/src/llm-task-tool.ts` — 插件工具参考实现
- `_personal_copilot/src/services/openspec/` — OpenSpec 源码
- `@langchain/langgraph` npm 包源码 — StateGraph、Annotation、compile API
- `@langchain/langgraph-checkpoint-sqlite` — SQLite checkpointer 参考

---

## Phase 1: PM 系统 + 合规注册（项目管理中枢）

**目标**：迁移 PM 系统——四条管线的中央枢纽，所有任务的调度中心

### 1.1 PM 数据库服务（`src/pipelines/services/pm/`）

从 `_personal_copilot/src/services/pm/` 迁移：

- `database.ts`：核心 PM 数据库
  - SQLite schema：requirements, dependencies, argument_history, performance_metrics, documents, requirement_comments
  - 需求树管理（父子关系、依赖）
  - 性能指标追踪
  - 源码：`_personal_copilot/src/services/pm/database.py`（205KB）
- `task-queue-manager.ts`：任务执行队列
  - 优先级排序、位置调整
  - 源码：`_personal_copilot/src/services/pm/task_queue_manager.py`
- `task-converter.ts`：需求 → 可执行任务转换
  - 源码：`_personal_copilot/src/services/pm/task_converter.py`
- `quality-gate.ts`：质量门禁
  - 源码：`_personal_copilot/src/services/pm/quality_gate.py`

### 1.2 合规注册系统（`src/pipelines/services/compliance/`）

- `compliance-checker.ts`：架构合规验证
  - 严重级别：CRITICAL/ERROR/WARNING/INFO
  - 规则注册和管理
  - 源码：`_personal_copilot/src/services/compliance/compliance_checker.py`
- `compliance-registry.ts`：规范注册表

### 1.3 插件工具（`extensions/pipelines/src/tools/`）

- `pm-manage-tool.ts`：PM 管理入口（需求 CRUD、任务队列、状态查询）
- `compliance-check-tool.ts`：合规检查入口

### 1.4 飞书集成 Hook

- 注册 hook：当任务状态变更时，通过飞书卡片推送进度
- 注册 hook：当合规检查发现 CRITICAL 违规时，飞书告警

**关键源码：**

- `_personal_copilot/src/services/pm/database.py`
- `_personal_copilot/src/services/pm/task_queue_manager.py`
- `_personal_copilot/src/services/compliance/compliance_checker.py`

---

## Phase 2: 知识管理 + 语义治理（项目 Wiki）

**目标**：迁移 AI-Gen Project Wiki 系统——面向 AI 和人类的项目知识体系

### 2.1 知识管理服务（`src/pipelines/services/knowledge/`）

- `knowledge-manager.ts`：ApplicationKnowledgeManager
  - Per-workspace 知识空间
  - 向量检索：复用 `src/memory/sqlite-vec.ts` + `src/memory/embeddings.ts`
  - 混合搜索：复用 `src/memory/hybrid.ts`
  - 源码：`_personal_copilot/src/services/knowledge/application_knowledge_manager.py`
- `project-doc-manager.ts`：ProjectDocManager
  - 文件级文档追踪
  - Wiki 生成
  - 源码：`_personal_copilot/src/services/knowledge/project_doc_manager.py`

### 2.2 语义治理服务（`src/pipelines/services/knowledge/`）

- `semantic-governance.ts`：
  - SymidGenerator：语义 ID 生成
  - SemanticHasher：AST 语义哈希
  - SemanticHeaderInjector：语义元数据头注入
  - DriftTracker：语义漂移检测
  - 源码：`_personal_copilot/src/services/knowledge/` + `_personal_copilot/src/tools/semantic_governance/`

### 2.3 项目分析工作流（`extensions/pipelines/src/tools/`）

- `project-analyze-tool.ts`：项目扫描分析入口
  - 文件扫描 → LLM 分析 → 文档生成 → 知识入库
  - 源码：`_personal_copilot/src/workflows/graphs/project_analysis_workflow.py`

### 2.4 插件工具

- `knowledge-search-tool.ts`：知识搜索
- `wiki-tool.ts`：Wiki 读写

**关键参考文件：**

- `src/memory/sqlite-vec.ts`、`src/memory/embeddings.ts`、`src/memory/hybrid.ts`

---

## Phase 3: 新软件生成管线（核心生产力）

**目标**：迁移完整的"需求 → 架构 → 代码"生成管线——这是软件工厂的核心

### 3.1 需求澄清工作流（`src/pipelines/workflows/`）

- `requirement-clarification.ts`：Tool Use Agent 模式
  - Agent 直接决定调用哪些工具
  - 工具集：generate_requirement_doc, research, record_requirement, search_alternatives, identify_innovation
  - 输出：OpenSpec 格式需求文档
  - 源码：`_personal_copilot/src/workflows/graphs/requirement_clarification_agent_workflow.py`
  - 工具源码：`_personal_copilot/src/tools/requirement_clarification_agent/`

### 3.2 架构设计工作流（`src/pipelines/workflows/`）

- `architecture-design.ts`：状态机实现
  - 流程：validate → scenario_route → analyze_requirement → list_features → select_pattern → design_modules → define_interfaces → design_review → validate → refine → design_file_structure → generate_openspec → finalize
  - 支持 new_project 和 modify_existing 场景
  - 输出：OpenSpec 架构文档
  - 源码：`_personal_copilot/src/workflows/graphs/architecture_design_workflow.py`

### 3.3 TDD Coder-Debugger 循环（`src/pipelines/workflows/`）

- `coder-debugger-loop.ts`：盲测机制 + Argue 支持
  - 源码：`_personal_copilot/src/workflows/coder_debugger_loop.py`（96KB）
  - 核心流程：
    1. Debugger 生成 Standard Test（对 Coder 可见）
    2. Coder 编码，运行 Standard Test
    3. Debugger 生成 Full Test（对 Coder 不可见——盲测）
    4. Debugger 运行 Full Test
    5. 失败时：Debugger 生成错误报告（仅失败测试可见）
    6. Coder 根据报告修复
    7. 循环直到全部通过
  - 配置：max_refine_rounds=10, max_llm_calls=50, static_check=true
  - Argue 机制：当 Coder/Debugger 产生分歧时触发争议解决
  - 实现方式：用 OpenClaw subagent 分别运行 Coder 和 Debugger 角色

### 3.4 插件工具（`extensions/pipelines/src/tools/`）

- `generate-software-tool.ts`：新软件生成入口（编排上述三个工作流）
- `requirement-clarify-tool.ts`：单独触发需求澄清
- `architecture-design-tool.ts`：单独触发架构设计

### 3.5 Cron 集成

- 注册 cron job：长时间生成任务可以后台运行，完成后通过飞书通知

**关键源码：**

- `_personal_copilot/src/workflows/graphs/requirement_clarification_agent_workflow.py`
- `_personal_copilot/src/workflows/graphs/architecture_design_workflow.py`
- `_personal_copilot/src/workflows/coder_debugger_loop.py`
- `_personal_copilot/src/tools/requirement_clarification_agent/`

---

## Phase 4: 自迭代系统（低监督核心）

**目标**：迁移 Argue 系统和 Run-Evaluate-Patch-Evaluate 闭环——这是"低监督"的关键

### 4.1 Argue 系统（`src/pipelines/services/argue/`）

- `argue-handler.ts`：争议处理工作流
  - 流程：classify → analyze_conflict → attempt_auto_resolve → (escalate_to_user | finalize)
  - 双层 Argue：需求级别 + 实现级别
  - 源码：`_personal_copilot/src/workflows/graphs/argue_handling_workflow.py`
- `argue-manager.ts`：争议管理器
  - 源码：`_personal_copilot/src/agents/argue_manager.py`
  - 争议历史存储在 PM 数据库（argument_history 表）

### 4.2 自迭代闭环（`src/pipelines/services/self-iteration/`）

从 `_personal_copilot/src/workflows/self_iteration/`（26 文件）迁移：

- `orchestrator.ts`：ClosedLoopOrchestrator 主编排器
- `failure-collector.ts`：失败事件收集（严重级别分类）
- `kpi-collector.ts`：KPI 指标追踪和护栏
- `expectation-analyzer.ts`：KPI 差距分析
- `patch-generator.ts`：补丁生成
- `patch-validator.ts`：补丁验证
- `auto-apply-engine.ts`：自动应用决策引擎
- `safety-monitor.ts`：安全约束监控
- `patch-applier.ts`：补丁应用
- `patch-database.ts`：补丁历史和溯源
- `attribution-engine.ts`：补丁归因和影响追踪
- `lineage-tracker.ts`：变更血缘追踪
- `iteration-trigger.ts`：迭代触发条件

### 4.3 插件工具

- `self-iterate-tool.ts`：手动触发自迭代
- `argue-tool.ts`：手动触发争议解决

### 4.4 Cron + Hook 集成

- Cron job：定期运行 KPI 检查，触发自迭代
- Hook：当 coder-debugger 循环失败超过阈值时，自动触发自迭代
- Hook：当自迭代产生补丁时，通过飞书通知"老板"审批或知悉

**关键源码：**

- `_personal_copilot/src/workflows/self_iteration/`（26 文件，364KB）
- `_personal_copilot/src/workflows/graphs/argue_handling_workflow.py`
- `_personal_copilot/src/agents/argue_manager.py`

---

## Phase 5: 维护更新管线 + 文档组织

**目标**：迁移软件维护管线和文档管理

### 5.1 变更需求工作流（`src/pipelines/workflows/`）

- `requirement-decomposition.ts`：需求分解
  - 源码：`_personal_copilot/src/workflows/graphs/requirement_decomposition_workflow.py`
- `requirement-modification.ts`：需求变更处理
  - 源码：`_personal_copilot/src/workflows/graphs/requirement_modification_workflow.py`

### 5.2 架构变更工作流

- 复用 Phase 3 的 `architecture-design.ts`（modify_existing 场景）
- `architecture-exploration.ts`：架构探索
  - 源码：`_personal_copilot/src/workflows/graphs/architecture_exploration_workflow.py`

### 5.3 文档组织工作流

- `document-organization.ts`：
  - 流程：validate → classify → parse_checklists → analyze_status → update_checklists → import_to_pm → migrate_standard → archive
  - 自动分类：checklist/report/plan/other
  - 与 PM 系统双向同步
  - 源码：`_personal_copilot/src/workflows/graphs/document_organization_workflow.py`

### 5.4 插件工具

- `maintain-software-tool.ts`：维护更新入口
- `doc-organize-tool.ts`：文档组织入口

---

## Phase 6: 通道集成 + 监视窗

**目标**：实现"老板监视窗"和软件运行接口

### 6.1 飞书进度汇报

- 开发进度卡片：任务完成/失败/阻塞时推送飞书富文本卡片
- 合规告警卡片：CRITICAL 违规即时推送
- 自迭代报告卡片：补丁生成/应用结果推送
- Argue 升级卡片：需要人工介入时推送

### 6.2 飞书指令接收

- 通过飞书消息向开发 agent 下达具体开发指令
- 指令路由到对应管线（新建/维护/调试）

### 6.3 CLI 命令

- `openclaw pipelines generate <spec>` — 触发新软件生成管线
- `openclaw pipelines maintain <project>` — 触发维护更新管线
- `openclaw pipelines pm <subcommand>` — PM 操作
- `openclaw pipelines iterate` — 手动触发自迭代
- `openclaw pipelines analyze <path>` — 项目分析

### 6.4 Gateway 方法

- `pipelines.generate` — 新软件生成
- `pipelines.maintain` — 维护更新
- `pipelines.pm.*` — PM 操作
- `pipelines.iterate` — 自迭代
- `pipelines.knowledge.*` — 知识查询

---

## 文件结构总览

### 核心服务（`src/pipelines/`）

```
src/pipelines/
├── types.ts                              # 统一类型
├── engine/
│   ├── graph-factory.ts                  # StateGraph 构建工厂（封装 LangGraph.js）
│   ├── types.ts                          # 引擎类型（WorkflowState, StageResult, WorkflowConfig）
│   ├── checkpointer.ts                   # SQLite Checkpointer 适配层
│   └── node-wrapper.ts                   # Node 包装器（追踪、重试、LLM 封装）
├── openspec/
│   ├── models.ts                         # OpenSpec 数据模型
│   ├── parser.ts                         # Markdown 解析
│   ├── validator.ts                      # 规范验证
│   └── template-generator.ts             # 模板生成
├── services/
│   ├── pm/
│   │   ├── database.ts                   # PM 数据库
│   │   ├── task-queue-manager.ts         # 任务队列
│   │   ├── task-converter.ts             # 需求→任务转换
│   │   └── quality-gate.ts              # 质量门禁
│   ├── compliance/
│   │   ├── compliance-checker.ts         # 合规验证
│   │   └── compliance-registry.ts        # 规范注册
│   ├── knowledge/
│   │   ├── knowledge-manager.ts          # 知识管理
│   │   ├── project-doc-manager.ts        # 项目文档管理
│   │   └── semantic-governance.ts        # 语义治理
│   ├── argue/
│   │   ├── argue-handler.ts              # 争议处理
│   │   └── argue-manager.ts              # 争议管理
│   └── self-iteration/
│       ├── orchestrator.ts               # 闭环编排器
│       ├── failure-collector.ts          # 失败收集
│       ├── kpi-collector.ts              # KPI 追踪
│       ├── expectation-analyzer.ts       # 差距分析
│       ├── patch-generator.ts            # 补丁生成
│       ├── patch-validator.ts            # 补丁验证
│       ├── auto-apply-engine.ts          # 自动应用决策
│       ├── safety-monitor.ts             # 安全监控
│       ├── patch-applier.ts              # 补丁应用
│       ├── patch-database.ts             # 补丁历史
│       ├── attribution-engine.ts         # 归因引擎
│       ├── lineage-tracker.ts            # 血缘追踪
│       └── iteration-trigger.ts          # 迭代触发
└── workflows/
    ├── requirement-clarification.ts      # 需求澄清
    ├── architecture-design.ts            # 架构设计
    ├── coder-debugger-loop.ts            # TDD 盲测循环
    ├── requirement-decomposition.ts      # 需求分解
    ├── requirement-modification.ts       # 需求变更
    ├── architecture-exploration.ts       # 架构探索
    └── document-organization.ts          # 文档组织
```

### 插件工具（`extensions/pipelines/`）

```
extensions/pipelines/
├── package.json
├── index.ts
└── src/tools/
    ├── generate-software-tool.ts         # 新软件生成入口
    ├── maintain-software-tool.ts         # 维护更新入口
    ├── requirement-clarify-tool.ts       # 需求澄清
    ├── architecture-design-tool.ts       # 架构设计
    ├── pm-manage-tool.ts                 # PM 管理
    ├── compliance-check-tool.ts          # 合规检查
    ├── project-analyze-tool.ts           # 项目分析
    ├── knowledge-search-tool.ts          # 知识搜索
    ├── wiki-tool.ts                      # Wiki 读写
    ├── self-iterate-tool.ts              # 自迭代触发
    ├── argue-tool.ts                     # 争议解决
    └── doc-organize-tool.ts              # 文档组织
```

### Skills（`skills/`）

```
skills/
├── pipelines/SKILL.md                  # 总入口
├── software-factory/SKILL.md             # 软件工厂（生成+维护）
├── pm-system/SKILL.md                    # 项目管理
└── self-evolution/SKILL.md               # 自迭代系统
```

---

## 验证策略

### 每个 Phase 的验证

- **Phase 0**：LangGraph.js StateGraph 集成测试（定义图 → compile → invoke → 验证状态流转 + checkpointer 持久化/恢复）；OpenSpec 解析器测试（解析样例文档）
- **Phase 1**：PM 数据库 CRUD 测试；任务队列排序测试；合规检查规则匹配测试
- **Phase 2**：知识入库 → 向量搜索 → 结果验证；语义哈希一致性测试
- **Phase 3**：用小型需求文档跑完整管线：需求澄清 → 架构设计 → Coder-Debugger 循环 → 产出代码
- **Phase 4**：模拟失败场景 → 触发自迭代 → 验证补丁生成和应用；Argue 分歧 → 自动解决 → 验证结果
- **Phase 5**：变更需求 → 架构变更 → 代码更新完整链路
- **Phase 6**：飞书卡片推送验证；CLI 命令端到端测试

### E2E 验证

用一个小型测试项目跑完整软件工厂流程：

1. 输入需求描述 → 需求澄清 → OpenSpec 文档
2. 架构设计 → OpenSpec 架构文档
3. TDD Coder-Debugger → 生成代码 + 测试
4. 合规检查 → 通过/修复
5. PM 系统记录全过程
6. 飞书推送关键节点进度
