# Python → TypeScript 迁移差异分析报告

> 初始审计日期：2026-02-16
> 最近更新：2026-02-17
> 审计范围：三大工作流（需求澄清 → 架构设计 → 编码）及整体管线集成

---

## 总览

| 工作流                        | Python 完成度 | TS 完成度 | 差距 | 上次评估 |
| ----------------------------- | ------------- | --------- | ---- | -------- |
| **Requirement Clarification** | 100%          | 80%       | 20%  | 30%→80%  |
| **Architecture Design**       | 100%          | 85%       | 15%  | 40%→85%  |
| **Coder**                     | 100%          | 75%       | 25%  | 15%→75%  |
| **整体 Pipeline 集成**        | 100%          | 55%       | 45%  | 50%→55%  |

---

## 一、Requirement Clarification（需求澄清）

### 1.1 运作模式 ✅ 已对齐

| 维度             | Python 原版                                  | TS 迁移版                                                                      | 状态              |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------- |
| **交互模式**     | 多轮对话（用户←→Agent 循环）                 | ✅ 多轮对话，`conversationHistory` 跨轮持久化，`execute_tools → call_llm` 循环 | 🟢 已对齐         |
| **调研环节**     | 完整异步调研（GitHub + Web 搜索）            | ✅ `quick_web_search` + `quick_web_fetch`（外部注入）                          | 🟡 缺 GitHub 搜索 |
| **信息收集策略** | 5 阶段渐进式收集（基础→目标→背景→技术→细化） | ✅ 5 阶段渐进式（Prompt 明确定义）                                             | 🟢 已对齐         |
| **退出条件**     | 智能判断（信息完整度 + 用户确认）            | ✅ 多级判断 + 收束提醒机制                                                     | 🟢 已对齐         |
| **追问机制**     | 有（用户不回答时继续追问）                   | ✅ Prompt 要求 2-3 轮后收束                                                    | 🟢 已对齐         |

### 1.2 工具差异

| 工具                       | Python                      | TS                                    | 状态        |
| -------------------------- | --------------------------- | ------------------------------------- | ----------- |
| `record_requirement`       | ✅ 写入 collected_info.json | ✅ 写入内存                           | 🟡 无持久化 |
| `record_tech_choice`       | ✅ 含 tech_stack 分模块     | ✅ 单项记录                           | 🟢 已实现   |
| `confirm_tech_choice`      | ✅ 基于调研确认             | ✅ 批量确认 + 模块缺口检测            | 🟢 已实现   |
| `read_context`             | ✅ 读取文件                 | ✅ 读取内存                           | 🟡 无持久化 |
| `generate_report`          | ✅ 完整报告                 | ✅ 基本报告                           | 🟢 接近     |
| `quick_web_search`         | ✅ 内置                     | ✅ 外部注入（web-tools-adapter）      | 🟢 已实现   |
| `quick_web_fetch`          | ✅ 内置                     | ✅ 外部注入（web-tools-adapter）      | 🟢 已实现   |
| `quick_github_search`      | ✅ GitHub 搜索              | ❌ 缺失                               | 🟡 缺失     |
| `research_agent`           | ✅ 异步深度调研             | ❌ 缺失（可通过 web_search 部分替代） | 🟡 缺失     |
| `check_research_status`    | ✅ 状态检查（最多3次）      | ❌ 缺失                               | 🟡 缺失     |
| `get_research_results`     | ✅ 获取结果                 | ❌ 缺失                               | 🟡 缺失     |
| `list_research_tasks`      | ✅ 列出任务                 | ❌ 缺失                               | 🟡 缺失     |
| `identify_innovation`      | ✅ 完整覆盖度分析           | ✅ 已实现                             | 🟢 已实现   |
| `generate_requirement_doc` | ✅ 完整 OpenSpec Proposal   | ✅ 基本符合标准格式                   | 🟢 基本对齐 |

### 1.3 OpenSpec Proposal 格式 ✅ 基本对齐

TS 当前 `generateOpenSpecProposal()` 输出包含：

