<div align="center">
  <img src="resources/katarune-logo.png" alt="Katarune" width="144" />
</div>

# Katarune

> 新一代的数字伙伴~

Katarune，创造与你共同生活的数字世界。

互发消息、一起游戏，在虚拟世界中玩耍；未来，拥有自己的躯体，能够观察、移动，探索现实世界。这是我们希望一步步实现的愿景。

## 目前的体验

- **自由交谈**：流式文字对话、多会话历史，以及图片和文件附件；附件理解取决于所选模型的能力。
- **塑造角色**：自定义角色设定，为不同角色选择模型和音色，通过角色包更换立绘与 VRM 形象。
- **延续记忆**：每个角色拥有独立的本地记忆，记录相处中的偏好与重要信息，在后续对话中按需回忆。
- **动手探索**：角色拥有持久工作区，可处理已发送的文件、读取公开网页；每个会话可在聊天输入框底部选择请求批准或完全访问权限，控制目录和本机程序权限。
- **开口交流**：离线语音识别、自动断句和语音回复，支持桌面角色连续对话与插话。
- **桌面陪伴**：VRM 角色显示在桌面上，以字幕、口型、表情和已配置的动作回应，支持多屏与布局调整。
- **直播试用**：独立直播页面与会话，提供 B 站官方／网页连接与抖音网页接入，将角色画面和声音交给直播软件。B 站官方方式需要已获批项目及消息权限；网页方式扫码登录并识别自己的直播间。
- **由你选择**：自行配置模型供应商、兼容端点、对话模型和语音服务，按自己的需要组合伙伴的能力。

## 下载与使用

目前项目处于 Alpha 阶段，主要支持 Windows x64。开发进度见[路线图](docs/03-规划/路线图.md)。

在 [Releases](https://github.com/1sunxiaoshou/katarune/releases) 下载 `Katarune-Setup-<版本号>.exe` 并安装。Windows 安装包包含默认角色、桌宠运行环境和离线语音识别资源，无需安装 Node.js 或 Unity。首版安装包未签名，Windows 可能显示发布者未知或 SmartScreen 提示。

1. 启动后进入「设置 → 模型」，添加供应商、API Key 和需要的模型，再在「常规」中选择默认对话模型。
2. 返回聊天页面发送消息。需要语音回复时，在设置中选择语音模型和音色；使用麦克风前，允许 Windows 的麦克风访问。
3. 在聊天页面开启桌宠，与当前角色交谈；从桌宠的更多面板查看操作说明或进入沉浸模式。

应用不附带 API Key，在线模型与语音服务的用量和费用由你选择的供应商决定。聊天记录与角色记忆保存在本机；使用在线服务时，必要内容会发送到相应供应商。

目前通过下载新版完整安装包并覆盖安装来更新；卸载默认保留个人数据，可在卸载时选择全部删除。完全访问模式下的本机命令执行额外需要 [Git for Windows](https://git-scm.com/downloads/win)，其 Bash 不包含在安装包内；自行配置的 MCP 服务也需要相应程序和运行环境。

遇到问题可在「设置 → 常规」打开日志目录，并通过 [Issues](https://github.com/1sunxiaoshou/katarune/issues) 提供版本、复现步骤和故障编号；请勿提交 API Key、Cookie 或聊天隐私。

## 从源码开始

使用 Node.js **24.21.0** 与 npm **11.19.0**：

```powershell
git clone https://github.com/1sunxiaoshou/katarune.git
cd katarune
npm ci
npm run dev
```

源码运行的语音识别与桌面角色需要额外准备。离线语音模型使用 `npm run asr:download` 下载；默认角色包已包含 VRM 与动作资源，Unity Player 的构建方式见[工程规范](docs/04-开发/工程规范.md)。仅运行 `npm run dev` 不会自动完成这些准备。

## 参与项目

欢迎通过 [Issues](https://github.com/1sunxiaoshou/katarune/issues) 分享使用反馈、报告问题或讨论新想法，也欢迎提交范围清晰的 Pull Request。

开发前请阅读[文档导航](docs/README.md)与[工程规范](docs/04-开发/工程规范.md)；使用编码 Agent 时，遵循 [AGENTS.md](AGENTS.md)。

## 致谢

感谢开源社区的分享与贡献，以下项目为 Katarune 的开发提供了技术支持与启发：

- [AI SDK](https://github.com/vercel/ai)
- [assistant-ui](https://github.com/assistant-ui/assistant-ui)
- [UniVRM](https://github.com/vrm-c/UniVRM)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [Codex](https://github.com/openai/codex)

## 许可证

本项目原创源码采用 [Apache License 2.0](LICENSE)，允许在遵守许可证的前提下使用、修改和商业分发。

## 免责声明

本项目使用了部分第三方代码及角色、模型、动画、音乐等资产，相关权利归各自权利人所有，使用与传播须遵循其授权条款。

如您认为本项目中的内容侵犯了您的合法权益，请通过 [Issues](https://github.com/1sunxiaoshou/katarune/issues) 联系我们，并提供相关权属说明及内容位置。我们将在核实后及时删除或作相应处理。
