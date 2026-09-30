# 言奏 Katarune

> 让语言拥有记忆、声音与形体。

言奏（Katarune）是一款面向数字角色与桌面陪伴场景的本地优先 AI 应用。它以对话为主要入口，将用户选择的模型、角色设定、工具、语音与数字资产组合为可持续存在的角色体验。

项目目前处于 **P3/P4 开发中的桌面 Alpha**。P1 技术验证与 P2 最小垂直闭环已经完成，但它还不是面向普通用户发布的稳定产品，仓库当前也没有公开发行版。

![言奏角色配置界面](docs/assets/katarune-character-editor.png)

## 为什么做言奏

通用模型、Agent Runtime 和聊天组件已经有成熟实现。言奏不打算重新发明这些基础设施，而是在 AI SDK 与 assistant-ui 之上构建一套数字角色 Harness，重点解决：

- 角色身份、模型、上下文与行为如何稳定组合。
- 对话如何连接声音、资产以及未来的数字形体。
- 用户如何控制供应商、数据、工具权限与行为偏好。
- 本地桌面环境中的数据、安全凭据和高权限能力如何隔离。

ATRI Chat 是产品行为和资产参考，不是需要保持代码或数据兼容的基础工程。言奏不会迁移 ATRI Chat 的用户数据、会话或旧文件记忆。

## 当前能力

- Electron 桌面应用，使用 AI SDK 与 assistant-ui 提供模型配置、流式对话、工具调用、多会话和本地恢复。
- 按角色隔离的资产、附件与 Markdown Memory Wiki；凭据由受信任的 main process 加密管理。
- OpenAI、Google Gemini 与 Fish Audio TTS；SenseVoiceSmall INT8 离线听写和 Silero 自动断句。
- Windows 开发环境中的 Unity VRM 角色、动作/表情工具、对白音频、字幕与口型；Electron 胶囊和面板负责桌面控制。
- Windows x64 unpacked 与无签名 NSIS 构建链路。

## 当前限制

- 文件和图片能否被模型理解取决于所选 Provider 与模型能力。
- 长期记忆尚无独立浏览、手动编辑和版本恢复界面。
- 桌宠全双工插话代码已接入，真人耳机、外放、原生窗口交互与多屏体验仍待验收；流式文本输入、自动重连、最终动作资产和 Unity 随安装包分发尚未完成。
- 更新、签名、公证与跨平台实机验收尚未完成；目前没有稳定公开发行版。

完整进度和非目标见[路线图](docs/03-规划/路线图.md)。

## 本地开发

### 环境要求

- Node.js `>= 22.12.0`
- npm `>= 11.0.0`，项目锁定版本为 `npm@11.8.0`
- Windows 是当前主要开发与验证平台

### 启动

```powershell
git clone https://github.com/1sunxiaoshou/katarune.git
cd katarune
npm install
npm run dev
```

`npm run dev` 会在启动前确保 Electron 运行时已经安装。应用没有内置 Provider 凭据；首次使用需要在设置页添加自己的供应商、凭据和模型配置。

### 常用验证

```powershell
npm run typecheck
npm test
npm run test:database
npm run test:ui
```

以 `test:ai:*` 命名的脚本会访问真实 Provider，可能产生费用，不属于普通测试，也不应在没有明确凭据和授权时执行。完整命令与验证边界见[工程规范](docs/04-开发/工程规范.md)。

## 数据与隐私

- SQLite、角色资产、会话和应用设置保存在 Electron 的应用 `userData` 目录。
- 每个角色的长期记忆以明文 Markdown 保存在 `userData/memory/agents/<character-id>/`；角色之间隔离，renderer 不获得真实路径或文件权限。
- API Key 与 Token 由 Electron `safeStorage` 加密，SQLite 只保存不透明凭据引用。
- renderer 不能读取数据库、凭据文件或用户文件的真实路径，只能通过最小化的类型安全 IPC 使用受信任能力。
- 主题、自动朗读、减少动态效果等设备偏好保存在当前 Electron profile 的 `localStorage`。
- TTS 音频属于可重新生成的派生缓存，不写入聊天消息或 SQLite。
- 默认卸载策略保留个人数据；只有用户明确选择删除全部本地数据时才清理。该安装与卸载流程仍需发布前实机验收。

## 架构概览

```text
Electron Desktop
├── Sandboxed Renderer
│   ├── React + assistant-ui
│   ├── Chat / Character / Settings UI
│   └── Audio Playback
├── Preload
│   └── Shared Zod-validated IPC Bridge
└── Trusted Main Process
    ├── AI SDK Agent and Provider Registry
    ├── Tools, Role-scoped Memory Wiki and Speech Capabilities
    ├── SQLite / Drizzle Repositories
    ├── Credential Store
    └── Managed Assets and Protocols
```

主要边界：

- AI SDK 负责模型调用、工具调用、流式输出和基础 Agent 循环。
- assistant-ui 负责聊天 Runtime、消息交互和工具 UI 基础能力。
- SQLite 是会话、角色、模型配置和产品设置的本地事实来源；角色级 Markdown Wiki 是长期记忆正文的事实来源。
- 言奏自研部分集中在角色、资产、记忆策略、语音协调、桌面能力和安全策略。

更完整的版本与边界说明见[技术选型](docs/02-架构/技术选型.md)和[决策记录](docs/01-决策/决策记录.md)。

## 参与贡献

当前项目由个人业余时间推进，欢迎以范围清晰、可以独立评审的小任务参与：

1. 先阅读[项目定义](docs/00-项目/项目定义.md)、[路线图](docs/03-规划/路线图.md)和[工程规范](docs/04-开发/工程规范.md)。
2. 开始 AI SDK 或 assistant-ui 相关工作前，遵守仓库根目录 [`AGENTS.md`](AGENTS.md) 的版本与 Skill 规则。
3. 新功能先通过 [GitHub Issues](https://github.com/1sunxiaoshou/katarune/issues) 对齐用户价值、范围、非目标和验收条件。
4. 不在普通功能变更中夹带依赖升级、架构替换或无关格式化。
5. Pull Request 需要说明数据、安全和跨进程影响，并列出实际执行的验证。

请勿提交真实 API Key、Token、个人数据、供应商响应内容或本地绝对路径。
## 文档

- [文档导航](docs/README.md)
- [项目定义](docs/00-项目/项目定义.md)
- [决策记录](docs/01-决策/决策记录.md)
- [技术选型](docs/02-架构/技术选型.md)
- [路线图](docs/03-规划/路线图.md)
- [工程规范](docs/04-开发/工程规范.md)
- [Agent 协作开发](docs/04-开发/Agent协作开发.md)

## 许可证

项目许可证与开放边界尚未确定。在正式许可证发布前，请不要假定仓库内容可以被复制、修改或再分发。