- ✅ Generated 时间戳、Format 声明、Type 类型
- ✅ Why 节（叙述性描述）
- ✅ What Changes 节（Core Features、Functional Requirements、Features to Implement、Technology Stack、Deployment & Integration）
- ✅ Capabilities 节（New Capabilities、Modified Capabilities）
- ✅ Impact 节（Affected specs、Affected code、Project Structure、External Dependencies、Implementation Notes）
- ✅ Next Steps

**剩余差异**：What Changes 和 Impact 子节结构比标准 OpenSpec 模板更详细（过度结构化），标准只要求自由文本。属于风格差异，不影响功能。

### 1.4 系统 Prompt ✅ 已大幅扩充

| 维度               | Python（457行）              | TS（当前）                | 状态      |
| ------------------ | ---------------------------- | ------------------------- | --------- |
| **信息收集策略**   | 5 阶段详细策略 + 必收字段    | ✅ 5 阶段 + 必收字段      | 🟢 已对齐 |
| **追问机制**       | 详细示例 + 强制要求          | ✅ 收束提醒机制           | 🟢 已对齐 |
| **调研决策**       | 何时调研/不调研 + 策略       | ✅ 调研决策策略           | 🟢 已对齐 |
| **功能需求细化**   | 输入/输出/规则/约束          | ✅ 技术选型后细化         | 🟢 已对齐 |
| **退出条件**       | 多级判断 + 收束提醒          | ✅ 多级判断               | 🟢 已对齐 |
| **场景丰富化原则** | 允许/禁止推断规则            | 🟡 未明确                 | 🟡 简化   |
| **记忆管理**       | System Prompt 注入已记录信息 | ✅ collectedInfoJson 注入 | 🟢 已对齐 |

### 1.5 剩余差距

1. 🟡 `research_agent` 异步深度调研系统（4 个工具）— 可通过 web_search 部分替代
2. 🟡 `quick_github_search` — 缺失
3. 🟡 数据持久化 — collected_info 仅在内存中，无文件系统写入
4. 🟡 LangGraph `interrupt` 主动暂停 — 当前是被动等待模式（状态序列化 + 外部循环）

---

## 二、Architecture Design（架构设计）

### 2.1 图拓扑

图结构一致（14 个节点）。**节点实现已大幅补齐。**

### 2.2 节点实现差异

| 节点                    | Python 完成度                      | TS 完成度                                                                                                                      | 状态          |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `validate_input`        | 完整验证                           | Stub                                                                                                                           | 🟡 简化       |
| `analyze_requirement`   | ~100行 Prompt                      | ✅ 扩充 Prompt（含 tech_features, reasoning）                                                                                  | 🟢 已对齐     |
| `list_features`         | 结构化 ID + 追溯                   | ✅ 扩充 Prompt（含 source_requirement, is_implicit）                                                                           | 🟢 已对齐     |
| `select_pattern`        | 22+ 模式库（500行参考）            | ✅ 22+ 模式库 + 自由组合设计                                                                                                   | 🟢 已对齐     |
| `design_modules`        | 2步（定义+职责矩阵）               | ✅ 含 layer, estimated_size, responsibility_matrix                                                                             | 🟢 已对齐     |
| `define_interfaces`     | 完整方向/层级/签名                 | ✅ 含 direction, layer                                                                                                         | 🟢 已对齐     |
| `design_review`         | 结构化问题(type/severity/affected) | ✅ 扩充 Prompt（含 review_passed, overall_assessment）                                                                         | 🟢 已对齐     |
| `validate_architecture` | 10+ 字段验证打分                   | ✅ 6 维度打分（overallScore, requirementCoverage, issues, missingInterfaces, responsibilityConflicts, refinementInstructions） | 🟢 已对齐     |
| `refine_design`         | 完整 LLM 修复（180行 Prompt）      | ✅ 完整 LLM 修复（architecture-nodes.ts:1343-1435）                                                                            | 🟢 已对齐     |
| `design_file_structure` | 模式感知生成器 + 固定目录          | ✅ LLM 生成                                                                                                                    | 🟢 不同方式   |
| `generate_openspec`     | 写入文件系统                       | 内存中生成                                                                                                                     | 🟡 无持久化   |
| `finalize`              | PM 系统集成                        | 简单 success 检查                                                                                                              | 🟡 缺 PM 集成 |

