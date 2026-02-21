# 变更管线设计 v2

## 核心理念

变更管线不是一个独立的系统，而是对现有 greenfield 管线的扩展。核心思想：

**一个项目只有一套 openspec，变更是对 openspec 的增量修改，不是创建平行文档。**

旧设计的问题：提出了 change-request.md、impact-analysis.md、change-plan.md、regression-tests.md 四个新文档——这恰恰制造了"杂乱文件"。正确做法是：变更需求更新 proposal.md，架构变化更新 design.md，任务变化更新 tasks.md，测试场景更新 spec.md。

## 设计原则

1. **规范即真相 (Spec as Source of Truth)**
   - openspec 是项目的唯一权威描述
   - 任何代码变更必须先反映在 openspec 中
   - 代码与 openspec 的偏差即为 bug

2. **增量更新，不创建平行文档**
   - 变更后的 design.md 替换旧的 design.md
   - 通过 git diff 追踪变更历史
   - 不需要 change-request.md 等中间产物

3. **精准定位 (Surgical Precision)**
   - 变更分析必须定位到具体的 module/interface/scenario
   - TDD pipeline 只重新生成受影响的部分
   - 未受影响的代码和测试保持不变

4. **架构守护 (Architecture Guard)**
   - 每次变更前后对比 design.md 的结构完整性
   - 检测模块职责膨胀、循环依赖、接口不一致
   - 拒绝破坏架构约束的变更

## 流程

```
输入:
├── 现有项目 workspace（含代码 + openspec/ + tests/）
├── 变更需求（自然语言）
└── 现有 openspec 文档（proposal.md, design.md, tasks.md, spec.md）

Phase 1: 代码快照 (Snapshot)
├── 扫描现有代码结构（文件树 + 公开接口）
├── 与 design.md 对比，检测偏差
└── 输出: snapshot.json（当前代码的结构化描述）

Phase 2: 影响分析 (Impact Analysis)
├── 输入: 变更需求 + snapshot.json + 现有 design.md
├── LLM 分析: 哪些 modules/interfaces/scenarios 受影响
├── 分类: add（新增）/ modify（修改）/ deprecate（废弃）/ unchanged（不变）
└── 输出: impact.json（结构化影响清单，不是 markdown 文件）

Phase 3: 规范更新 (Spec Evolution)
├── 输入: impact.json + 现有 openspec 四件套
├── 更新 proposal.md: 追加变更背景和新目标
├── 更新 design.md: 修改/新增/废弃 modules 和 interfaces
├── 更新 tasks.md: 生成变更任务（仅受影响部分）
├── 更新 spec.md: 新增/修改测试场景，保留回归场景
├── 架构守护检查: 职责膨胀？循环依赖？接口一致性？
└── 输出: 更新后的 openspec/ 四件套（原地替换）

← 人工 Review 断点: 检查更新后的 openspec 文档

Phase 4: 增量 TDD (Delta TDD)
├── 从 impact.json 提取受影响的 interfaces
├── 只为变更部分生成/更新 stubs
├── Test Agent: 只写新增/修改的测试，保留已有测试
├── Code Agent: 只修改受影响的文件，不碰其他代码
├── 回归验证: 运行全部测试（新 + 旧）
└── 输出: 修改后的代码 + 测试

← 人工 Review 断点: 检查代码变更

Phase 5: 快照更新 (Snapshot Update)
├── 更新 snapshot.json 反映变更后的代码结构
├── 更新 SQLite 架构快照
└── git commit（openspec + code + tests 一起提交）
```

## 数据结构

### snapshot.json — 代码结构快照

```python
@dataclass
class CodeSnapshot:
    """当前代码库的结构化描述。"""
    project_name: str
    root_path: str
    modules: list[SnapshotModule]
    timestamp: str

@dataclass
class SnapshotModule:
    """一个模块的快照。"""
    name: str
    file_path: str                    # 相对路径
    classes: list[SnapshotClass]
    functions: list[SnapshotFunction]
    imports: list[str]                # 外部依赖
    line_count: int

@dataclass
class SnapshotClass:
    name: str
    methods: list[str]                # 方法签名
    bases: list[str]                  # 基类

@dataclass
class SnapshotFunction:
    name: str
    signature: str                    # 完整签名
    decorators: list[str]
```

