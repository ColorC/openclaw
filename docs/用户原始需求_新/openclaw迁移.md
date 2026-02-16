personal copilot的核心理念是低监督的软件工厂，主要应用为：

1. Full Agentic Generation Project Management: 极大程度上由AI独立生成的项目的管理体系
   1. AI项目管理-PM系统
      1. Openspec based 计划和需求管理
      2. Compliance Check 规范注册系统和检验系统
      3. 版本，测试，质量管理（未实现
   2. AI-Gen Project Wiki:AI完成，同时面向AI和人类的项目知识体系管理
2. Full Agentic Common Software Generation:中大型通用软件新生成管线
   1. 需求澄清工作流
   2. 架构设计工作流
   3. SKILL增强，通用工作流设计工作流（未实现）
   4. TDD编程工作流（coder-debugger循环）（未完全实现）
3. Full Agentic Common Software Developing:中大型通用软件维护更新管线
   1. 变更需求澄清工作流（未完全实现）
   2. 架构变更工作流（未完全实现）
   3. TDD编程工作流（未完全实现）
   4. SKILL增强 通用工作流迭代工作流（未实现）
4. 低监督自我进化系统
   1. 多Agent间Argue系统（未完全实现）
   2. 运行-评估-补丁-评估的自迭代系统

预期中工作方式：
openclaw：接口层，AI服务层，AI框架层

1. 老板的监视窗，重要开发信息会通过该渠道汇报
   1. AI-IDE的另一种形式：可以通过feishu渠道向开发agent指示具体开发
2. 软件运行接口：新开发的软件，将可以通过该渠道（目前是打算通过feishu渠道）或者本地的网页服务启动
3. AI服务框架：所有基于AI的应用直接继承同一套LLM服务，记忆，工作流，node，SKILL，MCP体系（但要注意膨胀和分层，可以预见的，如果将每个内容都变成工具，工具数量可以飙升到上百个）
