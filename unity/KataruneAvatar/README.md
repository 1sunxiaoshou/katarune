# Katarune Avatar Runtime

言奏 VRM 的独立 Unity Runtime。当前基线为 Unity `6000.3.11f1`、URP `17.3.0`、UniVRM `0.131.0` 与 UniWindowController `0.9.8`。

Unity 已贯通形体、渲染和本地动作预览闭环；产品控件由 Electron 胶囊与面板提供。当前默认测试待机由 VRMA 烘焙的 Humanoid Clip 循环播放，四个完整手势从现有动作菜单手动播放，统一经 `AvatarMotionInstance` 切换、停止并回到呼吸待机；不启用随机动作，也不再叠加程序化呼吸或摆头。自动眨眼、表情、口型、默认关闭的鼠标视线跟随和 Spring Bone 环境风保持独立。未安装动作库时使用静态基础姿态，菜单隐藏未安装的动作。渲染保留模型原材质与可选柔和描边，使用场景中的单一柔和主光、环境光和 PC 4× MSAA。

开发环境的可替换测试资产为 `Assets/KataruneLocal/Models/default-avatar.vrm`、`Assets/KataruneLocal/Motions/idle-standing-breathing.vrma` 和同目录 `idle-variant-01.vrma` 至 `04.vrma`。未传入 `--vrm` 时自动加载默认模型；命令行显式模型路径优先，仍共享动作库。所有素材与生成结果均在 Git 忽略目录中，仅供本机测试，不公开分发。模型构建时复制到 Player 的对应目录，Humanoid Clip 和动作库独立打成 `MotionPacks/*.motionpack`，不再嵌入 Player，也不保留重复 VRMA 副本。

## 聊天控制与 Unity 字幕

Windows 开发环境已接通现有聊天界面。先构建 `Builds/Windows/KataruneAvatar.exe`，再从仓库根目录运行 `npm run dev`；在聊天底部点击“连接桌宠”，Electron 会启动 Player 并绑定当前角色和会话。退出 Electron 或点击“停止桌宠”会关闭它启动的 Player。当前加载本地默认 VRM，不自动将聊天角色切换为另一份模型。

连接桌宠不会创建空白会话记录，首次发送消息才创建会话并沿用框架自动标题。

Unity 通过本机 Named Pipe 公布当前动作与表情，Electron 将其注册为 `avatar_action` 和 `set_expression`。SDK 执行回调只等待 Unity 接收确认，实际播放不阻塞 Agent Loop。同时将当前绑定会话的完整 AI SDK `UIMessageChunk` 原样转发给 Unity；Unity 用原生文本和工具事件建立统一时间线，并通过 `toolCallId` 将受信任的执行请求填入对应工具节点。对白节点复用原生文本；有声时由实际音频播放游标推进，无声时按阅读时长完成，表情节点到达游标时切换并保持，动作节点在真正开始后根据 `allowSpeech` 决定是否放行后续对白。字幕在屏幕下方显示，浅粉半透明底、加粗深灰紫文字，保留鼠标穿透；过长文本自然分页。原生事件流结束即允许下一条输入生成；Unity 独立维护跨轮播放队列，后台 drain 只用于音频资源回收。TTS、时间戳字幕和 uLipSync 已接入同一对白节点；Fish 在完整 text 块结束后增量交付 PCM，不逐 token 输入。

AI 输出期间可以继续在聊天中发送文字，文字按顺序等待当前运行结束；确认式语音插话优先于未发送文字，队列只在内存中，已完成对白沿用聊天原生消息保存。当前未接自动重连，也未将 Unity 和本地测试素材纳入 Electron 安装包。

实际 Player 控制与画面检查：构建后从仓库根目录运行 `node tests/avatar-player.integration.mjs`，会启动测试 Player、执行并行字幕/动作/表情、验证无效动作失败并自动关闭。结果、日志和截图位于 `.test-dist/avatar-player/`，不调用模型或 TTS Provider。

## 外部动画资源包

主程序启动时扫描程序旁的 `MotionPacks/*.motionpack`；编辑器扫描 Unity 项目根目录的 `MotionPacks`。也可传入 `--motion-packs "C:/path/to/packs"` 指定一个独立目录。动作按包内稳定 ID 和显示名称登记，Electron 面板按实际能力生成动作下拉项。新增、替换或删除包后重启程序生效，不需改枚举、菜单代码或重建 Player。

