# Agent 协作开发

## Skill 在项目中的位置

Agent Skill 是提供给 Codex、Claude Code、Cursor 等编码 Agent 的过程知识，不属于言奏的运行时依赖，也不会被打包进最终应用。

一个 Skill 通常由 `SKILL.md`、参考资料、脚本和模板组成。编码 Agent 启动时只发现名称和描述；任务匹配时才加载完整说明。这种渐进式加载允许项目准备多个框架 Skill，而不会在每次任务中塞入全部文档。

言奏的开发知识分为三层：

1. **项目规则**：`AGENTS.md` 与 `docs/`，说明我们要做什么、边界是什么。
2. **框架技能**：官方 Agent Skills，说明某个外部框架应该怎样使用。
3. **版本事实**：锁文件、已安装包的源码和类型定义，说明当前项目实际安装了什么。

发生冲突时，项目决策约束产品边界，锁定版本的源码与类型定义约束具体 API。Skill 不能替代版本事实。

## 官方 Skills

当前项目已经将官方 Skills 安装到 `.agents/skills/`，并生成 `skills-lock.json`。以下命令保留为重新安装或审查来源时的参考。

### AI SDK

AI SDK 官方仓库提供 `ai-sdk` Skill，并提供独立的版本迁移 Skill。安装入口：

```powershell
npx skills add vercel/ai --agent codex --skill ai-sdk -y
```

当项目实际发生大版本升级时，再按需加入对应迁移 Skill，不提前加载迁移规则。

### assistant-ui

assistant-ui 维护一组细分 Skills，包括：

- `assistant-ui`：架构和任务路由。
- `setup`：安装、脚手架与 Runtime 选择。
- `runtime`：状态和 Runtime API。
- `primitives`：Thread、Message、Composer 等 UI 原语。
- `tools`：工具注册、工具 UI 与人工确认。
- `streaming`：流协议和后端连接。
- `thread-list`：多会话管理。
- `markdown`：Markdown、代码、数学公式和 Mermaid。
- `update`：依赖升级与 codemod。

安装入口：

```powershell
npx skills add assistant-ui/skills --agent codex --skill assistant-ui setup runtime primitives tools streaming thread-list markdown update -y
```

项目只安装当前阶段需要的核心子集。`cloud`、`copilots`、`react-mcp` 和 `observability` 等扩展在进入实际范围时再单独审查和安装。已安装的 Skills 也不会全部同时进入上下文；Agent 只在任务匹配时加载相关 Skill。

## 推荐接入方式

### 项目级安装

Skills 应安装在言奏项目内，而不是只安装到某位开发者的全局目录。项目应跟踪 `skills-lock.json`，让其他开发者和 CI 可以恢复相同来源的 Skills。

新电脑克隆项目后，如果 `.agents/skills/` 不完整，执行：

```powershell
npx skills experimental_install
npx skills list --json
```

安装或更新 Skill 前需要检查来源和变更内容。Skill 可以携带工作指令与脚本，不能把未经审查的第三方 Skill 当作普通文档直接信任。

### AGENTS.md 负责路由

根目录 `AGENTS.md` 不复制外部框架文档，只规定：

- 涉及 AI SDK 的实现必须使用官方 AI SDK Skill，并检查当前安装版本的源码和类型。
- 涉及 assistant-ui 的任务使用最具体的 Skill，例如工具 UI 使用 `tools`，线程侧栏使用 `thread-list`。
- 不凭模型记忆猜测快速迭代框架的 API。
- 框架能力能满足需求时，不在言奏内部创建重复抽象。
- 架构边界发生变化时，同步更新决策记录。

### 依赖升级单独进行

AI SDK 与 assistant-ui 的升级不混入普通功能任务。升级任务按以下顺序执行：

1. 读取官方更新与迁移 Skill。
2. 检查当前锁定版本和 peer dependencies。
3. 使用官方 dry-run、upgrade 或 codemod 工具预览变更。
4. 运行类型检查、单元测试和关键交互验证。
5. 更新锁文件、Skill 锁和相关决策记录。

assistant-ui 提供 `update --dry`、`upgrade`、具体 codemod 和 `info` 命令；它们应优先于手工批量替换。

## 在迭代中的工作流

每个功能任务采用一个轻量闭环：

1. **定义**：任务说明用户价值、范围、非目标和验收条件。
2. **定位**：编码 Agent 根据任务加载项目规则和最相关的官方 Skill。
3. **核实**：读取锁定版本的本地类型、源码或官方文档，确认 API。
4. **实现**：优先组合现成能力，只编写言奏特有的部分。
5. **验证**：运行格式、类型、测试和必要的实际交互检查。
6. **记录**：只有事实、边界或决策变化时才更新文档。

Skill 的作用是降低框架误用和重复研究成本；任务定义、验收标准、代码评审和测试仍然由言奏自己的工程规则负责。

## 当前版本注意事项

assistant-ui 当前提供 AI SDK v7 示例，而某些编辑器内置或缓存的 AI SDK Skill 仍可能描述 v6。开始编码前必须先锁定双方兼容版本，并让项目级 Skill、依赖锁和示例版本保持一致，不能混用不同大版本的调用方式。

## 相关入口

- [AI SDK：Getting Started with Coding Agents](https://ai-sdk.dev/docs/getting-started/coding-agents)
- [AI SDK GitHub](https://github.com/vercel/ai)
- [assistant-ui Skills](https://github.com/assistant-ui/skills)
- [assistant-ui CLI](https://www.assistant-ui.com/docs/cli)
- [Agent Skills 规范](https://agentskills.io/home)
- [Skills CLI](https://www.skills.sh/docs/cli)