### 2.3 状态模型 ✅ 已补齐

之前缺失的字段已在 `states.ts` 中补齐：

- ✅ `validationResult`（含 overallScore, issues, missingInterfaces, responsibilityConflicts, refinementInstructions）
- ✅ `refinementHistory`
- ✅ `responsibilityMatrix`
- ✅ `fileStructure`
- 🟡 `openspec_change_path` — 无持久化路径
- 🟡 `stats` — 无运行统计

### 2.4 Prompt 质量 ✅ 已大幅扩充

| Prompt                | Python 行数      | TS 行数（当前）   | 状态      |
| --------------------- | ---------------- | ----------------- | --------- |
| analyze-requirement   | ~100             | ~60+              | 🟢 已扩充 |
| list-features         | ~100             | ~60+              | 🟢 已扩充 |
| select-pattern        | ~550（含模式库） | ~200+（22+ 模式） | 🟢 已扩充 |
| design-modules        | ~110（2步）      | ~75+              | 🟢 已扩充 |
| define-interfaces     | ~130             | ~65+              | 🟢 已扩充 |
| design-review         | ~60              | ~90+              | 🟢 已扩充 |
| validate-architecture | ~110             | ~100+             | 🟢 已扩充 |
| refine-design         | ~180             | ✅ 新增           | 🟢 已实现 |

### 2.5 错误处理

| 机制          | Python                   | TS（当前）                | 状态      |
| ------------- | ------------------------ | ------------------------- | --------- |
| LLM 重试      | 3次 + sleep              | ✅ `withRetry` 可配置重试 | 🟢 已实现 |
| JSON 解析错误 | 详细日志 + 保存到 .temp/ | 🟡 日志但不保存           | 🟡 简化   |
| 验证错误      | 错误列表返回             | ✅ 结构化错误列表         | 🟢 已对齐 |
| 优雅降级      | 返回部分结果             | ✅ 返回部分结果 + 默认值  | 🟢 已对齐 |

### 2.6 剩余差距

1. 🟡 `validate_input` 仍是 stub
2. 🟡 `generate_openspec` 无文件系统持久化
3. 🟡 `finalize` 无 PM 系统集成
4. 🟡 JSON 解析错误不保存到 .temp/

---

## 三、Coder（编码）

### 3.1 架构变更（重大更新）

TS 版采用了与 Python 完全不同的架构策略：

| 维度         | Python                                  | TS（当前）                                                          |
| ------------ | --------------------------------------- | ------------------------------------------------------------------- |
| **工具系统** | 19 个自定义工具（文件读写、代码分析等） | ✅ 复用 OpenClaw 25+ 内置工具（通过 `runEmbeddedPiAgent`）          |
| **执行器**   | 自建 `LoopExecutor`（1492 行）          | ✅ 复用 OpenClaw embedded agent（含 compaction、overflow recovery） |
| **完成信号** | 自定义退出条件                          | ✅ `clientTools` 注入 `task_complete`，agent 调用时 loop 停止       |

**设计决策**：不重复造轮子，直接复用 OpenClaw 的 embedded agent 基础设施。这意味着 Python 版的 19 个自定义工具、LoopExecutor、上下文压缩、卡死检测等功能由 OpenClaw agent 层提供，无需在 pipeline 层重新实现。

### 3.2 双 Coder 实现

| 实现                     | 说明                                                                 | 状态      |
| ------------------------ | -------------------------------------------------------------------- | --------- |
| `native-coder-node`      | 使用 `runEmbeddedPiAgent`，通过 `clientTools` task_complete 回传结果 | 🟢 已实现 |
| `claude-code-coder-node` | 包装 Claude CLI，适用于无 embedded agent 的环境                      | 🟢 已实现 |

