# Python → TypeScript 迁移差异分析报告

> 审计日期：2026-02-16
> 审计范围：三大工作流（需求澄清 → 架构设计 → 编码）及整体管线集成

---

## 总览

| 工作流                        | Python 完成度 | TS 完成度 | 差距 |
| ----------------------------- | ------------- | --------- | ---- |
| **Requirement Clarification** | 100%          | 30%       | 70%  |
| **Architecture Design**       | 100%          | 40%       | 60%  |
| **Coder**                     | 100%          | 15%       | 85%  |
| **整体 Pipeline 集成**        | 100%          | 50%       | 50%  |

---

## 一、Requirement Clarification（需求澄清）

### 1.1 运作模式差异（根本性差异）

| 维度             | Python 原版                                  | TS 迁移版                  | 差异等级    |
| ---------------- | -------------------------------------------- | -------------------------- | ----------- |
| **交互模式**     | 多轮对话（用户←→Agent 循环）                 | 一句话展开（强制一轮完成） | 🔴 根本差异 |
| **调研环节**     | 完整异步调研（GitHub + Web 搜索）            | 无调研                     | 🔴 功能缺失 |
| **信息收集策略** | 5 阶段渐进式收集（基础→目标→背景→技术→细化） | 一次性推断全部信息         | 🔴 根本差异 |
| **退出条件**     | 智能判断（信息完整度 + 用户确认）            | 无条件一轮退出             | 🟡 简化     |
| **追问机制**     | 有（用户不回答时继续追问）                   | 无                         | 🟡 缺失     |

### 1.2 工具差异

| 工具                       | Python                      | TS                    | 状态        |
| -------------------------- | --------------------------- | --------------------- | ----------- |
| `record_requirement`       | ✅ 写入 collected_info.json | ✅ 写入内存           | 🟡 无持久化 |
| `record_tech_choice`       | ✅ 含 tech_stack 分模块     | ✅ 简化版             | 🟡 格式差异 |
| `read_context`             | ✅ 读取文件                 | ✅ 读取内存           | 🟡 无持久化 |
| `generate_report`          | ✅ 完整报告                 | ✅ 基本报告           | 🟢 接近     |
| `quick_web_search`         | ✅ 内置                     | ⚠️ 需外部注入         | 🟡 依赖外部 |
| `quick_web_fetch`          | ✅ 内置                     | ⚠️ 需外部注入         | 🟡 依赖外部 |
| `quick_github_search`      | ✅ GitHub 搜索              | ❌ 缺失               | 🔴 缺失     |
| `research_agent`           | ✅ 异步深度调研             | ❌ 缺失               | 🔴 缺失     |
| `check_research_status`    | ✅ 状态检查（最多3次）      | ❌ 缺失               | 🔴 缺失     |
| `get_research_results`     | ✅ 获取结果                 | ❌ 缺失               | 🔴 缺失     |
| `list_research_tasks`      | ✅ 列出任务                 | ❌ 缺失               | 🔴 缺失     |
| `identify_innovation`      | ✅ 完整覆盖度分析           | ✅ 简化版             | 🟡 简化     |
| `confirm_tech_choice`      | ✅ 基于调研确认             | ❌ 缺失               | 🔴 缺失     |
| `generate_requirement_doc` | ✅ 完整 OpenSpec Proposal   | ⚠️ 简化版，非标准格式 | 🔴 格式错误 |

### 1.3 OpenSpec Proposal 格式差异

Python 原版 `_generate_openspec_doc()` 输出：

