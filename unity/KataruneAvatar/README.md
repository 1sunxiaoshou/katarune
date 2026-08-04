# Katarune Avatar Runtime

言奏 VRM 的独立 Unity Runtime。当前基线为 Unity `6000.3.11f1`、URP `17.3.0`、UniVRM `0.131.0` 与 UniWindowController `0.9.8`。

第一阶段用 Unity 内部调试 UI 验证完整形体闭环，不依赖 Electron、音频或动作文件。Runtime 支持外部 VRM 的异步加载、原子替换和卸载，并用 UniVRM 标准化 Control Rig 驱动四种活动状态、六种情感预设、呼吸、重心摆动、自动眨眼、三种视线模式和调试伪口型。表情优先使用具备真实绑定的 VRM 标准预设；空预设可由模型已有的 ARKit 风格自定义键组合回退，否则在面板中标记不可用。

## Build

```powershell
unity build . --target StandaloneWindows64 --execute-method Katarune.Avatar.Editor.AvatarBuilder.BuildWindows --output-path ./Builds/Windows/KataruneAvatar.exe --editor-version 6000.3.11f1 --allow-dirty-build --no-tail
```

## Run

```powershell
./Builds/Windows/KataruneAvatar.exe -force-d3d11 -force-d3d11-bitblt-model --vrm "C:/path/to/avatar.vrm"
```

Windows Player 默认作为置顶的全屏透明覆盖层贴合主显示器，角色根据窗口宽高比缩放并位于右侧安全区。面板隐藏时整个覆盖层强制点击穿透；面板显示时使用透明度命中测试，仅可见内容接管鼠标。`--opaque-window` 只用于调试。

Editor Play Mode 默认显示中文 IMGUI 调试面板，Player 通过 `--debug-ui` 初始显示；运行时可用全局 F1 显示或隐藏，因此窗口处于点击穿透且失去焦点时仍可重新打开。面板可粘贴绝对 VRM 路径，并控制活动状态、表情、微动作、视线、眨眼与 viseme。

构建固定 D3D11、关闭 Flip Model/HDR，并启用 URP Alpha Processing。可用 `--screenshot <png>`、`--exit-after-capture` 和 `--exit-on-error` 执行自动烟测；截图模式会强制隐藏调试面板。加载器接受 VRM 1.0，也允许 UniVRM 在运行时迁移 VRM 0.x。

## Runtime design

- `AvatarRuntimeSession` 负责 `load → validate → commit` 生命周期。连续加载通过请求序号和取消令牌仲裁，失败的 Reload 保留当前角色。
- `UniVrmAvatarDriver` 隔离 UniVRM 表情、视线和标准化骨骼接口，并在每帧从捕获的基准姿态重新应用偏移。
- `AvatarPoseFrame` 的水平视线使用屏幕坐标语义（向右为正），驱动边界再转换到角色与 UniVRM 坐标，避免不同模型/相机朝向导致左右镜像。
- `AvatarBehaviorController` 生成与输入源无关的 `AvatarPoseFrame`，执行顺序位于 UniVRM `LateUpdate` 之前。
- `AvatarWindow` 负责全屏主显示器适配、置顶、点击穿透和 Windows Player 的全局 F1 调试热键。
- `AvatarDebugPanel` 是第一阶段中文开发入口，不属于最终产品 UI。

## Test

```powershell
unity test . --mode EditMode --output ./Logs/editmode-results.xml --editor-version 6000.3.11f1
unity test . --mode PlayMode --output ./Logs/playmode-results.xml --editor-version 6000.3.11f1
```

模型文件和构建产物不进入版本控制。测试模型的许可元数据可能比同目录说明更严格；只能本地验证，不得随项目分发。

当前非目标包括 Electron 接入、跨进程控制协议、点击穿透、窗口拖动与置顶、真实音频、音素识别、AnimationClip/VRMA、动作库、情绪模型和端到端形体生成。调试伪口型只是未来音频时间线的输入替身。
