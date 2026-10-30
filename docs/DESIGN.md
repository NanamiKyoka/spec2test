# 视觉与布局规范（对齐 DeepSeek 类产品）

## 1. 布局骨架
```
┌───────────────────────────────────────────────────────────┐
│ TopBar: 品牌 · 模型选择器 · 主题切换 · 导航(对话/数据/API)   │  56px
├──────────────┬────────────────────────────────────────────┤
│ Sidebar      │ Main                                       │
│ 260px 固定   │ max-width 820px，居中，左右留白             │
│ · 新建对话   │                                            │
│ · 会话列表   │                                            │
│ · 底部设置   │                                            │
└──────────────┴────────────────────────────────────────────┘
```
- ≤900px：侧栏改为抽屉（点 TopBar 左侧按钮滑出，遮罩关闭）。
- ≤640px：Main 内边距 16px，表格内部横向滚动，页面本身**不得**横向溢出。

## 2. 设计令牌（写入 `style.css` 的 `:root`）
| 用途 | 亮色 | 暗色 |
|---|---|---|
| `--bg` | `#ffffff` | `#0f1115` |
| `--bg-sub` 侧栏 | `#f7f8fa` | `#15181e` |
| `--fg` | `#1a1a1a` | `#e6e8eb` |
| `--fg-muted` | `#6b7280` | `#9aa3ad` |
| `--line` | `#e8e8ec` | `#252a33` |
| `--accent` | `#4d6bfe`（DeepSeek 蓝） | 同 |
| `--ok` / `--warn` / `--bad` | `#0f9d58` / `#b45309` / `#d93025` | 略亮 |
| 圆角 | `--r-sm:6px` `--r-md:10px` `--r-lg:14px` | 同 |
| 阴影 | `--shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.06)` | 加深 |

字体：`system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`；代码用 `ui-monospace`。**不允许远程字体**。

## 3. 组件约定（类名固定，供各页复用）
| 类名 | 形态 |
|---|---|
| `.app` | 整体网格：`grid-template-rows:56px 1fr; grid-template-columns:260px 1fr` |
| `.topbar` / `.topbar__brand` / `.topbar__model` | 顶栏；模型选择器为原生 `<select>` 包一层 `.select` |
| `.sidebar` / `.sidebar__new` / `.session` / `.session--active` | 侧栏；`.session` 单行省略 + 删除按钮 hover 出现 |
| `.main` / `.composer` | 主区；输入框固定底部，圆角 `--r-lg`，聚焦时 `--accent` 描边 |
| `.msg` / `.msg--user` / `.msg--bot` | 消息；用户气泡右对齐浅蓝底，机器人为无底色纯文本块 |
| `.stages` / `.stage` / `.stage__dot` | 六阶段时间线；`skipped` 用 `--fg-muted` 中性色 |
| `.chip` / `.chip--ok` / `.chip--warn` / `.chip--bad` | 状态徽标 |
| `.table` / `.table--tight` | 数据表；表头 sticky、数字列右对齐等宽 |
| `.modal` / `.modal__panel` | 弹窗（设置用），点击遮罩关闭，Esc 关闭 |
| `.btn` / `.btn--primary` / `.btn--ghost` / `.btn--danger` | 按钮 |
| `.empty` | 空态：图标 + 一句说明 + 一个主操作 |

## 4. 交互硬要求
1. 发送后输入框清空，发送中禁用并显示"停止"。
2. 消息区自动滚到底；用户上滚后**不再强制**滚动。
3. 会话列表项 hover 出现删除；删除需确认（原生 `confirm` 即可）。
4. 所有异步失败必须在页面可见（红字 + 原因），不得只进 console。
5. `undefined/null/NaN` 一律渲染 `—`。
6. 键盘：`Enter` 发送、`Shift+Enter` 换行、`Esc` 关弹窗。

## 5. 三个页面的信息架构
- **对话**（`chat.html`）：左会话列表 + 中对话流 + 底部输入（含模型选择器）。首屏无会话时给 4 条示例问题，点击即发。
- **数据**（`index.html`）：顶部 4 个指标卡（用例数/42 字段/2 弃权/误报 0-8）→ 用例矩阵（可点进 `case.html`）→ 运行历史表。
- **API**（`settings.html`）：通道选择 → Base URL → **模型（下拉 + 「获取模型列表」按钮）** → 温度 → Key（掩码）→ 保存 / 测试连接。
