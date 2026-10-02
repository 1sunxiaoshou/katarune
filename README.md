<div align="center">
  <img src="resources/katarune-logo.png" alt="Katarune" width="144" />
</div>

# Katarune

> 新一代的数字伙伴~

Katarune 想创造能与你共同生活的数字生命。

互发消息、一起游戏，在虚拟世界中玩耍；未来，拥有自己的躯体，能够观察、移动，探索现实世界。这是我们希望一步步实现的愿景。

## 目前的体验

- **自由交谈**：流式文字对话、多会话历史，以及图片和文件附件；附件理解取决于所选模型的能力。
- **塑造角色**：自定义角色设定，为不同角色选择模型和音色，通过角色包更换立绘与 VRM 形象。
- **延续记忆**：每个角色拥有独立的本地记忆，记录相处中的偏好与重要信息，在后续对话中按需回忆。
- **开口交流**：离线语音识别、自动断句和语音回复，支持桌面角色连续对话与插话。
- **桌面陪伴**：VRM 角色显示在桌面上，以字幕、口型、表情和已配置的动作回应，支持多屏与布局调整。
- **由你选择**：自行配置模型供应商、兼容端点、对话模型和语音服务，按自己的需要组合伙伴的能力。

## 从源码开始

目前项目处于 Alpha 阶段，主要支持 Windows x64。开发进度见[路线图](docs/03-规划/路线图.md)。

使用 Node.js **24.21.0** 与 npm **11.19.0**：

```powershell
git clone https://github.com/1sunxiaoshou/katarune.git
cd katarune
npm ci
npm run dev
```

首次启动后，在设置中添加供应商和模型，并选择默认对话模型；需要语音回复时，再配置语音模型和音色。应用不附带 API Key，服务用量和费用取决于你选择的供应商。

聊天记录与角色记忆保存在本机；使用在线模型或语音服务时，必要内容会发送到你选择的供应商。

语音识别与桌面角色需要额外的本地资源。离线语音模型使用 `npm run asr:download` 下载；Unity Player、VRM 与动画资源的准备和构建方式见[工程规范](docs/04-开发/工程规范.md)。仅运行 `npm run dev` 不会自动完成这些准备。

## 参与项目

欢迎通过 [Issues](https://github.com/1sunxiaoshou/katarune/issues) 分享使用反馈、报告问题或讨论新想法，也欢迎提交范围清晰的 Pull Request。

开发前请阅读[文档导航](docs/README.md)与[工程规范](docs/04-开发/工程规范.md)；使用编码 Agent 时，遵循 [AGENTS.md](AGENTS.md)。

## 致谢与许可

Katarune 基于 Electron、React、AI SDK、assistant-ui 与 Unity 等项目构建。

项目许可证与开源边界尚未确定。第三方代码、模型、角色和动画资产遵循各自的授权条款；正式许可证发布前，请勿将仓库可见视为复制或再分发授权。
