# Katarune Avatar Runtime

言奏 VRM 的独立 Unity Runtime。当前基线为 Unity `6000.3.11f1`、URP `17.3.0`、UniVRM `0.131.0` 与 UniWindowController `0.9.8`。

Unity UI Toolkit 桌宠 HUD 已贯通形体、渲染和预设动作技术闭环，不依赖 Electron 或音频。Runtime 支持外部 VRM 的异步加载、原子替换和卸载，并用 UniVRM 标准化 Control Rig 驱动四种活动状态、四个白名单单次动作、六种情感预设、呼吸、重心摆动、自动眨眼、三种视线模式和调试伪口型。没有安装本地动作库时，四态身体表现完整回退到程序化实现。表情优先使用具备真实绑定的 VRM 标准预设；空预设可由模型已有的 ARKit 风格自定义键组合回退，否则在 HUD 中标记不可用。默认完全保留模型原有 MToon、贴图和描边，只由单一柔和主光与中性环境光照明；亮色桌面和暗色桌面使用独立曝光档位，PC 使用 2× MSAA。唯一可选材质调整是“柔和描边覆盖”，它只替换描边参数，不修改模型明暗、颜色或贴图。

## Build

```powershell
unity build . --target StandaloneWindows64 --execute-method Katarune.Avatar.Editor.AvatarBuilder.BuildWindows --output-path ./Builds/Windows/KataruneAvatar.exe --editor-version 6000.3.11f1 --allow-dirty-build
```

## Run

```powershell
./Builds/Windows/KataruneAvatar.exe -force-d3d11 -force-d3d11-bitblt-model --vrm "C:/path/to/avatar.vrm"
```

Windows Player 默认作为置顶的全屏透明覆盖层贴合主显示器，角色根据窗口宽高比缩放并位于右侧安全区。UI Toolkit HUD 启动时只显示左下黑色四角星入口；左上 `#E9ECEF` 无描边状态卡默认关闭，可在“更多”中切换，开启后以纯黑头像占位、模型名和胶囊控件显示当前表情及动作/活动状态。点击四角星以错峰动画展开“模型、表情、动作、状态、更多”，再点击分类展开第二圈；按钮文字只在悬停时以无尾巴黑底白字 Tooltip 显示。按住四角星可以在全屏范围拖动独立锚点，菜单靠近不同屏幕边缘或角落时自动朝内展开。全局 F1 显示或隐藏整个 HUD，截图模式始终隐藏 HUD。

窗口使用 UI Toolkit 内置运行时事件系统，不创建旧 uGUI EventSystem。UniWindowController 自动帧尾 Raycast 关闭；Windows 薄适配器把原生光标转换为 Panel 坐标并只 Pick 圆形 Button，顶部状态、人物和透明区域继续穿透到桌面。按住中央入口后通过 Pointer Capture 保持交互，并在帧末采样最新光标移动锚点，不使用全屏透明捕获面。`AvatarRadialMenu` 使用 UXML 配置一、二级半径、扫过角和安全边距，靠边时生成朝内半圆，靠角时生成朝内四分之一圆。HUD 隐藏时整个覆盖层强制点击穿透。模型入口使用原生文件选择器单选 `.vrm`；其他入口可切换六种表情、四态循环、四个一次性动作、亮色/暗色桌面灯光及柔和描边。`--opaque-window` 只用于调试，`--lighting light|dark` 和 `--soft-outline` 仍可指定启动表现。当前统一使用 PC 2× MSAA 基线。

## Local preset motions

