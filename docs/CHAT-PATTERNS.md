# 开源聊天界面交互取证（2026-10-30）

目的：不再凭感觉改对话页，而是**对着成熟实现取证**。以下代码均来自实际抓取的源文件（`curl raw.githubusercontent.com`），抓取至 `_scratch/research/`。

## 1. 取证清单

| 项目 | License | 文件 | 行号 | 大小 |
|---|---|---|---|---|
| `ChatGPTNextWeb/ChatGPT-Next-Web` | MIT | `app/components/chat.tsx` | 264–295、1006–1021 | 72 KB |
| `open-webui/open-webui` | Open WebUI License（BSD-3 基础 + 品牌条款，参考代码时注意） | `src/lib/components/chat/MessageInput.svelte` | 727–750、954–958 | 98 KB |
| `huggingface/chat-ui` | Apache-2.0 | `src/lib/components/chat/ChatInput.svelte` | 348–357、621–622 | 34 KB |

未获取：`Chanzhaoyu/chatgpt-web`（连接重置）、`lobehub/lobe-chat`（路径 404）。

## 2. 六个关键实现

### 2.1 IME 组合输入（最重要）
**ChatGPT-Next-Web, chat.tsx:264–294**
```ts
const isComposing = useRef(false);
useEffect(() => {
  const onCompositionStart = () => { isComposing.current = true; };
  const onCompositionEnd   = () => { isComposing.current = false; };
  window.addEventListener("compositionstart", onCompositionStart);
  window.addEventListener("compositionend", onCompositionEnd);
  return () => {
    window.removeEventListener("compositionstart", onCompositionStart);
    window.removeEventListener("compositionend", onCompositionEnd);
  };
}, []);

const shouldSubmit = (e) => {
  // Fix Chinese input method "Enter" on Safari
  if (e.keyCode == 229) return false;
  if (e.key !== "Enter") return false;
  if (e.nativeEvent.isComposing || isComposing.current) return false;
  ...
};
```
要点：**三个条件任一命中都不发送** —— `keyCode===229`（Safari 中文输入）、`nativeEvent.isComposing`、全局 composition 状态。

### 2.2 Safari 的 compositionend 时序漏洞
**open-webui, MessageInput.svelte:727–750**
```js
let isComposing = false;
let compositionEndedAt = -2e8;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
function inOrNearComposition(event) {
  if (isComposing) return true;
  // Safari/iOS 虚拟键盘：compositionend 与 keydown 几乎同时触发，
  // 需用时间戳接近度（<500ms）判断"这次 Enter 是选词而非换行"
  if (isSafari && Math.abs(event.timeStamp - compositionEndedAt) < 500) {
    compositionEndedAt = -2e8;
    return true;
  }
  return false;
}
```
要点：桌面 Chrome/Edge 不需要；**iOS Safari 必须**，否则选词那次回车会插入换行或误发。

### 2.3 textarea 自增高
**huggingface/chat-ui, ChatInput.svelte:348–357**
```js
textareaElement.style.height = "auto";
textareaElement.style.height = `${textareaElement.scrollHeight}px`;
if (textareaElement.selectionStart === textareaElement.value.length) {
  textareaElement.scrollTop = textareaElement.scrollHeight;
}
```
要点：先 `auto` 再读数（否则只增不减）；**只有光标在末尾时才同步内滚**，否则用户回看前面内容会被拽走。

### 2.4 “是否贴底”的判定
**ChatGPT-Next-Web, chat.tsx:1006–1012**
```ts
const isScrolledToBottom = scrollRef?.current
  ? Math.abs(
      scrollRef.current.scrollHeight -
        (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
    ) <= 1
  : false;
```
要点：用 **`<= 1px` 的严格等式**判贴底，而不是“距离小于某阈值”。留容差会导致“明明在底部却不自动滚”。

### 2.5 平滑回到底部
**open-webui, MessageInput.svelte:954–958**
```js
const scrollToBottom = () => {
  element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
};
```