```markdown
# {项目名}

**Generated**: 2026-01-15 10:30:00
**Format**: OpenSpec v1.0 Proposal
**Type**: Greenfield Project (新应用)

---

## Why

{叙述性描述：背景+用户+目标+场景}

## What Changes

**Core Features**

- {功能列表}
  **Functional Requirements**
- {从 use_case/goals 提取}
  **Features to Implement**
- {创新点/未覆盖需求}
  **Technology Stack**
- **BACKEND**: FastAPI
- **FRONTEND**: React
  **Deployment & Integration**
- 技术形式：{tech_preferences}
- 部署环境：{deployment_env}

## Impact

- **Affected specs**: 新建项目
- **Affected code**: 新建项目
- **Project Structure**:
  - Backend：Python核心模块
  - 配置：应用配置、环境变量
  - 文档：API文档、用户手册
    **External Dependencies**
- **AI/LLM**: 自然语言处理
- **存储**: {storage}
  **Implementation Notes**
- 总共 {n} 个功能点
- 复杂度分布：low: 3, medium: 2, high: 1

---

**Next Steps**: Use this proposal to generate tasks and implementation specs.
```

TS 当前输出（简化版，不符合标准）：

```markdown
# Hello World Greeting Program

**Format**: OpenSpec v1.0 Proposal

## Why

**Background**: {简单 key-value}
**Target Users**: {简单 key-value}

## What Changes

### Core Features

- main_features: {内容}

### Technology Stack

- PROGRAMMING_LANGUAGE: Python

## Impact

- **Affected specs**: New project
- **Affected code**: New project
```

**缺失章节**：Generated 时间戳、Type、Functional Requirements、Features to Implement、Deployment & Integration、Project Structure、External Dependencies、Implementation Notes、分隔线、Next Steps。

### 1.4 系统 Prompt 差异

| 维度               | Python（457行）              | TS（81行） |
| ------------------ | ---------------------------- | ---------- |
| **信息收集策略**   | 5 阶段详细策略 + 必收字段    | 3 阶段简化 |
| **追问机制**       | 详细示例 + 强制要求          | 无         |
| **调研决策**       | 何时调研/不调研 + 策略       | 无         |
| **功能需求细化**   | 输入/输出/规则/约束          | 无         |
| **退出条件**       | 多级判断 + 收束提醒          | 简单条件   |
| **场景丰富化原则** | 允许/禁止推断规则            | 无         |
| **记忆管理**       | System Prompt 注入已记录信息 | 有但简化   |

---

## 二、Architecture Design（架构设计）

### 2.1 图拓扑

图结构一致（14 个节点），但节点实现差距巨大。

### 2.2 节点实现差异

| 节点                    | Python 完成度                      | TS 完成度                | 关键缺失                                                                                |
| ----------------------- | ---------------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `validate_input`        | 完整验证                           | Stub                     | 缺详细错误列表                                                                          |
| `analyze_requirement`   | ~100行 Prompt                      | 26行 Prompt              | 缺 tech_features, reasoning, recommended_architecture                                   |
| `list_features`         | 结构化 ID + 追溯                   | 简化版                   | 缺 source_requirement, triggered_by, required_by, is_implicit                           |
| `select_pattern`        | **22+ 模式库（500行参考）**        | **6 个模式**             | 🔴 缺少 16+ 架构模式                                                                    |
| `design_modules`        | 2步（定义+职责矩阵）               | 1步                      | 缺 layer, estimated_size, responsibility_matrix 生成                                    |
| `define_interfaces`     | 完整方向/层级/签名                 | 简化                     | 缺 direction(exposed_by/consumes_by), layer                                             |
| `design_review`         | 结构化问题(type/severity/affected) | 字符串数组               | 缺 review_passed, overall_assessment                                                    |
| `validate_architecture` | **10+ 字段验证打分**               | **简单 boolean**         | 🔴 缺 requirement_coverage, overall_score, missing_interfaces, responsibility_conflicts |
| `refine_design`         | **完整 LLM 修复（180行 Prompt）**  | **Stub（只递增计数器）** | 🔴 完全未实现                                                                           |
| `design_file_structure` | 模式感知生成器 + 固定目录          | LLM 生成                 | 不同方式                                                                                |
| `generate_openspec`     | 写入文件系统                       | 内存中生成               | 🟡 无持久化                                                                             |
| `finalize`              | PM 系统集成                        | 简单 success 检查        | 缺 PM 集成                                                                              |

### 2.3 状态模型缺失字段

