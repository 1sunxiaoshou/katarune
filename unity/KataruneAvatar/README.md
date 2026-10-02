# Katarune Avatar Runtime

独立 Unity 角色运行时，负责 VRM、动作、表情、音频、口型、字幕与原生角色窗口。聊天、模型调用、语音服务和产品控件由 Electron 提供。

版本以 `ProjectSettings/ProjectVersion.txt` 和 `Packages/manifest.json` 为准；当前 Unity 为 `6000.3.11f1`，Pipeline 为 `0.8.0-exp.1`。该版本与 Windows 中文路径组合禁用 Pipeline `eval` / `eval_file`，排错见[工程规范](../../docs/04-开发/工程规范.md#unity-编辑器动态程序集排错2026-09-27)。

## Build

以下 Unity 命令在本目录执行。先准备许可允许使用的 VRM 1.0 模型：`Assets/KataruneLocal/Models/default-avatar.vrm`。素材与构建产物处于 Git 忽略目录；本机测试许可不等于分发许可。

```powershell
unity build . --target StandaloneWindows64 --execute-method Katarune.Avatar.Editor.AvatarBuilder.BuildWindows --editor-version 6000.3.11f1 --allow-dirty-build
```

默认开发 Player 为 `Builds/Windows/KataruneAvatar.exe`。`KATARUNE_AVATAR_BUILD_OUTPUT` 可覆盖输出位置；仓库根目录的 `npm run build:avatar` 使用独立的 `build/release/avatar/`，供 Windows 安装包收集，不覆盖开发 Player。完整资源前置条件与发行流程见[工程规范](../../docs/04-开发/工程规范.md#windows-内部发行包)。

## Run

在仓库根目录运行 `npm run dev`，从聊天界面连接桌宠。Electron 启动 Player，并加载当前聊天角色绑定的角色包；停止桌宠或退出 Electron 会关闭它启动的 Player。

独立模型预览：

```powershell
./Builds/Windows/KataruneAvatar.exe -force-d3d11 -force-d3d11-bitblt-model --vrm "C:/path/to/avatar.vrm"
```

`--opaque-window` 用于不透明背景调试，`--soft-outline` 指定柔和描边。模型只接受 VRM 1.0，不在运行时转换旧格式。

默认角色包当前没有动作资源，使用静态基础姿态；模型、动作与图片一起由角色包管理。包格式与导入边界见[角色包格式](../../docs/02-架构/角色包格式.md)。窗口、鼠标、字幕、跨屏和重置规则见[桌面交互设计](../../docs/00-项目/桌面交互设计.md)。

## 动作开发

面向用户的动作通过角色包中的 VRMA 导入。下面的 `.motionpack` 是开发用 Unity AssetBundle，不能放进用户角色包清单。

1. 将转换完成的 Humanoid `.anim` 导入 `Assets/KataruneLocal/Motions/Baked/`。
2. 在 Project 窗口选中 Clip 或动作库，执行 `Katarune > Motion Packs > Build Selected Clips or Library`。
3. 将生成的 `MotionPacks/*.motionpack` 复制到开发 Player 旁的 `MotionPacks/`，重启加载。不要复制 `.meta` 或构建用 `.manifest`。

定义保存在 `Assets/KataruneLocal/MotionPacks/*.asset`；保留 `.meta` 和稳定 ID，替换时删除旧包，避免重复身份。也可通过 `--motion-packs "C:/path/to/packs"` 指定目录。

资源包受 Unity 版本、Windows x64 平台与格式版本约束，升级后需重打包；只安装可信来源的包，AssetBundle 不是恶意资源沙箱。过渡、通道所有权与播放机制见[角色行为与动画系统](../../docs/02-架构/角色行为与动画系统.md)，不另建播放器。

## Test

```powershell
unity test . --mode EditMode --output ./Logs/editmode-results.xml --editor-version 6000.3.11f1
unity test . --mode PlayMode --output ./Logs/playmode-results.xml --editor-version 6000.3.11f1
```

构建开发 Player 后，在仓库根目录运行 `npm run test:avatar-packages` 检查实际角色包加载；其他 Player、语音和校准入口见[工程规范](../../docs/04-开发/工程规范.md#语音与-ulipsync-开发验收)。部分本机模型烟测需要 `KATARUNE_TEST_VRM_PATH`，缺少资源时会跳过，须如实报告。

自动测试、真实 Player/供应商联调与使用者验收分别记录。当前能力和剩余工作只在[路线图](../../docs/03-规划/路线图.md)维护，历史样例与验证记录从 Git 查阅。
