# Katarune Agent Guide

本文件面向参与开发的 coding agent。面向读者的产品介绍见 [README](README.md)，当前进度与验收边界见 [路线图](docs/03-规划/路线图.md)。

Katarune 的长期愿景是能与人共同生活、感知和探索世界的数字生命。电脑、虚拟世界和未来的实体躯体都是其活动载体；桌面聊天与角色显示是当前阶段的实现。

产品讨论和对外文案应表达这一愿景，同时明确区分当前能力与尚未实现的目标。长期愿景不自动扩大具体任务的实现范围；未经任务授权，不提前锁定游戏、虚拟世界或实体躯体的技术方案。

## 开始工作

1. 先检查工作区差异，保护用户已有修改，不回滚、覆盖或提交无关内容。
2. 明确本次用户价值、范围、非目标和可观察的验收条件；只实现已授权的任务，不提前用脚手架锁定待决定事项。
3. 首次进入仓库先阅读以下文档。后续按任务查阅相关章节；长文档按目录分段读取，避免截断遗漏。

| 文档 | 用途 |
| --- | --- |
| [README](README.md)、[文档导航](docs/README.md) | 项目概览与资料入口 |
| [项目定义](docs/00-项目/项目定义.md) | 产品定位与非目标 |
| [决策记录](docs/01-决策/决策记录.md) | 已决定、待决定、暂缓及历史替代关系 |
| [技术选型](docs/02-架构/技术选型.md) | 系统边界与依赖基线 |
| [路线图](docs/03-规划/路线图.md) | 当前进度、优先级与待验收范围 |
| [工程规范](docs/04-开发/工程规范.md) | 代码、验证、构建与提交规则 |

桌宠窗口、输入和字幕任务同时阅读 [桌面交互设计](docs/00-项目/桌面交互设计.md)。文档中的历史验证不代表当前实现；核对现行设计、代码和锁文件，发现不一致时明确指出。

## 代码导航

| 路径 | 职责 |
| --- | --- |
| `src/main/` | 可信 Harness、模型调用、数据、资产、凭据与桌面控制 |
| `src/preload/` | 最小 IPC 桥接 |
| `src/renderer/` | React、assistant-ui 与桌面界面 |
| `src/shared/` | 跨进程契约；IPC Schema 入口为 `src/shared/ipc.ts` |
| `unity/KataruneAvatar/` | 独立 Unity 角色运行时 |
| `tests/`、`scripts/` | 自动化验证与开发、构建入口 |

## 实现原则与安全边界

- Katarune 是数字伙伴产品的 Harness。AI SDK 负责模型、工具、流式输出与基础 Agent 循环；assistant-ui 负责聊天 Runtime 和交互。自研集中在角色、记忆策略、VRM、语音协调、桌面能力和用户控制。
- 优先组合成熟库、Provider 与现有协议。直接复用框架的类型、消息格式、生命周期和持久化 adapter；只在 SQLite、Electron IPC、安全边界及产品语义处做薄适配，不建立镜像模型、重复 Runtime 或没有真实迁移需求的兼容层。
- 密钥、文件系统、数据库和高权限工具留在可信 main process 或受控子进程。renderer 通过最小 preload 接口访问，不获得真实凭据或文件路径权限，不信任其提交的模型、角色归属或授权信息。
- 外部输入、持久化数据、IPC 和工具参数必须进行运行时校验。共享 Zod Schema 是结构和类型的单一来源；不要用类型断言或关闭严格检查绕过边界。
- TTS 与 ASR 保持独立 Capability。Unity 负责角色实际加载、动作、音频播放和字幕时钟；宿主提交高层意图，不绕过其 Facade 直接操纵骨骼或复制运行状态。
- 当前范围以项目定义和任务为准，不顺带扩展为文件、终端、编码代理或跨 Harness 平台；不为旧项目建立无真实需求的兼容层，不进行未经任务授权的历史数据或记忆迁移。
- 不将密钥、Token、个人数据、真实供应商响应或本地绝对路径写入源码、测试夹具和日志。删除、迁移数据或执行高权限工具前，确认精确目标和影响范围；不通过删库或削弱校验掩盖失败。
- 新依赖必须解决明确问题并说明采用理由，提交对应锁文件。已有框架能满足时不新增重复依赖；不混入无关格式化、构建产物或用户本地素材。

## 按任务使用项目级 Skills

只加载任务相关的 Skill，入口为 `.agents/skills/<name>/SKILL.md`：

| 任务 | 必用 Skill |
| --- | --- |
| AI SDK 模型、工具、流式输出与 Agent | `ai-sdk` |
| assistant-ui 跨领域问题 | 先读 `assistant-ui`，再按其路由选择具体 Skill |
| Unity CLI、Editor 连接、构建或测试 | `unity-cli` |