仓库内置自有的 `KataruneQuietIdle.anim`：它是 9.6 秒 Humanoid Muscle 循环，保持根节点、腿和四肢稳定，只加入轻微呼吸、身体缓慢侧移感和头部微动，作为正式默认待机。需要预览其余技术动作时，从官方页面下载 [Universal Animation Library 1 Standard](https://quaternius.com/packs/universalanimationlibrary.html) 和 [Universal Animation Library 2 Standard](https://quaternius.com/packs/universalanimationlibrary2.html)，然后在 Unity 中打开 `Katarune > Avatar > Import Local Preset Motions...`，选择两个 ZIP 或解压目录。导入器验证 CC0 `License.txt`、配置 Humanoid/循环与 Root Transform，并在被 Git 忽略的 `Assets/KataruneLocal` 下生成动作库。

当前 Standard ZIP 不包含名为 `Wave` 和 `Coughing` 的 Clip，因此本地技术样片分别使用 `Interact` 和 `Consume` 代替；这两个映射只验证白名单控制、重定向和混合，不是最终动作美术。

默认待机固定使用言奏自有 `KataruneQuietIdle`，不再从偏游戏风格的 UAL 动作中选择。UAL1 `Idle` 仅作为没有 Motifect 替代集时的倾听技术基线。

需要对比另一套动作源时，可下载 [Motifect Daily Life Motion Pack](https://motifect.itch.io/motifect-daily-life-motion-pack)，在同一导入窗口选择 ZIP 后执行 `Import Motifect alternate set`。该包没有中性 Idle 和 Cough，因此导入器保留言奏待机与现有咳嗽，只替换倾听、思考、说话、挥手、解释和庆祝。运行时不再包含全量动作浏览器，HUD 与未来 AI 均只能请求四个正式白名单动作。Motifect 原始 FBX 不得作为独立动作素材重新分发。

## Behavior definition assets

`Assets/Katarune/Behaviors` 下的版本化行为定义源统一由严格 `.kbehavior` 导入器编译为 `BehaviorDefinitionAsset`。定义通过 GUID 引用单个 Clip 和可选 Avatar Mask，并声明 Humanoid 能力、六类语义通道申请、入口/循环/退出段、有限循环次数、命名同步点、退出段对应的安全点、热更新参数、回退策略和许可证元数据。替换动作文件时只需修改定义，不需要增加动作枚举或运行时名称分支；未知字段、缺失资源、非法时间/安全点、重复通道或角色能力不足会返回明确错误。

许可证清单区分 `dev-only`、`prototype-distributable` 和 `commercial-candidate`，并保存取得日期、原始格式、商用/修改/再分发权和仓库策略。Quiet Idle 由项目生成，基准姿态来自 Unity Timeline `HumanoidDefault`，按 Unity Companion License 记录为可分发原型；解释与短舞蹈样片来自 CC0 1.0 的 Quaternius UAL1。仓库只保存规范化 Unity Clip 与 Mask，原始 FBX 仍被 Git 忽略。

## Phase C behavior samples

首轮三样片是 `KataruneQuietIdle`、UAL1 `Idle_Talking` 规范化的上半身解释手势和 UAL1 `Dance` 规范化的短全身表演。解释手势的 Avatar Mask 排除根节点、腿、头和 IK；短表演重复一秒循环十五次，在下一次 0.5 秒稳定站姿进入一秒退出段，随后回到 Quiet Idle。它们只用于资产与 PlayableGraph 压力验证，尚未接入 D 阶段调度器；现有四态与白名单动作仍是运行基线。

从官方 UAL1 Standard 包按上文流程导入本地源后，可重复生成仓库中的规范化样片：

```powershell
unity run . --editor-version 6000.3.11f1 --timeout 600 -- -nographics -executeMethod Katarune.Avatar.Editor.PhaseCBehaviorSampleGenerator.GenerateAndSave
```

在隔离的批处理场景中生成六张 Humanoid 蒙皮预览帧：

```powershell
unity run . --editor-version 6000.3.11f1 --timeout 600 -- -force-d3d11 -executeMethod Katarune.Avatar.Editor.PhaseCBehaviorPreviewCapture.Capture
```

预览输出位于被忽略的 `TestResults/phase-c-preview`，包含待机首尾、上半身叠加、舞蹈循环、退出中点和恢复待机。生成器会验证本地 CC0 许可证，固定 Root/Motion 曲线，并拒绝退出插值过冲；它只映射 UAL1 源 Clip 名称，不影响运行时定义解析。

测试模型继续从仓库外加载：将许可允许本地测试的 `.vrm` 放在任意仓库外目录，通过上文 `--vrm "C:/path/to/avatar.vrm"` 启动，或设置 `KATARUNE_TEST_VRM_PATH` 后运行本地 PlayMode 烟测。模型不复制进 `Assets`、构建产物或测试夹具；加载后由 UniVrm 适配器映射为 `ICharacterRigBinding`，行为定义只校验统一能力，不读取模型路径或角色专属骨骼名。

构建固定 D3D11、关闭 Flip Model/HDR，并启用 URP Alpha Processing。可用 `--screenshot <png>`、`--exit-after-capture` 和 `--exit-on-error` 执行自动烟测；`--activity idle|listening|thinking|speaking` 可指定待拍状态，`--capture-delay <seconds>` 可在 0–30 秒范围内延迟截图以观察动作主体。截图模式会强制隐藏 HUD。加载器接受 VRM 1.0，也允许 UniVRM 在运行时迁移 VRM 0.x。

## Runtime design

- `IAvatarRuntimeFacade` 是 HUD 和未来输入适配器的唯一入口，公开带 `Revision` 的不可变语义状态快照；每帧姿态单独通过 `CurrentPose` 读取。
- `AvatarRuntimeSession` 负责隐藏候选对象的 `prepare → validate → commit` 事务。连续加载通过请求序号和取消令牌仲裁；失败提交恢复旧 Driver、Visual、Motion 与 Framing，成功后才释放旧角色。
- `Katarune.Avatar.Motion` 中的 `AvatarMotionController` 与每模型 `AvatarMotionInstance` 通过统一 `ICharacterRigBinding` 使用 PlayableGraph 混合状态循环和 latest-wins 单次动作；所有动作关闭 Root Motion。UniVrm 只负责从 Control Rig 构造 Binding。
- `UniVrmAvatarDriver` 隔离 UniVRM 表情、视线和标准化骨骼接口；作者动作独占四肢姿态，程序化层只向躯干与头部追加微动作。没有 authored pose 时，程序化层才从捕获基准姿态控制手臂。
- `AvatarPoseFrame` 的水平视线使用屏幕坐标语义（向右为正），驱动边界再转换到角色与 UniVRM 坐标，避免不同模型/相机朝向导致左右镜像。
- `AvatarBehaviorController` 生成与输入源无关的 `AvatarPoseFrame`，执行顺序位于 UniVRM `LateUpdate` 之前。
- `AvatarVisualController` 对候选模型执行材质分类；柔和描边开启时只覆盖四个 MToon 描边字段，关闭时精确恢复捕获值，并保留 VRM Expression 使用的原 Material 引用。
- `AvatarVisualProfile` 只保存柔和描边参数及可选模型材质角色覆盖；默认资产位于 `Assets/Katarune/Resources`。
- `AvatarLightingRig` 提供无阴影的柔和主光与中性环境光，并按活动状态做小幅平滑调整。
- `AvatarWindow` 负责全屏主显示器适配、置顶、UI Toolkit Button 局部命中、点击穿透和 Windows Player 的全局 F1 HUD 热键。
- `AvatarHudController` 只订阅 Facade Snapshot 并调用 Facade；UXML、USS、Painter2D 装饰、SVG 图标和字体均可在 UI Builder 中继续编辑。
- 程序集分为 `Katarune.Avatar.Core`、`Katarune.Avatar.Motion`、`Katarune.Avatar.UniVrm` 与 `Katarune.Avatar.Runtime`；Core 和 Motion 不引用 UniVRM 或 UniWindowController。
- Camera Post Processing 和场景 Global Volume 均关闭；URP 默认 Volume Profile 保持为空，原始材质基线不经过 Bloom、Vignette、Tonemapping 或 Motion Blur。

## Test

```powershell
unity test . --mode EditMode --output ./Logs/editmode-results.xml --editor-version 6000.3.11f1
unity test . --mode PlayMode --output ./Logs/playmode-results.xml --editor-version 6000.3.11f1
```

设置 `KATARUNE_TEST_VRM_PATH` 后，可单独运行 `LocalPresetMotionSmokeUsesFacadeWhitelist`，在仓库外 VRM 上验证四个动作的能力、启动、打断和取消。未设置时该本地烟测自动跳过。

模型文件和构建产物不进入版本控制。测试模型的许可元数据可能比同目录说明更严格；只能本地验证，不得随项目分发。

当前非目标包括 Electron 接入、跨进程控制协议、窗口拖动、多显示器产品策略、真实音频、音素识别、VRMA/运行时自定义动作、动作队列、模型专属绑定、Root Motion、情绪模型和端到端形体生成。模型专属脸部 SDF、材质 ID/遮罩、自有角色 Shader 和 Alpha 安全的局部后处理留待下一阶段；调试伪口型只是未来音频时间线的输入替身。
