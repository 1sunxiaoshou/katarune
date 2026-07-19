# Katarune UI 边界

状态：已采用上游视觉默认值
更新日期：2026-07-20

本文记录言奏对 assistant-ui、shadcn/ui 与 Tailwind CSS 的产品覆盖边界。它不是另一套基础组件库；没有明确产品差异时直接使用上游默认。

## 已决定的实现基线

- 聊天采用 assistant-ui 官方 Registry 成品 Thread，不从无样式 primitives 重新组合常规聊天界面。
- 通用组件采用 shadcn/ui，样式使用 Tailwind CSS，底层采用当前默认的 Base UI 方向。
- 图标统一采用 Lucide，不维护 Iconoir 替换层。
- Registry 组件以本地源码进入仓库，但应尽量保持接近上游。
- 普拉娜与阿洛娜配色必须保留，并映射到 shadcn 标准语义颜色变量。
- 两套主题只改变颜色，不改变组件结构和其他视觉属性。
- Provider、模型与凭据设置页使用 shadcn 默认组件组合，保留原有受信任数据链路。

## 默认优先规则

自定义按以下顺序发生：

1. 直接使用上游组件及默认样式。
2. 通过 shadcn 标准语义颜色变量切换主题。
3. 单一使用场景通过 `className` 调整页面布局。
4. 只有多个真实场景需要同一差异时，才最小修改 Registry 组件源码。
5. 只有成品组件无法表达言奏核心体验时，才下沉到 assistant-ui primitives。

不得为相同 API 再建立 Button、IconButton、Surface 或消息组件包装层。

## 直接使用上游默认

| 项目 | 采用方式 | 说明 |
| --- | --- | --- |
| 字体 | Tailwind/shadcn 默认字体回退 | 不建立言奏字体 token；不额外引入字体文件，除非未来出现经过确认的品牌字体需求。 |
| 内容宽度 | 使用成品组件内置宽度 | Thread、消息正文、Composer 等不重复定义全局阅读宽度；只有没有上游布局所有者的产品页面才自行决定。 |
| 动效 | 使用组件默认动效 | 不建立全局时长与 easing token；仍须尊重 `prefers-reduced-motion`。 |
| 间距与密度 | 使用 Tailwind 尺度和组件默认值 | 不维护平行的 4px token 表。页面组合只选择现有 utility。 |
| 组件状态 | 使用 shadcn 默认状态 | hover、pressed、focus、disabled、loading、invalid 和键盘行为不重复实现。 |
| 可访问行为 | 使用 Base UI、shadcn 与 assistant-ui 默认能力 | 保留可访问名称、Tooltip、焦点可见性和键盘顺序的产品验收。 |
| Thread 结构 | 使用 assistant-ui 成品结构 | 消息、Composer、滚动、附件、Markdown、reasoning、工具组、操作栏、编辑和分支默认不改。 |

## shadcn 默认值与此前言奏要求的结论

对比后决定全部采用 shadcn `base-nova` 默认方向。下表保留决策依据，不再表示待办。

| 项目 | shadcn `base-nova` 默认方向 | 此前言奏要求 | 最终结论 |
| --- | --- | --- | --- |
| 颜色模型 | 标准语义颜色对 | 自定义用途色 | 使用 shadcn 名称；只替换普拉娜/阿洛娜数值并保留会话专用扩展色。 |
| 圆角 | 单个 `--radius: 0.625rem` 派生完整尺度 | 按容器角色维护多组圆角、图标按钮正圆 | 全部使用派生尺度，不强制所有图标按钮正圆。 |
| 表面 | background、card、popover、secondary、muted、accent 分工 | 自建多级 surface | 删除平行 surface 层，使用默认组件表面。 |
| 边框与焦点 | `border`、`input`、`ring` | 额外 strong 边框 | 只使用标准 token。 |
| 阴影 | 由组件默认样式决定 | 普通面板无阴影 | 使用组件默认，不建立阴影 token。 |
| 图标按钮 | Button 的 icon size 与默认 variant | 默认无填充、强调时填充 | 使用组件自身默认形态和 variant。 |
| 信息密度 | 成品组件与 Tailwind 默认间距 | 页面宽松、局部标准密度 | 使用上游默认，只允许具体页面的布局组合。 |

## 必须保留的言奏要求

### 普拉娜主题

- 深色、墨蓝为主背景与表面。
- 红紫承担主强调色。
- 必须为正文、弱文本、边框、焦点、危险和反馈状态提供可访问颜色。

### 阿洛娜主题

- 浅色、冰蓝为主背景与表面。
- 天青承担主强调色。
- 必须与普拉娜主题使用同一套组件和同一组语义变量。

### 会话语义

- 普通会话、当前会话与新建会话必须有不同状态。
- 新建会话使用独立的 `conversation-create` 语义色，不与当前会话共用颜色。
- 后续会话列表采用纵向时间轴形态；这是产品特有布局，不要求由 shadcn 默认提供。

### 设置入口

- 设置是全局低频入口，保持左下角单一图标按钮。
- 设置内容使用独立页面承载。
- 设置内容使用 shadcn 默认组件组合；不建立设置页专属基础组件或平行样式表。

## 组件所有权

| 产品区域 | 默认所有者 | 言奏只负责 |
| --- | --- | --- |
| 聊天滚动、消息和 Composer | assistant-ui Thread | Electron 本地 runtime 接线与角色能力入口 |
| Markdown、附件、reasoning、工具展示 | assistant-ui Registry 组件 | 出现真实产品语义后的最小覆盖 |
| Button、Tooltip、Input、Select、Dialog 等 | shadcn/ui | 选择现有 variant 与页面组合 |
| 菜单、弹窗和交互行为 | Base UI + shadcn/ui | Electron 窗口边界下的验证 |
| 颜色主题 | shadcn 语义 token | 普拉娜/阿洛娜颜色映射与会话扩展色 |
| 会话时间轴 | assistant-ui ThreadList 行为 | 时间轴视觉和新建会话语义 |

## 可访问性验收

即使采用上游默认，仍需验证：

- 正文文本至少 4.5:1，非文字状态和图标至少 3:1。
- Tab 顺序与视觉顺序一致，焦点清晰可见。
- 图标按钮具有可访问名称和 Tooltip。
- 颜色不是错误、选中、启用和进度的唯一表达。
- sticky Composer、浮动按钮与滚动内容不会互相遮挡。
- 普拉娜与阿洛娜主题分别通过相同的交互与对比度测试。

## 覆盖规则

圆角、阴影、表面、边框、字体、内容宽度、动效、信息密度与图标按钮形态不再属于待决策项。只有真实产品用例证明上游默认无法满足需求时，才记录新的产品决策并在具体使用点做最小覆盖。