snapshot.json 是纯粹的代码分析产物，不需要 LLM，用 AST 解析生成。它的作用是让 LLM 在 Phase 2 中精准理解现有代码结构，而不需要读取全部源码。

### impact.json — 影响清单

```python
@dataclass
class ImpactAnalysis:
    """变更影响分析结果。"""
    change_summary: str               # 一句话描述变更
    affected_modules: list[ModuleImpact]
    affected_interfaces: list[InterfaceImpact]
    affected_scenarios: list[ScenarioImpact]
    new_modules: list[NewModuleSpec]
    architecture_warnings: list[str]  # 架构守护警告

@dataclass
class ModuleImpact:
    module_id: str                    # 对应 design.md 中的 module id
    module_name: str
    change_type: str                  # "modify" | "deprecate"
    reason: str
    affected_responsibilities: list[str]

@dataclass
class InterfaceImpact:
    interface_id: str                 # 对应 design.md 中的 interface id
    interface_name: str
    change_type: str                  # "modify" | "add" | "deprecate"
    old_signature: str | None         # 修改前（modify/deprecate 时有值）
    new_signature: str | None         # 修改后（modify/add 时有值）
    reason: str

@dataclass
class ScenarioImpact:
    scenario_id: str                  # 对应 spec.md 中的 scenario id
    change_type: str                  # "modify" | "add" | "deprecate"
    reason: str

@dataclass
class NewModuleSpec:
    name: str
    file_path: str
    description: str
    responsibilities: list[str]
```

impact.json 是内部中间产物，不暴露给用户，不持久化为 markdown。它只在 Phase 2 → Phase 3 之间传递。

## 架构守护 (Architecture Guard)

每次 Phase 3 更新 design.md 后，运行以下检查：

```python
def check_architecture_health(design: OpenSpecDesign) -> list[str]:
    """检查架构健康度，返回警告列表。"""
    warnings = []

    # 1. 职责膨胀: 单个模块 responsibilities > 5
    for mod in design.modules:
        if len(mod.responsibilities) > 5:
            warnings.append(
                f"模块 {mod.name} 职责过多 ({len(mod.responsibilities)})，考虑拆分"
            )

    # 2. 循环依赖检测
    dep_graph = {m.id: m.dependencies for m in design.modules}
    cycles = detect_cycles(dep_graph)
    for cycle in cycles:
        warnings.append(f"循环依赖: {' → '.join(cycle)}")

    # 3. 孤立模块: 没有被任何其他模块依赖，也不依赖任何模块
    all_deps = set()
    for m in design.modules:
        all_deps.update(m.dependencies)
    for mod in design.modules:
        if mod.id not in all_deps and not mod.dependencies:
            if len(design.modules) > 1:  # 单模块项目不算
                warnings.append(f"模块 {mod.name} 是孤立的，无依赖关系")

    # 4. 接口-模块一致性: 每个 interface 的 module_id 必须存在
    module_ids = {m.id for m in design.modules}
    for intf in design.interfaces:
        if intf.module_id not in module_ids:
            warnings.append(
                f"接口 {intf.name} 引用了不存在的模块 {intf.module_id}"
            )

    # 5. 模块无接口: 模块存在但没有任何接口定义
    modules_with_interfaces = {i.module_id for i in design.interfaces}
    for mod in design.modules:
        if mod.id not in modules_with_interfaces:
            warnings.append(f"模块 {mod.name} 没有定义任何接口")

    return warnings
```

架构守护不阻断流程，而是在 Phase 3 输出中附带警告。人工 review 时可以决定是否修正。

## 与现有系统的集成

### PM CLI 扩展

```bash
# 变更管线（新增命令）
python3 -m toyshop.pm_cli change-create --name <project> --workspace <dir> --input <change_req>
python3 -m toyshop.pm_cli change-analyze --batch <dir>    # Phase 1+2: snapshot + impact
python3 -m toyshop.pm_cli change-spec    --batch <dir>    # Phase 3: 更新 openspec
# ← Review 更新后的 openspec
python3 -m toyshop.pm_cli tdd            --batch <dir>    # Phase 4: 复用现有 tdd 命令
# ← Review 代码变更
python3 -m toyshop.pm_cli change-commit  --batch <dir>    # Phase 5: 快照更新 + 提交
```

注意：Phase 4 直接复用现有的 `tdd` 命令。区别在于 workspace 中已有代码和测试，TDD pipeline 需要感知这一点（增量模式）。

