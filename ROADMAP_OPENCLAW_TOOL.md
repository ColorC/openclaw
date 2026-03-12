# OpenClaw-Tool Implementation Roadmap

## 总体愿景 (The North Star)

将 Agent 的工具交互模式从“死板的预先声明 (Static Function Calling)” 升级为“符合直觉的渐进式探索 (Dynamic CLI-Centric Discovery)”。通过构建 `openclaw-tool` 中间件，激活模型预训练中庞大的 Bash 生态潜意识，实现极高的 Token 效率与专注度。

---

## 阶段一：核心骨架与拦截器原型 (Hours 0-12)

**目标：在不破坏现有底层架构的前提下，建立 `openclaw-tool` 的指令拦截与内存解析机制。**

### 1. 核心拦截层 (Middleware Interceptor)

- **定位：** `src/auto-reply/reply/bash-command.ts` (或 `src/agents/bash-tools.exec.ts`)。
- **逻辑：**
  - 在交给真实 `execa`/`spawn` 执行前，检查命令前缀是否为 `openclaw-tool`。
  - 如果是，则进入**内部模拟路由**，不产生实际的 Linux 子进程。
  - 这种“内存拦截”方式完美继承了当前进程的 `SessionKey`、`AgentId` 和所有沙盒权限控制。

### 2. 伪命令解析器 (CLI Argument Parser)

- **定位：** 新建 `src/agents/cli-runner/openclaw-tool-parser.ts`。
- **逻辑：**
  - 引入极轻量级的参数解析（如基于现有的 `commander` 或 `mri`）。
  - 支持将标准 CLI 语法转换回 JSON Schema。
  - 例如：`openclaw-tool feishu update --id 123 --content "hello"` 转换为 `{ id: "123", content: "hello" }`。

### 3. 工具映射注册表 (Tool Registry Bridge)

- **定位：** 新建 `src/agents/cli-runner/tool-registry-bridge.ts`。
- **逻辑：**
  - 维持现有 `AnyAgentTool` 接口不变。
  - 将选定的核心工具（如 `agents_list`, `feishu_update`）注册到该映射表中，声明其对应的 CLI 空间（如 `<community> <function>`）。
  - **可选性配置：** 读取 Agent 配置，决定哪些工具被暴露为 CLI 形式。

---

## 阶段二：动态 Help 系统与上下文接管 (Hours 12-24)

**目标：实现“实验特性 1”，彻底改变 `--help` 的输出行为，将其从 stdout 提升为系统级的 Schema 上下文。**

### 1. 拦截 `--help` 标志

- **逻辑：** 当解析器捕捉到 `--help` 或 `-h` 时，跳过工具的 `execute` 方法。
- **生成指南：** 动态读取该工具原本的 JSON Schema，反向生成标准的 Bash `--help` 文本。

### 2. 上下文重定向机制 (Context Redirection)

- **挑战：** 传统 `bash` 工具返回的是字符串（即 stdout）。我们需要将其转化为对模型 System Prompt / Tool Schema 的动态修补。
- **方案 A (Throw & Catch):** 抛出一个特定的 `ToolSchemaUpdateError(helpText)`，在外层 `auto-reply` 主循环捕获它，将其转化为一个特定的回复结构，指示大模型：“Schema 已更新，请重新调用”。
- **方案 B (Meta-Return):** 修改 `bash` 工具的返回格式，支持返回 `{ stdout: "...", _meta: { appendSchema: "..." } }`。外层处理逻辑识别 `_meta` 并静默更新上下文。_(推荐方案 B，对现有系统冲击最小)_

---

## 阶段三：模型认知与 Prompt 重构 (Hours 24-36)

**目标：让 Agent 知道并且习惯使用 `openclaw-tool`，停止向它灌输冗长的传统工具定义。**

### 1. 精简 Tool Catalog

- **定位：** `src/agents/tool-catalog.ts`。
- **逻辑：**
  - 增加一个“CLI Mode”开关。开启时，不再将具体的工具（如 `agents_list`）压入传递给 LLM 的 `tools` 数组。
  - 仅保留 `bash` 工具（以及必要的底层文件读写工具）。

### 2. 注入“塞尔达引导” (Zelda Prompting)

- **定位：** System Prompt 生成处（可能在 `src/auto-reply/system-prompt.ts` 或类似文件）。
- **逻辑：** 在系统提示词中增加：
  > "You are operating in a highly streamlined environment. Instead of calling separate functions, you have access to a universal command-line utility called `openclaw-tool`. Use `bash` to run `openclaw-tool --help` to discover available commands in your current context. Treat it exactly like `git` or `docker`."

---

## 阶段四：验证与生态兼容映射 (Hours 36-48)

**目标：跑通全链路，并证明该架构对外部插件/MCP 的兼容性。**

### 1. 跑通 Golden Path

- 验证流程：
  1. Agent 面对无工具状态，尝试输入 `openclaw-tool --help`。
  2. 系统拦截，静默更新 Schema（追加了如 `agents`, `feishu` 等模块级说明）。
  3. Agent 基于提示，输入 `openclaw-tool agents list`。
  4. 系统拦截，解析参数，调用内部 `agents_list` 函数，将结果以 stdout 格式返回给 Agent。

### 2. MCP 与插件的通用映射 (Generic Mapping)

- **逻辑设计：**
  - 探索如何将动态加载的 MCP 工具（如 `#35676` 中讨论的）自动装载到 `openclaw-tool <plugin-name>` 子命令下。
  - **原则：** 一切新插件，不需要写新的适配代码，只要它符合 JSON Schema，就能自动被转化为 CLI 参数（如 `--<property-name>`）。

---

## 阶段五（远期）：智能与动态化 (Future & Experimental)

**目标：实现自适应的工具呈现，彻底消除长尾 Token 消耗。**

### 1. 频次缓存 (LFU/LRU Command Cache)

- 记录模型调用最频繁的 `openclaw-tool` 子命令。
- 在后续对话中，自动在 Schema 中附带这些高频命令的简要说明，省去模型每次查询 `--help` 的步骤。

### 2. 语义嵌入匹配 (Semantic Schema Injection)

- 引入本地轻量级 Embedding 模型或 TF-IDF 匹配。
- 当模型在思维链 (thinking) 中表达“需要更新文档”时，系统在后台比对意图，自动将 `openclaw-tool feishu update` 的帮助信息“闪现”到下一个 Turn 的上下文中。