两者通过 `CoderNodeOverrides.recursiveCoder` 依赖注入，共享同一个 coder workflow graph（prepare → coder → argue → finalize）。

### 3.3 工具能力对比（通过 embedded agent 间接获得）

| 维度         | Python（19 个自定义工具）                                                         | TS（OpenClaw 25+ 内置工具）                          | 状态        |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- |
| **文件读写** | ReadFileTool, WriteToFileTool, ReplaceInFileTool                                  | ✅ OpenClaw read_file, write_file, replace_in_file   | 🟢 已覆盖   |
| **文件搜索** | ListFilesTool, SearchFilesTool, RipgrepSearchTool                                 | ✅ OpenClaw list_files, search_files, ripgrep_search | 🟢 已覆盖   |
| **代码分析** | ListCodeDefinitionNamesTool, ProjectStructureAnalyzerTool, DependencyAnalyzerTool | ✅ OpenClaw list_code_definitions, project_structure | 🟢 已覆盖   |
| **代码质量** | SyntaxCheckerTool, CodeFormatterTool, LinterTool, CodeValidatorTool               | ✅ 通过 bash 工具执行 tsc/eslint/prettier            | 🟢 间接覆盖 |
| **测试执行** | StandardTestRunnerTool                                                            | ✅ 通过 bash 工具执行 vitest/jest                    | 🟢 间接覆盖 |
| **系统命令** | ExecuteCommandTool, GetSystemInfoTool                                             | ✅ OpenClaw bash, system_info                        | 🟢 已覆盖   |

### 3.4 Coder-Debugger 盲测循环 🔴 未实现

Python 版的核心 TDD 机制（96KB，`coder_debugger_loop.py`）在 TS 中完全缺失：

| 功能                        | Python                       | TS        |
| --------------------------- | ---------------------------- | --------- |
| Debugger 生成 Standard Test | ✅ 对 Coder 可见             | ❌ 缺失   |
| Debugger 生成 Full Test     | ✅ 对 Coder 不可见（盲测）   | ❌ 缺失   |
| 错误报告（仅失败测试可见）  | ✅ Debugger 生成             | ❌ 缺失   |
| Coder 修复循环              | ✅ max_refine_rounds=10      | ❌ 缺失   |
| Argue 机制                  | ✅ Coder/Debugger 分歧时触发 | 🟡 基础版 |

### 3.5 Argue 机制

| 维度           | Python                                                     | TS（当前）                            | 状态    |
| -------------- | ---------------------------------------------------------- | ------------------------------------- | ------- |
| **Argue 类型** | 多种（validation_failed/test_quality/requirement_unclear） | 2 种（validation_failed/low_quality） | 🟡 简化 |
| **检测方式**   | 3 种（exit_reason/action/flag）                            | 1 种（validation pass/fail）          | 🟡 简化 |
| **响应结构**   | 丰富（reason/test_issues/code_analysis/recommendation）    | 基础（type/details/suggestedAction）  | 🟡 简化 |

### 3.6 剩余差距

1. 🔴 **Coder-Debugger 盲测循环** — 核心 TDD 机制完全缺失
2. 🟡 Coder Prompt 可进一步丰富（架构上下文、骨架代码注入）
3. 🟡 Argue 机制可增强（ArgueManager、测试质量分析）
4. 🟡 代码生成/修复分离（独立 prompt）

---

## 四、整体 Pipeline 集成

### 4.1 管线阶段差异

| Python 阶段                    | TS 状态                        | 说明                           |
| ------------------------------ | ------------------------------ | ------------------------------ |
| `requirement_analysis`（专用） | ✅ 合并到 clarify_requirements | 信息收集+分析+调研已整合       |
| `requirement_decomposition`    | ✅ Chain A 有                  | 存在                           |
| `architecture_design`          | ✅ 存在                        | 节点实现已基本完整             |
| `task_decomposition`           | ❌ 缺失                        | Python 有专门的任务分解        |
| `skeleton_generation`          | ❌ 缺失                        | Python 生成代码骨架            |
| `coder`                        | ✅ 存在                        | 双实现（native + claude-code） |
| `coder_debugger_loop`          | ❌ 缺失                        | Python 96KB 核心 TDD 循环      |
| `verify_quality`               | ❌ 缺失                        | Python 有专门的质量验证        |
| `deadlock_detection`           | ❌ 缺失                        | Python 有 3 类死锁检测         |
| `stop_mechanism`               | ❌ 缺失                        | Python 有 stop.md 紧急制动     |

