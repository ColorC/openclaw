# 变更管线设计

## 背景

当前 ToyShop 只支持"绿地项目"(Greenfield) - 从零开始创建新项目。
实际开发中更常见的是"棕地项目"(Brownfield) - 对已有代码进行增量变更。

## 目标

设计一个**变更管线**，能够：

1. 分析现有代码库
2. 根据变更需求生成增量 OpenSpec 文档
3. 识别架构变化点
4. 生成代码变更（diff 或直接修改）

## 产物

### 1. 变更 OpenSpec 文档

| 文档                           | 描述                            |
| ------------------------------ | ------------------------------- |
| `openspec/change-request.md`   | 变更请求文档（类似 proposal）   |
| `openspec/impact-analysis.md`  | 影响分析（哪些模块/文件受影响） |
| `openspec/change-plan.md`      | 变更计划（任务分解）            |
| `openspec/regression-tests.md` | 回归测试场景                    |

### 2. 架构变化

```yaml
# impact-analysis.md 示例
affected_modules:
  - module: coding_agent.py
    change_type: modify
    changes:
      - "添加 ChangeAgent 支持"
      - "新增 diff 应用功能"

  - module: __init__.py
    change_type: modify
    changes:
      - "导出新的变更 API"

new_modules:
  - module: change_agent.py
    description: "变更管理 Agent"

deprecated:
  - module: legacy_pipeline.py
    reason: "被新的 Agent 架构替代"
```

### 3. 文件代码变化

```python
# 方案 A: 生成 diff 文件
changes/
├── coding_agent.py.patch    # unified diff
├── __init__.py.patch
└── change_agent.py          # 新文件完整内容

# 方案 B: 直接修改（由 Agent 执行）
# Agent 使用 file_editor 工具直接修改文件
```

## 流程

```
┌─────────────────────────────────────────────────────────────┐
│                     Change Pipeline                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  输入:                                                       │
│  ├── 现有代码库 (workspace)                                  │
│  ├── 变更需求 (change_request)                               │
│  └── 可选: 现有 OpenSpec 文档                                │
│                                                              │
│  阶段 1: 分析 (Analysis Agent)                               │
│  ├── 读取现有代码结构                                        │
│  ├── 解析现有 OpenSpec（如有）                               │
│  └── 生成 change-request.md                                  │
│                                                              │
│  阶段 2: 影响分析 (Impact Agent)                             │
│  ├── 识别受影响的模块                                        │
│  ├── 评估架构变化                                            │
│  └── 生成 impact-analysis.md                                 │
│                                                              │
│  阶段 3: 变更计划 (Planning Agent)                           │
│  ├── 分解变更任务                                            │
│  ├── 排序依赖关系                                            │
│  └── 生成 change-plan.md                                     │
│                                                              │
│  阶段 4: 执行变更 (Change Agent)                             │
│  ├── 应用代码修改                                            │
│  ├── 创建新文件                                              │
│  ├── 修改现有文件                                            │
│  └── 生成 regression-tests.md                                │
│                                                              │
│  阶段 5: 验证 (Verification Agent)                           │
│  ├── 运行现有测试（回归）                                    │
│  ├── 运行新测试                                              │
│  └── 生成变更报告                                            │
│                                                              │
│  输出:                                                       │
│  ├── openspec/change-request.md                              │
│  ├── openspec/impact-analysis.md                             │
│  ├── openspec/change-plan.md                                 │
│  ├── openspec/regression-tests.md                            │
│  └── 代码变更（已应用或 patch 文件）                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 测试用例

### 场景：为 ToyShop 添加变更管理能力

**变更需求:**

```
为 ToyShop 添加变更管线支持，使其能够对已有代码进行增量变更。

具体要求：
1. 添加 ChangeAgent 类，用于管理变更流程
2. 添加影响分析功能，识别哪些文件需要修改
3. 生成变更 OpenSpec 文档（change-request, impact-analysis, change-plan）
4. 支持生成 patch 文件或直接应用变更
5. 添加回归测试生成

变更应保持与现有 Agent 架构的一致性。
```

**预期产物:**

1. `openspec/change-request.md` - 变更需求文档
2. `openspec/impact-analysis.md` - 影响分析
3. `openspec/change-plan.md` - 变更计划
4. `openspec/regression-tests.md` - 回归测试
5. 新文件: `toyshop/change_agent.py`
6. 修改文件: `toyshop/__init__.py`, `toyshop/coding_agent.py`

## 实现计划

### Phase 1: 定义变更 OpenSpec Schema

```python
# toyshop/openspec/types.py (新增)

class ChangeRequest(BaseModel):
    """变更请求"""
    target_codebase: str        # 目标代码库路径
    change_description: str     # 变更描述
    change_type: ChangeType     # feature/bugfix/refactor/deprecation
    priority: Priority          # must/should/could

class ImpactAnalysis(BaseModel):
    """影响分析"""
    affected_modules: list[AffectedModule]
    new_modules: list[NewModule]
    deprecated_modules: list[DeprecatedModule]
    breaking_changes: list[BreakingChange]
    estimated_effort: str       # 预估工作量

class ChangePlan(BaseModel):
    """变更计划"""
    tasks: list[ChangeTask]
    execution_order: list[str]  # 任务执行顺序
    rollback_plan: str          # 回滚计划
```

### Phase 2: 实现 ChangeAgent

```python
# toyshop/change_agent.py (新文件)

CHANGE_AGENT_SYSTEM_PROMPT = """You are an expert software architect...
Your task is to analyze existing code and plan incremental changes.
"""

def create_change_agent(llm: LLM) -> Agent:
    return Agent(
        llm=llm,
        tools=[
            {"name": "file_editor"},  # 读取代码
            {"name": "terminal"},     # 运行分析命令
            {"name": "glob"},         # 查找文件
            {"name": "grep"},         # 搜索代码
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": CHANGE_AGENT_SYSTEM_PROMPT},
    )

def run_change_workflow(
    target_workspace: str | Path,
    change_request: str,
    llm: LLM | None = None,
) -> ChangeResult:
    """运行变更工作流"""
    ...
```

### Phase 3: 添加变更工具

```python
# toyshop/tools/analyze_codebase.py (新文件)

class AnalyzeCodebaseTool(ToolDefinition):
    """分析代码库结构"""
    ...

# toyshop/tools/generate_impact.py (新文件)

class GenerateImpactTool(ToolDefinition):
    """生成影响分析"""
    ...

# toyshop/tools/apply_change.py (新文件)

class ApplyChangeTool(ToolDefinition):
    """应用代码变更"""
    ...
```

## API 设计

```python
from toyshop import (
    # 现有 API (绿地项目)
    run_toyshop_workflow,
    run_coding_workflow,

    # 新增 API (棕地项目)
    run_change_workflow,
    analyze_codebase,
    generate_impact_analysis,
    apply_changes,
)
```

## 验收标准

1. ✅ 能够分析现有代码库结构
2. ✅ 生成完整的变更 OpenSpec 文档套件
3. ✅ 准确识别受影响的模块和文件
4. ✅ 生成的代码变更可编译/运行
5. ✅ 回归测试覆盖关键功能
