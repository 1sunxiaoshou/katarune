# Katarune Avatar Runtime

言奏 VRM 的独立 Unity Runtime。当前基线为 Unity `6000.3.11f1`、URP `17.3.0`、UniVRM `0.131.0` 与 UniWindowController `0.9.8`。

Unity UI Toolkit 桌宠 HUD 已贯通形体、渲染和本地动作预览闭环，不依赖 Electron 或音频。Runtime 只支持外部 VRM 1.0 的异步加载、原子替换和卸载，并用 UniVRM 标准化 Control Rig 驱动稳定中性姿态、高层行为请求、六种表情预设、自动眨眼、默认关闭的鼠标视线跟随、Spring Bone 环境风和外部口型输入。fallback 不生成呼吸或身体微摆；视线跟随关闭时固定正前方，开启后以摄像机射线、虚拟窗口平面和 VRM 眼睛原点进行世界空间映射并持续跟随鼠标，不生成随机偏移注视。没有安装 Git 忽略的本地动作库时，角色保留中性姿态，作者动画与动作按钮显示为不可用。表情优先使用具备真实绑定的 VRM 标准预设；空预设可由模型已有的 ARKit 风格自定义键组合回退，否则在 HUD 中标记不可用。默认完全保留模型原有 MToon、贴图和描边，只由单一柔和主光与中性环境光照明；亮色桌面和暗色桌面使用独立曝光档位，PC 使用 4× MSAA。唯一可选材质调整是“柔和描边覆盖”，它只替换描边参数，不修改模型明暗、颜色或贴图。

开发环境可将本机默认模型放在 Git 忽略的 `Assets/KataruneLocal/Models/初音未来.vrm`；未传入 `--vrm` 时 Runtime 会加载它，命令行显式路径始终优先。当前模型的许可禁止再分发和商业使用，因此该目录不进入版本控制，只允许进入本机测试 Player；不得把包含该模型的构建作为公开产物分发。

## Build

```powershell
unity build . --target StandaloneWindows64 --execute-method Katarune.Avatar.Editor.AvatarBuilder.BuildWindows --output-path ./Builds/Windows/KataruneAvatar.exe --editor-version 6000.3.11f1 --allow-dirty-build
```

## Run

```powershell
./Builds/Windows/KataruneAvatar.exe -force-d3d11 -force-d3d11-bitblt-model --vrm "C:/path/to/avatar.vrm"
```

Windows Player 默认作为置顶的全屏透明覆盖层贴合主显示器，角色根据窗口宽高比缩放并位于右侧安全区。UI Toolkit HUD 启动时只显示左下黑色四角星入口；左上 `#E9ECEF` 无描边状态卡默认关闭，可在“更多”中切换，开启后以纯黑头像占位、模型名和胶囊控件显示当前表情及动作。点击四角星以错峰动画展开“模型、表情、动作、视线跟随、角色展示、更多”，再点击分类展开第二圈；按钮文字只在悬停时以无尾巴黑底白字 Tooltip 显示。按住四角星可以在全屏范围拖动独立锚点，菜单靠近不同屏幕边缘或角落时自动朝内展开。全局 F1 显示或隐藏整个 HUD，截图模式始终隐藏 HUD。

窗口使用 UI Toolkit 内置运行时事件系统，不创建旧 uGUI EventSystem。UniWindowController 自动帧尾 Raycast 关闭；Windows 薄适配器把原生光标转换为 Panel 坐标并只 Pick 圆形 Button，顶部状态、人物和透明区域继续穿透到桌面。按住中央入口后通过 Pointer Capture 保持交互，并在帧末采样最新光标移动锚点，不使用全屏透明捕获面。`AvatarRadialMenu` 使用 UXML 配置一、二级半径、扫过角和安全边距，靠边时生成朝内半圆，靠角时生成朝内四分之一圆。HUD 隐藏时整个覆盖层强制点击穿透。一级菜单直接提供视线跟随和默认关闭的角色展示开关；开启期间整窗接收输入，VRM 根固定在世界原点，左键水平拖动绕作者根轴旋转并带跟手阻尼与松手惯性，垂直拖动在上下各 `45°` 内俯仰观察；滚轮只平滑改变投影倍率，中键只平滑改变屏幕构图。关闭后保留当前角度、倍率和构图并恢复点击穿透。模型入口使用原生文件选择器单选 `.vrm`，其他入口可切换六种表情、本地可用动作、亮色/暗色桌面灯光及柔和描边。`--opaque-window` 只用于调试，`--lighting light|dark` 和 `--soft-outline` 仍可指定启动表现。当前统一使用 PC 4× MSAA 基线。