### 4.2 数据流差异

**Python**：

```
refined_requirement → architecture_description → task_tree → skeleton_files → code_files
```

**TS（Dev Pipeline）**：

```
userRequirement → clarifiedRequirement → architectureDesign → coderResults
```

**缺失的数据流**：

- ❌ `task_tree` — 任务分解中间产物
- ❌ `skeleton_files` — 代码骨架中间产物
- 🟡 `architectureDesign` 类型已结构化（不再是 `Record<string, unknown>`）

### 4.3 增量修改模式 🔴 未实现

Python 支持 `modify_existing` 场景，但 TS 缺少支撑基础设施：

| 需求                         | 状态    |
| ---------------------------- | ------- |
| 需求版本管理（修改前后对比） | ❌ 缺失 |
| 架构版本管理（修改前后对比） | ❌ 缺失 |
| 增量定位（文件夹位置）       | ❌ 缺失 |
| OpenSpec 全套文档关联        | ❌ 缺失 |
| PM 数据库关联                | ❌ 缺失 |

### 4.4 TS 做得更好的地方

| 特性                    | 说明                             |
| ----------------------- | -------------------------------- |
| **Chain 分离**          | A(开发)/B(Wiki)/C(迭代) 清晰分离 |
| **节点覆写注入**        | 依赖注入模式，方便测试           |
| **Step Hooks**          | 统一的横切关注点处理             |
| **ChainContext 容器**   | 集中化的依赖管理                 |
| **TypeScript 类型安全** | 编译时类型检查                   |
| **双 Coder 实现**       | native + claude-code CLI 可切换  |
| **复用 OpenClaw Agent** | 不重复造轮子，直接获得 25+ 工具  |

---

## 五、优先级排序（更新后）

### P0 — 核心功能缺失

1. ~~**Coder 工具系统**~~ ✅ 已通过 `runEmbeddedPiAgent` 解决
2. ~~**Coder RecursiveExecutor**~~ ✅ 已通过 embedded agent 解决
3. ~~**Coder 代码验证**~~ ✅ agent 有真实工具可执行 tsc/lint
4. ~~**Requirement Clarification 运作模式**~~ ✅ 已支持多轮对话
5. ~~**OpenSpec Proposal 格式**~~ ✅ 已基本符合标准
6. ~~**Architecture Design `refine_design`**~~ ✅ 已实现完整 LLM 修复
7. ~~**Architecture Design 验证打分**~~ ✅ 已实现 6 维度打分
8. ~~**架构模式库**~~ ✅ 已扩充至 22+ 模式

### P0（新）— 当前最高优先级

1. **Coder-Debugger 盲测循环** — Python 96KB 核心 TDD 机制，TS 完全缺失
2. **增量修改基础设施** — 需求/架构版本管理、增量定位、OpenSpec 文档关联
3. **PM 数据库** — 所有管线的中央枢纽，增量模式的前置依赖

### P1 — 重要功能缺失

4. **task_decomposition** — 任务分解阶段
5. **skeleton_generation** — 代码骨架生成
6. **research_agent** — 异步深度调研系统
7. **数据持久化** — collected_info、OpenSpec 文档写入文件系统
8. **Checkpoint 恢复** — 长流程状态持久化（LangGraph checkpointer）

### P2 — 改进项

9. **Coder Argue 增强** — ArgueManager、测试质量分析
10. **verify_quality** — 独立质量验证阶段
11. **死锁检测** — 防止无限循环
12. **Emergency stop** — stop.md 紧急制动机制
13. **validate_input** — 架构设计输入验证（当前 stub）
14. **PM 系统集成** — finalize 节点更新 PM 数据库