**Python 有但 TS 缺失的状态字段**：

```
architecture_validation     — 验证详情（score, issues, suggestions）
validation_issues            — 问题列表
missing_interfaces           — 缺失接口（P0/P1/P2 优先级）
responsibility_conflicts     — 职责冲突
refinement_instructions      — 修复指令
file_tree                    — 文件树
file_structure_doc           — 文件结构文档
openspec_change_path         — OpenSpec 文件路径
architecture_summary         — 架构摘要
stats                        — 统计数据
```

### 2.4 Prompt 质量差距

| Prompt                | Python 行数      | TS 行数 | 差距 |
| --------------------- | ---------------- | ------- | ---- |
| analyze-requirement   | ~100             | 26      | 74%  |
| list-features         | ~100             | 26      | 74%  |
| select-pattern        | ~550（含模式库） | 35      | 94%  |
| design-modules        | ~110（2步）      | 29      | 74%  |
| define-interfaces     | ~130             | 24      | 82%  |
| design-review         | ~60              | 27      | 55%  |
| validate-architecture | ~110             | 24      | 78%  |
| refine-design         | ~180             | 无      | 100% |

### 2.5 错误处理差距

| 机制          | Python                   | TS             |
| ------------- | ------------------------ | -------------- |
| LLM 重试      | 3次 + sleep              | 无             |
| JSON 解析错误 | 详细日志 + 保存到 .temp/ | 无             |
| 验证错误      | 错误列表返回             | 单个错误字符串 |
| 优雅降级      | 返回部分结果             | 返回空默认值   |

---

## 三、Coder（编码）

### 3.1 图拓扑

图结构一致（4 个节点：prepare → recursive_coder → handle_argue → finalize），条件路由逻辑也相同。**差异在节点实现。**

### 3.2 工具差异（根本性差距）

| 维度         | Python（19 个真实工具）                                                           | TS（2 个 Schema）            | 差距等级  |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------- | --------- |
| **文件读写** | ReadFileTool, WriteToFileTool, ReplaceInFileTool                                  | ❌ 缺失                      | 🔴        |
| **文件搜索** | ListFilesTool, SearchFilesTool, RipgrepSearchTool                                 | ❌ 缺失                      | 🔴        |
| **代码分析** | ListCodeDefinitionNamesTool, ProjectStructureAnalyzerTool, DependencyAnalyzerTool | ❌ 缺失                      | 🔴        |
| **代码生成** | CodeGeneratorTool, CodeFillerTool                                                 | `generate_code`（仅 schema） | 🔴 只有壳 |
| **代码质量** | SyntaxCheckerTool, CodeFormatterTool, LinterTool, CodeValidatorTool               | ❌ 缺失                      | 🔴        |
| **测试执行** | StandardTestRunnerTool                                                            | ❌ 缺失                      | 🔴        |
| **系统命令** | ExecuteCommandTool, GetSystemInfoTool                                             | ❌ 缺失                      | 🔴        |
| **行为决策** | —                                                                                 | `decide_action`（仅 schema） | 🟡        |

**关键问题**：TS 的 2 个"工具"只有 JSON Schema 定义，**没有任何真实实现**。LLM 调用 `generate_code` 后只返回 LLM 自己写的代码字符串，无法真正操作文件系统、运行测试、检查语法。

### 3.3 RecursiveExecutor 差异（核心差距）