资源包就是 Unity LZ4 AssetBundle，内容为 `AvatarMotionLibrary` ScriptableObject 与其 `.anim` 依赖，不是原始 `.anim` 的改名。只支持当前工程的 Unity `6000.3.11f1`、Windows x64、格式版本 1；升级 Unity 或包结构后需要重新打包。无网络下载与热重载，只安装可信来源的本地包；基础包提供循环待机，动作包可只提供动作。整个安装目录只能有一个基础循环；重复包 ID/动作 ID、坏包、版本不符、非 Humanoid Clip 或 AnimationEvent 会被隔离并写入日志并通过当前界面提示。缺少基础循环时保留程序化姿态，手动动作不可用。首版限制 64 包、单包 128 MiB、每包 256 动作；不是对恶意原生资源的安全沙箱。

**以后添加动作：**

1. 用外部转换器得到 Unity Humanoid `.anim`，导入本工程 `Assets/KataruneLocal/Motions/Baked/`。游戏不包含转换器。
2. 在 Project 窗口选中 `.anim`，执行 `Katarune > Motion Packs > Build Selected Clips or Library`。每个 Clip 生成一个独立包；默认稳定 ID 来自资产 GUID，显示名称来自文件名。
3. 将新生成的 `MotionPacks/*.motionpack` 复制到成品的 `Builds/Windows/MotionPacks/`，重启成品。不要复制 `.meta` 或 AssetBundle 构建用的 `.manifest`。

打包定义保存在 `Assets/KataruneLocal/MotionPacks/*.asset`，可在 Inspector 改显示名、动作 ID、速度等，然后选中该定义重新打包。保留 `.meta` 可让资产 GUID 不随重新导入改变；替换同一个动作时保持 ID，删除旧包，避免重复 ID。

自动化入口可指定稳定 ID 和中文名称，无需编辑源码（在 Unity 工程目录执行）：

```powershell
unity run . --timeout 300 -- -nographics -executeMethod Katarune.Avatar.Editor.AvatarMotionPackBuilder.BuildFromCommandLine --motion-source Assets/KataruneLocal/Motions/Baked/new-dance.anim --motion-id new-dance --motion-name "新舞蹈"
```

打包前会按项目锁定的 UniHumanoid 导出绑定校验全部 Humanoid 曲线。`HumanTrait.MuscleName` 的手指显示名并不是 Unity 动画属性名；未知、冲突或非标准绑定会直接报错，避免出现身体能动但手指静止的半成功结果。转换器的格式错误应在导出端修复，项目不自动改写原始动画，不在播放器做特例。

基础呼吸和现有动作的源库位于 `Assets/KataruneLocal/Motions/AvatarMotionLibrary.asset`，已移出 `Resources`。执行 `Katarune > Motion Packs > Build Local Defaults` 或以下批处理可单独更新基础包：

```powershell
unity run . --timeout 300 -- -nographics -executeMethod Katarune.Avatar.Editor.AvatarMotionPackBuilder.BuildLocalDefaults
```

`00-local-defaults.motionpack` 包含 3.733 秒呼吸循环、四个完整手势与 13 秒「妄想天使之舞」。四手势依次为右手前递、右手摊手、右手放胸口、左手摊手两下；动作完整播放一次后回到呼吸，不包含模型、贴图或衣发物理。VRMA 烘焙仍由现有 `AvatarVrmaLibraryImporter` 承担；新动作优先单独生成包，避免为加入一段动作重新烘焙整个库。

## 动作过渡

基础待机与手动动作复用 Unity 原生 Playables，不需要安装额外动画库。动作切换、停止及自然返回待机统一固定为 `0.25s` 线性过渡。连续打断从所有贡献输入的当前权重继续；重复点击当前动作不重播。尚在淡出的未结束动作保留播放时间，已结束动作以新实例进入，只复用零权重槽。现有行为调度保留在同一 Unity 图的独立分支。

## Build

这套 VRMA 烘焙产物仅含 FK 肌肉曲线，不含 Unity Foot IK 目标；导入器将本机动作库的 `ApplyFootIK` 设为 `false`，保留原片段腿部姿态。其他动作库仍沿用默认配置。

```powershell
unity build . --target StandaloneWindows64 --execute-method Katarune.Avatar.Editor.AvatarBuilder.BuildWindows --editor-version 6000.3.11f1 --allow-dirty-build
```

`AvatarBuilder` 固定把 Windows Player 写入 Unity 工程内的 `Builds/Windows/KataruneAvatar.exe`，不接受可变输出位置，避免从不同工作目录执行时产生多套 Player。它会将已生成的外部资源包复制到旁边的 `MotionPacks`，但不重新生成包，也不清理用户额外安装的包。主程序只在代码变更时重建。

## Run

```powershell
./Builds/Windows/KataruneAvatar.exe -force-d3d11 -force-d3d11-bitblt-model --vrm "C:/path/to/avatar.vrm"
```