### TDD Pipeline 增量模式

现有 `run_tdd_pipeline()` 需要一个 `mode` 参数：

```python
def run_tdd_pipeline(
    workspace: Path,
    llm: LLM,
    log_dir: Path | None = None,
    mode: str = "create",          # "create" | "modify"
    impact: ImpactAnalysis | None = None,  # modify 模式下的影响清单
) -> TDDResult:
```

`mode="modify"` 时的行为差异：

| Phase            | create 模式           | modify 模式                                     |
| ---------------- | --------------------- | ----------------------------------------------- |
| Phase 1 签名提取 | 全量提取 → 生成 stubs | 只提取 impact 中的变更接口 → 更新 stubs         |
| Phase 2 测试生成 | 全量生成              | 只生成变更部分的测试，保留已有测试              |
| Phase 3 代码生成 | 全量实现              | 只修改受影响文件，Code Agent 收到 impact 上下文 |
| Phase 4 验证     | 运行新测试            | 运行全部测试（回归 + 新增）                     |
| Phase 5 黑盒     | 全量生成              | 只生成变更场景的黑盒测试                        |

### Batch 目录结构（变更模式）

```
<batch_dir>/
├── requirements.md              # 变更需求（不是完整需求）
├── progress.json
├── snapshot.json                # Phase 1 输出: 代码快照
├── impact.json                  # Phase 2 输出: 影响清单
├── openspec/                    # Phase 3 输出: 更新后的完整 openspec
│   ├── proposal.md              # 追加了变更内容
│   ├── design.md                # 更新了 modules/interfaces
│   ├── tasks.md                 # 变更任务
│   └── spec.md                  # 更新了 scenarios
├── workspace/                   # Phase 4: TDD workspace
│   ├── openspec/                # 复制自上面
│   ├── <project>/               # 从原项目复制，TDD 在此修改
│   └── tests/                   # 从原项目复制，TDD 在此追加
├── agent_logs/
└── result.json
```

关键区别：workspace 不是空的，而是从原项目复制过来的完整代码。

## 新增文件

| 文件                        | 职责                    | 约行数 |
| --------------------------- | ----------------------- | ------ |
| `toyshop/snapshot.py`       | AST 代码快照生成        | ~120   |
| `toyshop/impact.py`         | LLM 影响分析 + 架构守护 | ~200   |
| `toyshop/spec_evolution.py` | LLM 增量更新 openspec   | ~250   |

## 修改文件

| 文件                      | 变更                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `toyshop/pm.py`           | 新增 `create_change_batch()`, `run_change_analysis()`, `run_spec_evolution()` |
| `toyshop/pm_cli.py`       | 新增 `change-create`, `change-analyze`, `change-spec`, `change-commit` 命令   |
| `toyshop/tdd_pipeline.py` | `run_tdd_pipeline()` 增加 `mode` + `impact` 参数，各 Phase 支持增量           |

## 不新增的东西

- 不新增 openspec 文档类型（没有 change-request.md 等）
- 不新增 Agent 类型（复用现有 Test/Code/Debug Agent）
- 不新增 Tool 类型（复用现有 file_editor/terminal/glob/grep）
- 不新增数据库表（复用现有 snapshots 表）

## 验收场景

用 ToyShop 自身作为测试目标（伪自举）：

**场景 1: 为 snapshot.py 添加 import 分析**

- 输入: 现有 toyshop 代码 + "为 snapshot.py 添加 import 依赖图分析"
- 预期: design.md 中 snapshot 模块新增 `analyze_imports()` 接口
- 预期: spec.md 新增 import 分析的测试场景
- 预期: 只修改 snapshot.py，不碰其他文件

**场景 2: 重构 tdd_pipeline.py 拆分 Phase**

- 输入: "将 tdd_pipeline.py 的各 Phase 拆分为独立模块"
- 预期: design.md 新增多个模块，原 tdd_pipeline 模块标记为 facade
- 预期: 架构守护检测到模块数量增加，提示确认
- 预期: 所有现有测试继续通过（回归）

**场景 3: 添加新的 debug 策略**

- 输入: "添加基于 mutation testing 的 debug 策略"
- 预期: design.md 新增 mutation_debug 模块和接口
- 预期: 不修改现有 debug 子系统的接口
- 预期: tasks.md 只包含新模块的任务