| 维度             | Python（1492 行）                                                                                       | TS                      | 差距等级 |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| **执行器**       | `LoopExecutor` 完整实现                                                                                 | ❌ 无（仅迭代计数器）   | 🔴       |
| **最大迭代**     | 可配置（默认 50）                                                                                       | 硬编码 10               | 🟡       |
| **上下文压缩**   | 5 策略（Window/Forgetting/LLM Summary/Hybrid/None）                                                     | ❌ 无                   | 🔴       |
| **卡死检测**     | 5 类型（repeated_action/monologue/pattern_loop/context_overflow/no_progress）                           | ❌ 无                   | 🔴       |
| **任务追踪**     | `TaskTracker`（TODO/IN_PROGRESS/BLOCKED/DONE/FAILED/CANCELLED）                                         | ❌ 无                   | 🔴       |
| **执行状态**     | 9 种（RUNNING/PAUSED/AWAITING_USER_INPUT/COMPLETED/ERROR/STUCK/STOPPED/MAX_ITERATIONS_REACHED/ABORTED） | ❌ 无                   | 🔴       |
| **退出条件**     | 多种（completed/argue/quality_threshold/max_iterations/stuck）                                          | 仅 validation pass/fail | 🔴       |
| **生命周期钩子** | 5 个（on_iteration_start/end/error/task_complete/consecutive_errors）                                   | ❌ 无                   | 🟡       |

### 3.4 代码验证差异

| 维度             | Python                                 | TS                   | 差距等级 |
| ---------------- | -------------------------------------- | -------------------- | -------- |
| **语法验证**     | AST 解析（`_validate_implementation`） | ❌ 无                | 🔴       |
| **参数使用检查** | 检测未使用参数                         | ❌ 无                | 🔴       |
| **固定返回检测** | 警告常量返回值                         | ❌ 无                | 🔴       |
| **代码提取**     | 从 Markdown/LLM 响应中提取代码         | ❌ 无                | 🔴       |
| **质量评分**     | 多因子验证                             | LLM 自评（单一分数） | 🔴       |
| **验证重试**     | 2 次重试                               | ❌ 无                | 🟡       |

### 3.5 Argue 机制差异

| 维度             | Python                                                     | TS                                   | 差距等级 |
| ---------------- | ---------------------------------------------------------- | ------------------------------------ | -------- |
| **Argue 管理**   | `ArgueManager` 注册系统                                    | ❌ 无                                | 🟡       |
| **Argue 类型**   | 多种（validation_failed/test_quality/requirement_unclear） | 2 种                                 | 🟡       |
| **检测方式**     | 3 种（exit_reason/action/flag）                            | 1 种（validation pass/fail）         | 🟡       |
| **测试质量分析** | `_format_test_quality_issues()`                            | ❌ 无                                | 🟡       |
| **响应结构**     | 丰富（reason/test_issues/code_analysis/recommendation）    | 基础（type/details/suggestedAction） | 🟡       |

### 3.6 Prompt 质量差距

| Prompt                                   | Python 行数 | TS 行数 | 差距 |
| ---------------------------------------- | ----------- | ------- | ---- |
| 系统 Prompt（basic_coder.md + 内联构造） | ~276+       | 39      | 86%  |
| Argue Prompt                             | ~180        | 32      | 82%  |

Python 的 `generate_implementation()` 内联构造 ~200 行 prompt，包含：ORIGINAL REQUIREMENT、Task Description、System Architecture、Available Resources（Modules/Classes/Data Structures）、Skeleton Code、Standard Test、CRITICAL RULES（7 条）、Instructions（7 步）。

TS 仅 39 行，缺失：架构上下文、可用资源列表、骨架代码注入、标准测试注入、代码模板示例。

### 3.7 状态模型差异

Python 24 字段 vs TS 19 字段。**TS 缺失的关键字段**：

```
_coder_agent          — 依赖注入的 Agent 实例
stats                  — 运行统计（迭代次数、耗时、token 用量）
quality_indicators     — 详细质量指标（非单一分数）
```

### 3.8 其他差距

| 维度                  | Python                                                                    | TS                     |
| --------------------- | ------------------------------------------------------------------------- | ---------------------- |
| **代码生成/修复分离** | `generate_implementation()` + `fix_implementation()` 独立方法+独立 prompt | 单一节点               |
| **错误处理**          | 连续错误限制（默认 3）+ 指数退避 + 自动重试                               | 仅返回 fallback 默认值 |
| **记忆系统**          | AgentMemoryMixin（长期/短期/工作记忆）                                    | 无                     |
| **日志**              | 4 层结构化日志                                                            | 基础 console.log       |

---

## 四、整体 Pipeline 集成

