# Agent 协作开发

项目规则以仓库根目录 [AGENTS.md](../../AGENTS.md) 为入口；本页说明框架 Skill 与项目事实的关系。

## 三层依据

1. `AGENTS.md` 与 `docs/` 决定言奏的产品和工程边界。
2. `.agents/skills/` 提供 AI SDK、assistant-ui、Unity 等外部框架的工作方法，按任务加载。
3. 锁文件、已安装源码和类型定义决定当前版本的真实 API。

Skill 是编码 Agent 的开发知识，不进入应用 Runtime。框架示例与项目锁定版本不一致时，以当前源码、类型和测试核实具体 API；项目决策仍约束产品边界。

## 使用与维护

- 使用哪个 Skill、如何在新电脑恢复以及安装/更新限制，见 [AGENTS.md](../../AGENTS.md#agent-skills)。
- AI SDK 与 assistant-ui 的依赖升级单独实施，先审查迁移命令与 diff，再运行类型、测试和关键交互检查。
- 功能任务按定义范围、核实版本、实现、验证、仅在事实变化时更新文档的顺序推进；验收以实际运行证据为准。

外部入口：[AI SDK](https://ai-sdk.dev/docs/getting-started/coding-agents) · [assistant-ui Skills](https://github.com/assistant-ui/skills) · [Agent Skills 规范](https://agentskills.io/home)。
