# ST-yafaya-Timeline UI 设计状态记录

> 状态：历史设计记录。当前最终视觉基线以同目录下的 `DESIGN.md` 和六个 HTML 原型为准。
>
> 更新时间：2026-08-18  
> 用途：记录当前已确认 / 已冻结的 UI 设计状态，以及下一步继续设计时的起点。  
> 原则：后续给 Google Stitch 的指令继续采用 **短、机械、局部 PATCH**，不要一次修改多个大区域。

---

## 1. 全局设计规则

### 1.1 Shell 是全局冻结区

所有 Tab 共用同一套 Shell，不允许重新设计：

- 顶部品牌：`时间线管理`
- 图标：`fa-solid fa-timeline`
- 顶部导航：
  - 总览
  - 时间线
  - 分组
  - AI分析
  - 日志
  - 设置
- 顶部状态栏：
  - 当前角色：`Rudeus Greyrat`
  - 当前世界书：`Mushoku Tensei`
  - 当前故事时间：`424年5月14日 17:15`
- 右上角：
  - `获取当前时间`
  - Close
- 移动端保留单独的 `获取当前时间` 按钮。

### 1.2 Shell 关键 class

```html
<body class="bg-[#0f172a] text-on-surface-variant dark:text-on-secondary-container min-h-screen flex items-center justify-center p-4 md:p-8 font-body-base antialiased selection:bg-primary-container selection:text-on-primary-container relative overflow-hidden">
```

```html
<main class="w-full max-w-[1200px] max-h-[80vh] glass-panel rounded-xl flex flex-col overflow-hidden ambient-shadow relative z-10 animate-[fadeIn_0.3s_ease-out]">
```

```html
<nav class="docked full-width top-0 sticky z-50 bg-surface/80 dark:bg-inverse-surface/80 backdrop-blur-md border-b border-outline-variant/10">
```

```html
<header class="px-container-padding py-3 border-b border-outline-variant/10 bg-inverse-surface/10">
```

Main Content 外层统一：

```html
<div class="flex-1 overflow-y-auto p-container-padding">
```

### 1.3 顶部导航 active / inactive

Active：

```html
class="px-3 py-2 text-primary-fixed-dim border-b-2 border-primary-fixed-dim pb-1 font-semibold hover:bg-inverse-surface/50 rounded-t-lg transition-all"
```

Inactive：

```html
class="px-3 py-2 text-on-secondary-container hover:text-primary-fixed-dim hover:bg-inverse-surface/50 rounded-lg transition-all"
```

### 1.4 字体 Token

仅使用：

- `body-sm`
- `body-base`
- `headline-md`
- `headline-lg`
- `label-caps`

不要引入不存在的 `headline-sm`、`body-md` 等。

### 1.5 结构面板

静态结构区块不要使用 `.card-subtle`。

统一优先：

```html
bg-white/[0.03]
border border-outline-variant/15
```

`.card-subtle` 仅留给真正需要 hover 抬升的卡片。

---

# 2. 已冻结页面

## 2.1 总览

状态：**已冻结**

总览是整个插件 UI 的视觉母版，后续任何页面不得重做 Shell。

---

## 2.2 时间线

状态：**已冻结**

核心结构：

- 搜索
- 筛选
- 时间线分组
- 当前活动条目
- 自动 / 手动模式
- 纵向时间线卡片
- 日期区间
- 异常 / 待确认状态
- 世界书原条目只读预览

运行逻辑：

- 自动模式：每组唯一正确条目启用
- 手动模式：插件不主动修改开关
- 自动 → 手动保留当前状态
- 手动 → 自动立即重新计算
- 同一条目范围内只更新时间，不写世界书
- gap / conflict 无法唯一匹配时不得猜测

---

## 2.3 分组

状态：**已冻结**

### 左侧分组

- 主线剧情：12
- 洛琪希个人线：8
- 世界局势：34
- 未分组：3

正式分组有 `drag_indicator`。

`未分组` 不显示拖拽图标。

Selected：

```html
w-full text-left px-3 py-3 rounded-lg border border-primary-fixed-dim/30 bg-primary/10
```

Unselected：

```html
w-full text-left px-3 py-3 rounded-lg border border-transparent hover:bg-surface-container-lowest/5
```

### 右侧结构

普通状态显示：

- 分组名称
- 条目数量
- `当前分组中的时间线条目`
- 重命名
- more_horiz