### 2.6 忙时输入框
三家一致的做法是 **保持可聚焦、只禁止提交/编辑**，而不是 `disabled`：
- NextWeb：`loading` 时按钮变停止，`textarea` 仍可选中文本；
- chat-ui：`disabled` 只用于**发送按钮**，输入框保留。

`disabled` 会丢焦点与光标位置，恢复后光标回到开头——这正是本项目之前修掉的那个 bug。

## 3. 与 `docs/CHAT-CHECKLIST.md` 的逐条对照

对照对象：`web/assets/chat.js`（当前实现）。

| # | 条目 | 状态 | 说明 |
|---|---|---|---|
| A1 | IME 组合输入 | ⚠️ | 有 `isComposing \|\| keyCode===229`（chat.js:681），**缺** compositionstart/end 兜底与 Safari 500ms 守卫 |
| A2 | Enter 发送 / Shift+Enter 换行 | ✅ | |
| A3 | 自增高 + 上限 | ✅ | 650–651，上限 200px |
| A4 | 发送后清空并回焦到末尾 | ✅ | 已修 |
| A5 | 忙时 readOnly 保留光标 | ✅ | 364 |
| B6 | 仅在贴底附近自动滚 | ✅ | 71（阈值 80px） |
| B7 | 「回到底部」浮标 | ✅ | 74、719–720、chat.html:66 |
| B8 | 追加不整体重绘 | ✅ | 轮询只替换阶段节点，`stream` 未被整段清空 |
| B9 | 复制按钮 | ✅ | 219–235（含失败回退） |
| B10 | 行内错误 + 重试 | ✅ | 465 |
| C11 | busy 单一状态驱动 | ✅ | 364–375 |
| C12 | 防重入 | ✅ | submit 首行判断 busy |
| C13 | 停止只中断前端 | ✅ | 674 明确写“后端任务可能仍在运行” |
| C14 | 切换会话先停轮询 | ✅ | 183 |
| D15 | 新建/改名/删除 | ✅ | 双击改名、hover 删除 |
| D16 | 当前会话高亮 | ✅ | |
| D17 | 标题省略 | ⚠️ | 依赖 CSS，未在浏览器验证 |
| E18 | Esc 关闭浮层 | ⚠️ | 只关抽屉（724），未覆盖遮罩/确认框 |
| E19 | 响应式 900/640 | ⚠️ | CSS 已写，未真机验证 |
| E20 | 按钮 aria/title | ✅ | |
| F21 | lang/charset | ✅ | |
| F22 | 中文换行 | ✅ | chat.html:19 |

**结论：22 条中 17 条已达标、5 条为“待验证或边缘缺陷”。**聊天页的问题**不在主干逻辑**，更可能来自：① 后端生成慢（真实调用 30–70 秒）被误认为卡死；② 上述 5 条边缘项；③ 未在真实浏览器验证过的布局。

## 4. 推荐方案

**直接照抄**（与我方轮询架构无冲突）：
- 2.1 的“三条件任一命中不发送”
- 2.3 的 auto→scrollHeight + 仅在光标末尾时同步内滚
- 2.4 的 `<=1px` 贴底判定（我们目前用 80px 阈值，偏松）
- 2.6 的“只禁发送、不禁输入”

**需要适配**（我们没有 SSE）：轮询期间**只更新阶段节点**，不要重绘消息流；轮询间隔 0.5s 在真实生成（30–70s）下会显得“没反应”，建议改为 **1s 起、指数退避到 3s**，并在气泡内显示已用时长。

**优先修三条**
1. 贴底判定从 80px 改为 `<=1px`，并把“自动滚”收敛为“仅当用户原本就在底部”（B6 的阈值会让用户轻微上滚时仍被拽下去）。
2. `Esc` 统一关闭所有浮层（抽屉/遮罩/确认），并支持点击遮罩关闭。
3. 轮询节奏：0.5s → 1s 起退避，并在助手气泡显示“已等待 N 秒 · 当前阶段 X”，把“慢”变成可见进度，而不是看起来像卡住。
