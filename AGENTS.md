# Katarune Agent Guide

## 项目定位

言奏（Katarune）是一个以 Web 技术构建的数字角色 Harness。它组合模型、记忆、工具、语音与数字形体，并专注于角色体验、VRM 驱动、桌面能力和用户可控性。

开始工作前先阅读：

- `README.md`
- `docs/README.md`
- `docs/00-项目/项目定义.md`
- `docs/01-决策/决策记录.md`
- `docs/02-架构/技术选型.md`
- `docs/03-规划/路线图.md`
- `docs/04-开发/工程规范.md`

ATRI Chat 是参考实现、行为基准和资产来源，不是必须保持代码兼容的基础工程。言奏不迁移 ATRI Chat 的用户数据或旧文件记忆。

## 当前阶段

P1/P2 已完成，P3/P4 正在推进。模型、会话、角色资产、Memory Wiki、TTS 与离线 ASR 已有开发基线；Unity 桌面角色、Electron 胶囊/面板、动作/表情工具、对白音频与字幕也已接入。真人全双工语音、原生窗口体验、自动重连、最终动作资产和正式分发仍需验收或实现。进度与限制见[路线图](docs/03-规划/路线图.md)；未决事项未经任务授权不要提前用脚手架锁定。

## Agent Skills

项目使用仓库级 Agent Skills，使 Codex 等兼容 Agent 在不同电脑上获得一致的框架知识。

已安装来源：

- AI SDK：`vercel/ai`
- assistant-ui：`assistant-ui/skills`
- Unity：`Unity-Technologies/skills`，当前只按需安装 `unity-cli`

规范与官方入口：

- <https://ai-sdk.dev/docs/getting-started/coding-agents>
- <https://github.com/vercel/ai>
- <https://github.com/assistant-ui/skills>
- <https://github.com/Unity-Technologies/skills>
- <https://docs.unity3d.com/>
- <https://agentskills.io/home>
- <https://www.skills.sh/docs/cli>

### 新电脑恢复

`.agents/skills/` 与 `skills-lock.json` 属于项目开发配置，应纳入版本控制。如果 Skill 文件缺失或需要按锁文件恢复，在仓库根目录运行：

```powershell
npx skills experimental_install
npx skills list --json
```

不要以全局 Skill 代替项目级 Skill。所有新增 Skill 都只能安装到本仓库的 `.agents/skills/` 并写入 `skills-lock.json`，不得使用 `--global` / `-g`。不要批量安装当前任务无关的 Skill，也不要在普通功能任务中自动执行 `skills update`；Skill 安装和更新必须检查来源、风险提示、文件 diff 和锁文件变化后再接受。

### 使用规则

- AI SDK 相关任务必须使用 `.agents/skills/ai-sdk/SKILL.md`。
- assistant-ui 的跨领域问题先使用 `.agents/skills/assistant-ui/SKILL.md`，再按它的路由选择最具体的 Skill。
- 初次集成使用 `setup`；Runtime 与状态使用 `runtime`；UI 组合使用 `primitives`；工具及工具 UI 使用 `tools`；流协议使用 `streaming`；会话侧栏使用 `thread-list`；升级使用 `update`。
- Unity CLI、Editor 连接、构建或测试任务必须使用 `.agents/skills/unity-cli/SKILL.md`。
- Unity 6000.3.11f1 在含中文路径的 Windows 工程中，Pipeline 的 `eval` 会产生 `GetName()` 失败的 `PipelineEval_*` 动态程序集，可能导致 QuickInstaller 持续刷错。此组合下不要使用 `eval` / `eval_file`；其他会加载动态程序集的命令也须先验证。优先使用已注册的场景、播放、截图和测试命令；需要 C# 时使用正常编译的 Editor 脚本。出现该异常后须重载脚本域以卸载动态程序集，不能仅清空 Console 或屏蔽异常。详见工程规范的 Unity 编辑器排错记录。
- 讨论、规划、实现或评审某项 Unity 功能前，先读取项目的 `ProjectVersion.txt` 和 `Packages/manifest.json`，再查询与该版本和功能对应的 Unity 官方 Manual、Scripting API 或包文档；不得只依赖模型记忆或泛化教程。第三方包同时核对其官方上游文档和项目锁定源码。
- Unity 官方其他 Skill 只在当前任务明确涉及其领域且仓库尚未安装时，从 `Unity-Technologies/skills` 按单项安装到本仓库；不得为了备用一次性安装全部 Unity Skills。
- 只在任务确实涉及某一领域时加载对应 Skill，不要一次读取全部 Skills。
- 使用 Skill 时仍须核对项目锁定版本的 `node_modules` 源码、类型定义与官方文档。
- 不允许混用不同 AI SDK 或 assistant-ui 大版本的 API 示例。
- Skill 可以携带脚本和高权限操作。执行其脚本前必须确认与当前任务相关，并检查目标、参数和影响范围。

## 架构原则

- 言奏自身是产品 Harness，不重新发明通用 Agent Runtime。
- AI SDK 负责模型调用、工具调用、流式输出和基础 Agent 循环。
- assistant-ui 负责聊天交互框架与工具 UI 基础能力。
- 非核心能力优先采用成熟库、Provider、MCP、ACP 或其他现成实现。
- 框架已提供稳定类型、协议、生命周期或持久化格式时直接复用；不要建立镜像模型、重复转换层或没有真实迁移需求的兼容层。只在 SQLite、Electron IPC、安全边界和言奏特有领域语义处实现薄适配。
- 自研重点是角色、记忆策略、VRM、TTS/ASR 协调、桌面能力和安全策略。
- 密钥、文件系统、数据库和高权限工具不得放在不可信的 Electron renderer 边界内。
- TTS 与 ASR 是独立 Capability，不与 Agent 循环强耦合。
- 第一阶段只接入现有产品的核心能力，不提前扩展文件、终端或编码代理平台。

## 决策与文档

- 已决定、待决定和暂缓事项必须明确区分。
- 不要把候选方案写成当前事实。
- 新的架构选择先更新 `docs/01-决策/决策记录.md`。
- 当前系统边界变化时同步更新 `docs/02-架构/技术选型.md`。
- 路线和优先级变化时更新 `docs/03-规划/路线图.md`。
- README 只保留高层概览，详细说明进入现有 `docs/` 主题，不创建重复文档。

## 开发流程

每个实现任务遵循以下闭环：

1. 明确用户价值、范围、非目标和验收条件。
2. 读取项目文档并加载最相关的官方 Skill。
3. 根据锁定依赖的源码和类型确认实际 API。
4. 优先组合现成能力，只实现言奏特有部分。
5. 运行格式、类型、单元测试和必要的实际交互检查。
6. 仅在事实或决策发生变化时更新文档。

## 依赖升级

- AI SDK 与 assistant-ui 的升级必须是独立任务，不混入普通功能提交。
- 优先使用官方 dry-run、upgrade 和 codemod。
- 升级前记录当前版本，升级后检查 peer dependencies。
- 升级必须通过类型检查、测试和关键聊天/工具流验证。
- 同步更新包锁、`skills-lock.json` 和受影响的决策记录。

## 安全与变更范围

- 仓库可能包含用户未提交的修改，不回滚或覆盖无关改动。
- 不提交密钥、访问令牌、个人数据或真实供应商凭据。
- 删除、迁移数据和执行高权限工具前必须确认精确目标。
- 新依赖需要说明它解决的问题；已有框架能满足时不新增重复依赖。