示例条目：

- 米里希昂篇
- 西部港篇
- 王龙王国篇
- 环球探索篇

### 已定义运行时状态

这些不是新页面，只是同一页面组件状态：

#### GroupMoreMenu

菜单项：

- 合并到其他组
- 拆分分组
- 删除分组

#### CreateGroupDialog

只包含：

- 分组名称
- 取消
- 创建

#### RenameEditing

只在 Group Header 内进入编辑态：

- 名称输入框
- `人工`
- `修改后的分组名称将作为人工设定保留`
- 取消
- 保存

---

# 3. AI分析

状态：**已冻结**

AI分析只有一个正式 Tab，不为分析阶段创建额外页面。

所有阶段都是同一 Main Content 的内部状态。

---

## 3.1 Idle

正式基础态：

- 标题：`AI分析`
- 副标题：`扫描当前世界书并生成时间线配置草稿`
- 安全提示：
  - `AI分析不会直接接管时间线`
  - `分析结果仅生成草稿，需要人工确认后才会应用。`
- 快速扫描
- 深度分析
- 当前来源：
  - Mushoku Tensei
  - WORLD BOOK
  - 57 个条目

---

## 3.2 快速扫描 Stage 1

状态：

`本地候选筛选`

示例：

- `18 / 57`
- `32%`

Pipeline：

1. 候选筛选
2. AI 批次分析
3. 汇总结果
4. 结构校验

底部：

`取消分析不会保存任何未完成结果`

---

## 3.3 快速扫描 Stage 2

状态：

`AI 批次分析进行中`

示例：

- `2 / 4`
- `50%`

Stage 1 已完成，Stage 2 active。

不再单独设计“汇总中”和“结构校验中”的独立页面，只移动 active stage。

---

## 3.4 AI 草稿确认

状态：**冻结**

顶部：

- `重新分析`
- `确认并应用`

提示：

- `AI 草稿尚未应用`
- 必须人工确认后才建立自动时间线

Summary：

- 候选条目：18
- 时间线组：3
- 待确认：2
- 未采用：1

### 主线剧情

示例：

- 米里希昂篇
  - 高置信度
  - checked
- 王龙王国篇
  - 需确认
  - checked

### 洛琪希个人线

示例：

- 魔法大学时期
  - 高置信度
  - checked

### 世界局势

- 魔大陆局势
  - 高置信度
  - checked
- 人神动向
  - 低置信度
  - unchecked
  - `时间边界不明确`

低置信度不是错误，使用弱化中性色，不使用 error red。

底部：

`17 个条目将被纳入时间线配置`

---

## 3.5 候选条目内联编辑

状态：**冻结**

用 `王龙王国篇` 作为示例。

不是 Dialog，不是 Modal。

只允许编辑：

1. 时间线标题
2. 开始日期
3. 结束日期

原条目 `世界线-18` 只读。

提示：

`保存后，人工修改的字段将锁定，不再被 AI 自动覆盖`

注意：

- 这是字段级人工锁定
- 不是把整个条目永久锁死

按钮：

- 取消
- 保存修改

---

# 4. 日志

状态：**冻结**

唯一正式视觉基准使用当前“运行日志”页面。

---

## 4.1 运行日志

默认 active：

`运行日志`

Summary：

- 当前聊天
- 最近切换
- 当前状态

日志类型：

- SWITCH
- TIME
- WARNING
- CHECK

当前聊天最多保留：

`100 条`

日志只记录必要运行事件。

不得记录：

- 完整聊天正文
- 完整世界书内容
- API Key
- AI Prompt
- AI 完整 Response

---

## 4.2 系统日志

**不再要求 Stitch 单独画页面。**

原因：

多次 PATCH 均未成功，并且系统日志与运行日志不存在新的布局，只是同一组件的数据和 active 状态变化。

实现时复用运行日志布局。

系统日志 active 后：

Header Action：

`清空系统日志`

Summary：

- 插件状态
- 控制权
- 最近异常

Event：

- CONTROL
- CONFIG
- WRITE
- AI ERROR

视觉等级：

- 正常 / 成功 → tertiary / green
- 普通信息 → primary / blue
- 注意但非故障 → amber `#ffb370`
- 真正失败 → error / red

---

# 5. 设置

状态：**设计进行中**

设置页整体骨架已经冻结。

---

## 5.1 设置页骨架

左侧一级分类只有：