Windows Player 使用置顶的全屏透明窗口覆盖选定显示器；背景保持点击穿透。连接 Electron 后，胶囊与临时面板提供聊天、麦克风、角色调整和其他控制；Unity 在窗口内绘制角色及由音频时间轴驱动的字幕。调整时左键旋转、中键移动、滚轮缩放，只改变相机构图。模型选择由 Electron 打开系统文件选择器。`--opaque-window` 仅用于调试，`--soft-outline` 可指定启动表现。

窗口、输入命中、多屏和重置规则见[桌面交互设计](../../docs/00-项目/桌面交互设计.md)。

## Local motion preview

旧的专用舞蹈导入菜单已移除，动作统一通过 `Katarune > Motion Packs > Build Selected Clips or Library` 打包。已完成的本机 MMD 转换、重导出和验证脚本不再放在 `Assets/KataruneLocal/Editor` 中参与主工程编译；未来需要复现时，在具备相应依赖的独立工具工程中执行。正式导入器、动作打包器、待机增强工具以及下述验收资源生成与截图入口继续保留。

需要在已有待机上增强动态时，在 Project 窗口选中循环 Humanoid `.anim`，执行 `Katarune > Avatar > Enhance Selected Idle Clip`。工具另存 `-enhanced.anim`，围绕原曲线的平均姿态放大胸肩（2 倍）、头颈（1.8 倍）和手臂（1.6 倍）变化，保留原时长、循环设置、根节点、腿脚和手指曲线；接近肌肉范围边界时降低增益。它只生成编辑器动画资产，效果需在目标模型上检查，再通过现有资源包流程使用。原始素材及派生动作继续保存在被忽略的本机资产目录。

本机“妄想天使之舞”使用独立 AnyHumanMotionConverter 导出的 `Assets/KataruneLocal/Motions/Baked/dance-delusion-angel.anim`，本机修正工具导出后另存为 `dance-delusion-angel-fixed.anim`，现由外部基础包引用；原始导出保留不变。动作显示名来自资源包配置；命令行可用 `--action dance-delusion-angel`，或传入其他已安装动作的稳定 ID。本机 AnyHumanMotionConverter 2.0.1 的导出器漏用了自带的手指绑定名称映射，导入器的 Spread 别名也存在差异；本机独立修正版统一复用其现有映射，不将二进制补丁或工具纳入项目。按用户要求只保留修正版安装，升级后必须重新核验补丁。转换器不进入项目或游戏，动作源与资源包均被 Git 忽略，公开分发许可未在此确认。