assistant-ui 路由：初次集成 `setup`；Runtime/状态 `runtime`；UI 组合 `primitives`；Markdown `markdown`；工具及工具 UI `tools`；流协议 `streaming`；会话侧栏 `thread-list`；升级 `update`。

- Skill 不替代版本核对。实现前检查 `package.json`、锁文件、项目锁定的 `node_modules` 源码、类型定义与对应官方文档，不混用不同 AI SDK 或 assistant-ui 大版本示例。
- `.agents/skills/` 与 `skills-lock.json` 纳入版本控制。新增 Skill 仅安装到本仓库并更新锁文件，不使用 `--global` / `-g`，不以全局 Skill 替代项目级 Skill。
- AI SDK 来源为 `vercel/ai`，assistant-ui 来源为 `assistant-ui/skills`，Unity 来源为 `Unity-Technologies/skills`。Unity Skill 只按当前任务需要单项安装，不批量预装。
- 普通功能任务不自动执行 `skills update`。安装或更新时检查来源、风险提示、文件 diff 和锁文件变化；执行 Skill 脚本前检查目标、参数和影响范围。

在新电脑上缺少 Skill 文件或需要按锁文件恢复时，从仓库根目录运行：

```powershell
npx skills experimental_install
npx skills list --json
```

## Unity 特别规则

- 讨论、规划、实现或评审 Unity 功能前，先读取 `unity/KataruneAvatar/ProjectSettings/ProjectVersion.txt` 和 `unity/KataruneAvatar/Packages/manifest.json`，再查询对应版本的 Unity 官方 Manual、Scripting API 或包文档。第三方包同时核对官方上游文档和项目锁定源码，不只依赖模型记忆或泛化教程。
- Unity `6000.3.11f1`、Pipeline `0.8.0-exp.1` 与 Windows 中文工程路径的组合禁用 `eval` / `eval_file`；其他加载动态程序集的命令也须先验证。优先使用已注册的场景、播放、截图和测试命令；需要 C# 时写正常编译的 Editor 脚本。
- 此组合下 `PipelineEval_*` 动态程序集可能发生 `GetName()` 失败，导致 QuickInstaller 持续刷错。恢复须保存场景并重载脚本域或重启 Editor，以卸载动态程序集；不能只清空 Console、屏蔽异常或修改 PackageCache。细节见工程规范的 Unity 编辑器排错记录。

## 验证与交付

以 `package.json` 和工程规范为命令来源，按变更风险选择实际检查：

| 变更 | 常用验证入口 |
| --- | --- |
| TypeScript 与业务行为 | `npm run typecheck`、`npm test` |
| 数据、迁移与恢复 | `npm run test:database` |
| 凭据边界 | `npm run test:credentials` |
| Electron 界面与消息链路 | `npm run test:ui`（包含构建） |
| 生产构建 | `npm run build`（包含类型检查） |
| 角色包、Unity、语音、安装与分发 | 查工程规范中的对应集成入口与资源前置条件 |

- 纯文档改动检查差异、链接和命令准确性即可。仓库没有统一格式化/Lint 脚本，不声称未提供或未运行的检查已通过。
- 测试优先覆盖实际业务路径的数据保持、安全、状态切换和失败恢复；可逆文案、样式不新增实现镜像或源码字符串断言测试。
- `test:ai:*` 等真实供应商测试可能产生费用，不进入普通测试；只有任务已授权且本地测试凭据可用时执行，不输出密钥和真实回复内容。
- 自动化、真实供应商/Player 联调与使用者实机验收分别报告。构建成功、截图存在、隐藏窗口测试或隔离安装载荷不等于最终界面、真人语音或完整安装后体验通过。
- 交付说明写清改了什么、实际执行的验证以及仍未验证的范围。提交遵循 Conventional Commits；提交前检查暂存差异和敏感信息，只纳入本任务内容。

## 依赖升级与文档维护

- AI SDK 与 assistant-ui 升级必须作为独立任务，不夹带在普通功能变更中。先记录现有版本，优先官方 dry-run、upgrade 和 codemod；升级后核对 peer dependencies，通过类型、测试和关键聊天/工具流验证，同步包锁、`skills-lock.json` 及受影响决策。
- 新架构选择先更新决策记录；系统边界变化同步技术选型；路线或优先级变化同步路线图。仅事实或决策变化时更新文档，不另建重复说明。
- README 面向首次了解项目的读者，重点是产品体验、使用入口与文档导航。阶段与平台只作简短说明；内部实现、开发进度和验收记录进入现有 `docs/` 主题。数据说明使用读者能理解的语言，不展开数据库、存储格式或加密实现。
- 明确区分已决定、待决定、暂缓和已废弃；不把候选方案写成当前事实，也不把未经验证的实现标为已验收。