1. 常规
2. AI 分析
3. 自动切换
4. 数据管理

Workspace：

```html
<div class="grid grid-cols-[220px_minmax(0,1fr)] gap-5 min-h-[420px]">
```

左侧：

```html
<section class="rounded-xl p-3 bg-white/[0.03] border border-outline-variant/15">
```

右侧：

```html
<section class="rounded-xl p-5 bg-white/[0.03] border border-outline-variant/15">
```

---

## 5.2 常规

状态：**冻结**

右侧只包含：

### 切换成功通知

默认开启。

说明：

`时间线自动切换成功后显示提示消息`

### 当前世界书

显示：

- Mushoku Tensei
- 已绑定

说明：

`设置仅作用于当前角色绑定的世界书`

---

## 5.3 AI 分析 → SillyTavern API

状态：**冻结**

左侧：

`AI 分析` active

右侧接口提供商：

- SillyTavern API：active
- 独立 API：inactive

当前状态：

- 已连接
- 测试连接

模型选择：

```text
使用 SillyTavern 当前模型
```

### 重要限制

SillyTavern API 模式不得硬编码：

- GPT-4o
- Claude
- Gemini
- 任何具体模型名

插件不在这里声明原生支持 Claude / Gemini 协议。

---

# 6. 当前设计停点

## 当前最后成功状态

**设置 → AI 分析 → SillyTavern API**

该状态已经冻结。

## 当前失败尝试

尝试设计：

**设置 → AI 分析 → 独立 API**

目标原本准备显示：

- API URL
- API Key
- Model
- Temperature
- Max Tokens
- Timeout
- 测试连接

但本次 Stitch 修改 **未成功**。

因此：

> 不将失败结果记为正式 UI。

下一次继续设计时，应从已经冻结的：

`设置 → AI 分析 → SillyTavern API`

继续。

---

# 7. 独立 API 的产品要求（尚未完成 UI）

独立 API 只支持：

`OpenAI-compatible API`

未来 UI 应包含：

- API URL
- API Key
- Model
- Temperature
- Max Tokens
- Timeout
- 测试连接

API Key：

- UI 中默认遮挡
- 不写入日志
- 不进入 JSON 导出
- 不展示完整明文

不要添加：

- Anthropic 原生 API
- Gemini 原生 API
- Claude 原生协议
- Google AI 原生协议
- 自定义 Headers 编辑器
- Prompt 编辑器
- System Prompt 编辑器
- Proxy 设置

---

# 8. 后续尚未完成的设置页面

按顺序继续：

1. AI 分析 → 独立 API
2. 自动切换
3. 数据管理
4. 移动端适配检查

### 自动切换预计包含

- 大跨度时间跳跃阈值
  - 默认：365 天
- 切换成功通知
  - 已在常规页出现，注意不要重复设计成冲突设置
- 与时间解析 / 自动切换有关的必要配置

不要加入“全局暂停所有组”。

### 数据管理预计包含

- 当前世界书配置 JSON 导出
- JSON 导入
- 导入校验
- missing / rematch 提示

明确：

- 不导出 API Key
- 导入后不得立刻取得控制权
- 必须先验证 / 确认

---

# 9. Stitch 工作方式

后续继续遵守：

## PATCH ONLY

每次只修改一个小区域。

优先：

- 精确文本替换
- 精确 class 替换
- 一个 section 内部 children 替换

避免：

- 同时换多个大 section
- 一次生成整个页面
- 让 Stitch 自己推断产品需求

### 推荐格式

```text
PATCH ONLY.

禁止修改：
- Shell
- 其他 Tab
- CSS
- JavaScript

本次唯一允许修改：
<精确范围>

找到：
<旧代码>

替换为：
<新代码>

除此之外不得修改任何代码。
```

如果 Stitch 连续 no-op：

- 不继续堆更长 Prompt
- 缩小到一个按钮 / 一个 class / 一个小 block
- 若该状态不存在新的布局价值，则直接记录为实现态，不再要求 Stitch 出单独视觉稿

---

# 10. 当前结论

当前已经可以视为视觉冻结的主要区域：

- 总览
- 时间线
- 分组
- AI分析
- 日志
- 设置 → 常规
- 设置 → AI分析 → SillyTavern API

当前继续设计的唯一明确起点：

**设置 → AI分析 → 独立 API**

该状态尚未成功生成，不应作为视觉基准。