## Local motion preview

当前不在仓库中固定正式待机或表演 Clip。需要预览技术动作时，从官方页面下载 [Universal Animation Library 1 Standard](https://quaternius.com/packs/universalanimationlibrary.html) 和 [Universal Animation Library 2 Standard](https://quaternius.com/packs/universalanimationlibrary2.html)，然后在 Unity 中打开 `Katarune > Avatar > Import Local Preset Motions...`，选择两个 ZIP 或解压目录。导入器验证 CC0 `License.txt`、配置 Humanoid/循环与 Root Transform，并在被 Git 忽略的 `Assets/KataruneLocal` 下生成一个基础循环和动作预览库。

当前 Standard ZIP 不包含名为 `Wave` 和 `Coughing` 的 Clip，因此本地技术样片分别使用 `Interact` 和 `Consume` 代替；这两个映射只验证白名单控制、重定向和混合，不是最终动作美术。

UAL1 `Idle` 当前只作为技术预览的基础循环，不代表最终待机选择。用户确认正式动作后，应把稳定 ID、通道、循环和退出语义写入 `.kbehavior`，而不是增加角色阶段枚举。

需要对比另一套动作源时，可下载 [Motifect Daily Life Motion Pack](https://motifect.itch.io/motifect-daily-life-motion-pack)，在同一导入窗口选择 ZIP 后执行 `Import Motifect alternate set`。该包没有中性 Idle 和 Cough，因此导入器保留已有基础循环与咳嗽预览，只替换挥手、解释和庆祝三个预览槽。运行时不包含全量动作浏览器；这些固定槽仅服务当前人工挑选，不是未来 Unity 工具能力清单。Motifect 原始 FBX 不得作为独立动作素材重新分发。

## Behavior definition assets

`Assets/Katarune/Behaviors` 下的版本化行为定义源统一由严格 `.kbehavior` 导入器编译为 `BehaviorDefinitionAsset`。定义通过 GUID 引用单个 Clip 和可选 Avatar Mask，并声明 Humanoid 能力、六类语义通道申请、入口/循环/退出段、有限循环次数、命名同步点、退出段对应的安全点、热更新参数、回退策略和许可证元数据。Avatar Mask 只用于经过验证的局部动作，不能把任意全身 Clip 自动变成上半身手势。替换动作文件时只需修改定义，不需要增加动作枚举或运行时名称分支；未知字段、缺失资源、非法时间/安全点、重复通道或角色能力不足会返回明确错误。

许可证清单区分 `dev-only`、`prototype-distributable` 和 `commercial-candidate`，并保存取得日期、原始格式、商用/修改/再分发权和仓库策略。原始 FBX、ZIP 与本地预览资产始终被 Git 忽略；只有用户确认且许可证允许收录的规范化 Unity Clip 才能进入仓库。

## Behavior sample status

首轮三样片曾用于验证单 Clip 定义、全身独占通道、有限循环、安全退出和 Humanoid 重定向，验证结论保留在架构与推进文档。对应规范化 `.anim` 已从当前工作树移除，等待用户从本地候选中重新选择；因此它们不是当前可播放内容，也不应由测试假定存在。

## Phase D acceptance scenes

`Assets/Katarune/Scenes/Acceptance` 保留调度诊断场景结构；重新绑定用户确认的动作定义后，可通过 HUD 选择仓库外 VRM，或以 `--vrm "C:/path/to/avatar.vrm"` 启动。场景左上角显示权威实例状态、播放阶段、同步点、通道所有者和终态原因；组合输入只使用手动口型、默认凝视、行为请求与中断命令，不定义覆盖角色全身的对话阶段。调度表演采用 SmoothStep 固定时长混合：淡入 0.20 秒、自然回基础姿态 0.25 秒、安全退出回基础姿态 0.20 秒、立即取消视觉缓冲 0.12 秒。场景不接 Electron 或真实音频。

行为请求只通过 `IAvatarRuntimeFacade.RequestBehavior` 提交稳定 behavior ID，暂停、继续、立即取消和安全退出通过 `ApplyPerformanceCommand` 作用于实例 ID。行为调度器是通道所有权的唯一写入点；人工预览动作与调度身体实例互斥，已由行为资产表达的能力不再通过固定预览槽发布。场景和 Resources 目录可由 `Katarune > Generate Phase D Acceptance Assets` 重建，但必须先为定义配置有效 Clip。

从官方 UAL1 Standard 包按上文流程导入本地源后，可重复生成仓库中的规范化样片：

```powershell
unity run . --editor-version 6000.3.11f1 --timeout 600 -- -nographics -executeMethod Katarune.Avatar.Editor.PhaseCBehaviorSampleGenerator.GenerateAndSave
```

在隔离的批处理场景中生成六张 Humanoid 蒙皮预览帧：

```powershell
unity run . --editor-version 6000.3.11f1 --timeout 600 -- -force-d3d11 -executeMethod Katarune.Avatar.Editor.PhaseCBehaviorPreviewCapture.Capture
```

预览输出位于被忽略的 `TestResults/phase-c-preview`，包含待机首尾、全身解释、舞蹈循环、退出中点和恢复待机。生成器会验证本地 CC0 许可证，固定 Root/Motion 曲线，并拒绝退出插值过冲；它只映射 UAL1 源 Clip 名称，不影响运行时定义解析。

除本机默认模型外，其他测试模型继续从仓库外加载：将许可允许本地测试的 VRM 1.0 文件放在任意仓库外目录，通过上文 `--vrm "C:/path/to/avatar.vrm"` 启动，或设置 `KATARUNE_TEST_VRM_PATH` 后运行本地 PlayMode 烟测。它们不复制进 `Assets`、构建产物或测试夹具；加载后由 UniVrm 适配器映射为 `ICharacterRigBinding`，行为定义只校验统一能力，不读取模型路径或角色专属骨骼名。

构建固定 D3D11、关闭 Flip Model/HDR，并启用 URP Alpha Processing。可用 `--screenshot <png>`、`--exit-after-capture` 和 `--exit-on-error` 执行自动烟测；`--capture-delay <seconds>` 可在 0–30 秒范围内延迟截图以观察动作主体。截图模式会强制隐藏 HUD。加载器只接受 VRM 1.0，不执行 VRM 0.x 运行时迁移。

## Runtime design

- `IAvatarRuntimeFacade` 是 HUD 和未来输入适配器的唯一入口，公开带 `Revision` 的不可变语义状态快照；每帧姿态单独通过 `CurrentPose` 读取。
- `AvatarRuntimeSession` 负责隐藏候选对象的 `prepare → validate → commit` 事务。连续加载通过请求序号和取消令牌仲裁；失败提交恢复旧 Driver、Visual、Motion 与 Framing，成功后才释放旧角色。
- `Katarune.Avatar.Motion` 中的 `AvatarMotionController` 与每模型 `AvatarMotionInstance` 通过统一 `ICharacterRigBinding` 使用单一 PlayableGraph 混合基础循环、归一化的调度全身表演和互斥人工预览动作；所有动作关闭 Root Motion。上半身通道与可选 Mask 仍是资产能力，但当前无真实专用样片。UniVrm 只负责从 Control Rig 构造 Binding。
- `UniVrmAvatarDriver` 隔离 UniVRM 表情、视线和标准化骨骼接口；作者动作独占四肢姿态，程序化层只向躯干与头部追加微动作。没有 authored pose 时，程序化层才从捕获基准姿态控制手臂。
- `AvatarBehaviorController` 将鼠标像素投射到摄像机与 VRM 眼睛原点之间的虚拟窗口平面，按角色根朝向计算视线角度；`AvatarPoseFrame` 的水平视线继续使用屏幕坐标语义（向右为正），驱动边界再转换到角色与 UniVRM 坐标，避免左右镜像。
- `AvatarBehaviorController` 生成与输入源无关的 `AvatarPoseFrame`，执行顺序位于 UniVRM `LateUpdate` 之前。
- `AvatarVisualController` 对候选模型执行材质分类；柔和描边开启时只覆盖四个 MToon 描边字段，关闭时精确恢复捕获值，并保留 VRM Expression 使用的原 Material 引用。
- `AvatarVisualProfile` 只保存柔和描边参数及可选模型材质角色覆盖；默认资产位于 `Assets/Katarune/Resources`。
- `AvatarLightingRig` 提供无阴影的柔和主光与中性环境光，只按亮色/暗色桌面表现设置调整。
- `AvatarSceneRig` 将 VRM 根规范化到世界原点并只绕作者根轴水平旋转；模型 Bounds 只参与初始取景。受限纵向俯仰、FOV 投影倍率和 `lensShift` 构图偏移各自保存目标与阻尼状态，不会互相改写角色位置或基础画框。
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

当前非目标包括 Electron 接入、跨进程控制协议、多显示器产品策略、真实音频、音素识别、VRMA/运行时自定义动作、模型专属绑定、Root Motion、情绪模型和端到端形体生成。模型专属脸部 SDF、材质 ID/遮罩、自有角色 Shader 和 Alpha 安全的局部后处理留待后续；调试伪口型只是未来音频时间线的输入替身。