当前不在仓库中固定正式待机或表演 Clip。需要预览技术动作时，从官方页面下载 [Universal Animation Library 1 Standard](https://quaternius.com/packs/universalanimationlibrary.html) 和 [Universal Animation Library 2 Standard](https://quaternius.com/packs/universalanimationlibrary2.html)，然后在 Unity 中打开 `Katarune > Avatar > Import Local Preset Motions...`，选择两个 ZIP 或解压目录。导入器验证 CC0 `License.txt`、配置 Humanoid/循环与 Root Transform，并在被 Git 忽略的 `Assets/KataruneLocal` 下生成一个基础循环和动作预览库。

当前 Standard ZIP 不包含名为 `Wave` 和 `Coughing` 的 Clip，因此本地技术样片分别使用 `Interact` 和 `Consume` 代替；这两个映射只验证白名单控制、重定向和混合，不是最终动作美术。

UAL1 `Idle` 当前只作为技术预览的基础循环，不代表最终待机选择。用户确认正式动作后，应把稳定 ID、通道、循环和退出语义写入 `.kbehavior`，而不是增加角色阶段枚举。

需要对比另一套动作源时，可下载 [Motifect Daily Life Motion Pack](https://motifect.itch.io/motifect-daily-life-motion-pack)，在同一导入窗口选择 ZIP 后执行 `Import Motifect alternate set`。该包没有中性 Idle 和 Cough，因此导入器保留已有基础循环与咳嗽预览，只替换挥手、解释和庆祝三个预览槽。这些历史导入槽只服务原始素材挑选；当前运行时动作菜单由外部包动态生成，不是未来 Unity 工具能力清单。Motifect 原始 FBX 不得作为独立动作素材重新分发。

## Behavior definition assets

`Assets/Katarune/Behaviors` 下的版本化行为定义源统一由严格 `.kbehavior` 导入器编译为 `BehaviorDefinitionAsset`。定义通过 GUID 引用单个 Clip 和可选 Avatar Mask，并声明 Humanoid 能力、六类语义通道申请、入口/循环/退出段、有限循环次数、命名同步点、退出段对应的安全点、回退策略和许可证元数据。Avatar Mask 只用于经过验证的局部动作，不能把任意全身 Clip 自动变成上半身手势。替换动作文件时只需修改定义，不需要增加动作枚举或运行时名称分支；未知字段、缺失资源、非法时间/安全点、重复通道或角色能力不足会返回明确错误。

许可证清单区分 `dev-only`、`prototype-distributable` 和 `commercial-candidate`，并保存取得日期、原始格式、商用/修改/再分发权和仓库策略。原始 FBX、ZIP 与本地预览资产始终被 Git 忽略；只有用户确认且许可证允许收录的规范化 Unity Clip 才能进入仓库。

## Behavior sample status

首轮三样片曾用于验证单 Clip 定义、全身独占通道、有限循环、安全退出和 Humanoid 重定向，验证结论保留在架构与推进文档。对应规范化 `.anim` 已从当前工作树移除，等待用户从本地候选中重新选择；因此它们不是当前可播放内容，也不应由测试假定存在。

## Phase D acceptance scenes

`Assets/Katarune/Scenes/Acceptance` 保留调度诊断场景结构；重新绑定用户确认的动作定义后，可从 Electron 面板选择仓库外 VRM，或以 `--vrm "C:/path/to/avatar.vrm"` 启动。场景左上角显示权威实例状态、播放阶段、同步点、通道所有者和终态原因；组合输入只使用手动口型、默认凝视、行为请求与中断命令，不定义覆盖角色全身的对话阶段。调度表演采用 SmoothStep 固定时长混合：淡入 0.20 秒、自然回基础姿态 0.25 秒、安全退出回基础姿态 0.20 秒、立即取消视觉缓冲 0.12 秒。场景不接 Electron 或真实音频。

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

构建固定 D3D11、关闭 Flip Model/HDR，并启用 URP Alpha Processing。可用 `--screenshot <png>`、`--exit-after-capture` 和 `--exit-on-error` 执行自动烟测；`--capture-delay <seconds>` 可在 0–30 秒范围内延迟截图以观察动作主体。截图模式不显示产品控件。加载器只接受 VRM 1.0，不执行 VRM 0.x 运行时迁移。

## Runtime design

- `IAvatarRuntimeFacade` 是外部控制与语义状态快照的统一入口；`AvatarRuntimeSession` 以 `prepare → validate → commit` 事务更换模型，失败时保留旧角色。
- Core 管理行为契约和通道所有权；Motion 使用单一 PlayableGraph 播放基础循环、调度表演与互斥的手动动作；UniVrm 负责 VRM 1.0 加载、Control Rig、表情与材质适配。
- `AvatarSceneRig` 保存角色投影中心、占屏高度、朝向和 FOV；`AvatarWindow` 负责全屏窗口、局部输入命中、穿透与原生窗口策略。布局和显示器归属由 Electron main 统一管理。
- Unity 根据 AudioSource 实际播放游标驱动字幕与口型，用户转写和角色对白均在角色窗口内绘制。原生 Agent 文本事件可在无音频时按阅读时间显示。
- 默认渲染保留模型材质，柔和描边是可逆选项；灯光由启动场景中的 Light 与 Render Settings 管理，PC 使用 4× MSAA。
- Core、Motion 不引用 UniVRM 或 UniWindowController；测试模型、动作源和构建产物留在 Git 忽略目录。

## Test

项目锁定 `com.unity.pipeline@0.5.0-exp.1`，用于 Unity CLI 连接 Editor、检查状态和执行开发命令；同时提交 UPM 锁文件，测试框架仍保持 `1.6.0`。批处理测试和 Player 构建继续使用上述固定 Editor 版本。

```powershell
unity test . --mode EditMode --output ./Logs/editmode-results.xml --editor-version 6000.3.11f1
unity test . --mode PlayMode --output ./Logs/playmode-results.xml --editor-version 6000.3.11f1
```

设置 `KATARUNE_TEST_VRM_PATH` 后，可单独运行 `LocalPresetMotionSmokeUsesFacadeWhitelist`，在仓库外 VRM 上验证四个动作的能力、启动、打断和取消。未设置时该本地烟测自动跳过。

`AvatarLocalMotionLibraryTests` 从外部包加载动作，使用实际模型覆盖呼吸/手势、腿部姿态、隐藏后再激活、A→B→C 连续打断、重复点击、停止途中切换、结束淡出时重播和图销毁。默认读取本机测试模型，文件缺失时可通过 `KATARUNE_TEST_VRM_PATH` 指定。

模型文件和构建产物不进入版本控制。测试模型的许可元数据可能比同目录说明更严格；只能本地验证，不得随项目分发。

当前已接入 Electron 管理的 Player、动作/表情控制、对白音频、时间戳字幕、uLipSync、Fish 增量 PCM、离线 ASR 与确认式插话代码。自动重连、随安装包分发、真人耳机和外放体验仍待验证；流式文本输入、最终动作资产及面向用户的动作导入界面尚未完成。校准和声画验收见[工程规范](../../docs/04-开发/工程规范.md#语音与-ulipsync-开发验收)。