### 4.1 管线阶段差异

| Python 阶段                    | TS 状态                        | 说明                            |
| ------------------------------ | ------------------------------ | ------------------------------- |
| `requirement_analysis`（专用） | ❌ 合并到 clarify_requirements | 信息收集+分析+调研 → 简化为一步 |
| `requirement_decomposition`    | ✅ Chain A 有，Dev Pipeline 缺 | 仅在 Chain A 中存在             |
| `architecture_design`          | ✅ 存在                        | 但节点实现不完整                |
| `task_decomposition`           | ❌ 缺失                        | Python 有专门的任务分解         |
| `skeleton_generation`          | ❌ 缺失                        | Python 生成代码骨架             |
| `coder`                        | ✅ 存在                        | 但实现待确认                    |
| `verify_quality`               | ❌ 缺失                        | Python 有专门的质量验证         |
| `deadlock_detection`           | ❌ 缺失                        | Python 有 3 类死锁检测          |
| `stop_mechanism`               | ❌ 缺失                        | Python 有 stop.md 紧急制动      |

### 4.2 数据流差异

**Python**：

```
refined_requirement → architecture_description → task_tree → skeleton_files → code_files
```

**TS（Dev Pipeline）**：

```
userRequirement → clarifiedRequirement → architectureModules → coderResults
```

**缺失的数据流**：

- `proposalDocument` 内容非标准 OpenSpec
- `architectureModules` 使用 `Record<string, unknown>` 丢失类型信息
- 缺少 `task_tree`、`skeleton_files` 中间产物

### 4.3 TS 做得更好的地方

| 特性                    | 说明                             |
| ----------------------- | -------------------------------- |
| **Chain 分离**          | A(开发)/B(Wiki)/C(迭代) 清晰分离 |
| **节点覆写注入**        | 依赖注入模式，方便测试           |
| **Step Hooks**          | 统一的横切关注点处理             |
| **ChainContext 容器**   | 集中化的依赖管理                 |
| **TypeScript 类型安全** | 编译时类型检查                   |

---

## 五、优先级排序

### P0 — 根本性功能缺失

1. **Coder 工具系统** — 仅 2 个 schema 壳，缺失 17 个真实工具（文件读写、代码分析、测试执行、语法检查）
2. **Coder RecursiveExecutor** — 完全缺失（1492 行核心执行器，含上下文压缩、卡死检测、任务追踪）
3. **Coder 代码验证** — 无 AST 解析、无参数使用检查、无语法验证（仅 LLM 自评分数）
4. **Requirement Clarification 运作模式** — 需支持交互式多轮对话
5. **OpenSpec Proposal 格式** — 输出不符合标准格式
6. **Architecture Design `refine_design` 节点** — 完全未实现（stub）
7. **Architecture Design 验证打分** — 无 requirement_coverage, overall_score
8. **架构模式库** — 仅 6 个，缺少 16+ 个

### P1 — 重要功能缺失

9. **Coder Prompt 质量** — 39 行 vs 276+ 行（缺失架构上下文、骨架代码、标准测试注入）
10. **Coder 错误处理** — 无连续错误限制、无指数退避、无自动重试
11. **调研工具** — research_agent, GitHub 搜索等
12. **所有工作流 Prompt 质量** — 所有节点 prompt 需大幅扩充
13. **状态字段完整性** — 多个关键字段缺失（layer, estimated_size, direction 等）
14. **Architecture 错误处理** — 无重试、无 JSON 错误保存
15. **Decomposition 完善** — 缺少规模估算、自适应层次

### P2 — 改进项

16. **Coder Argue 增强** — ArgueManager、测试质量分析
17. **Coder 代码生成/修复分离** — 独立方法 + 独立 prompt
18. **数据持久化** — collected_info 应写入文件系统
19. **PM 系统集成** — finalize 节点应更新 PM 数据库
20. **Checkpoint 恢复** — 长流程状态持久化
21. **死锁检测** — 防止无限循环
22. **Emergency stop** — stop.md 紧急制动机制
