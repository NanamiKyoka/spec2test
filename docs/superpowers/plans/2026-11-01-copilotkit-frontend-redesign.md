# 前端整体重做（Next.js + CopilotKit）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 Vite SPA 迁移到 Next.js App Router，真接入 CopilotKit 运行时，并把前端重做成 chat-first 的信息架构（对话为主、能力以 action 卡片呈现、HITL 审批、结果卡片回填）。

**Architecture:** 浏览器只连 :3000 的 Next 服务；Next 的 `/api/copilotkit` 用 `CopilotRuntime + AnthropicAdapter` 直连本地 :15721 OpenCode 代理，其余 `/api/*`、`/data/*`、`/results/*` 用 `afterFiles` rewrite 转发到 :8000 的 Python 服务。Python 协议零改动，只删除对 `web/index.html` 的强依赖。

**Tech Stack:** Next 16.4.3 / React 19 / TypeScript 5.6 / Tailwind 3.4 / CopilotKit 1.83.0 / @anthropic-ai/sdk 1.3.0 / Vitest / Playwright。

---

## 文件结构

```
webapp/
  package.json  tsconfig.json  next.config.ts  postcss.config.js  tailwind.config.js
  app/
    layout.tsx                  # 根布局：CopilotProvider + ToastProvider
    page.tsx                    # 对话工作台（chat-first）
    globals.css                 # 由 app/src/styles.css 复制
    data/page.tsx  eval/page.tsx  api/page.tsx  about/page.tsx
    case/[id]/page.tsx
    api/copilotkit/route.ts     # CopilotKit runtime
  ui/index.tsx                  # 由 app/src/ui/index.tsx 复制
  lib/
    api.ts  export.ts  stages.ts  plain.ts  evidence.ts  cn.ts   # 复制并改同源
    jobStore.ts                 # 新增：任务状态 + 按用例索引
    followJob.ts                # 新增：SSE 追随 + 轮询回退
  components/
    AsyncState.tsx  OfflineBanner.tsx  StageTimeline.tsx          # 复制
    RunRail.tsx                 # 新增：左栏用例速览 + 最近运行
    StatusBar.tsx               # 新增：顶栏连接状态
    CopilotProvider.tsx         # 新增
    copilot/
      actions.tsx               # useCopilotAction / useCopilotReadable
      RunCard.tsx  ApprovalCard.tsx  ResultCard.tsx  TracePanel.tsx
  views/                        # 由 app/src/views 复制（不含 ChatView）
  e2e/workspace.spec.ts  e2e/cards.spec.ts
  vitest.config.ts  playwright.config.ts
```

约定：
- 所有交互组件文件首行 `"use client";`。
- 路径别名 `@/*` 指向 `webapp/` 根。
- 端口：Next `3000`，Python `8000`，代理 `15721`。
- 每个任务结束都提交；提交前先跑该任务列出的验证命令。

---

### Task 1: 脚手架与构建基线

**Files:**
- Create: `webapp/package.json`, `webapp/tsconfig.json`, `webapp/next.config.ts`, `webapp/postcss.config.js`, `webapp/tailwind.config.js`, `webapp/app/layout.tsx`, `webapp/app/page.tsx`, `webapp/app/globals.css`, `webapp/.gitignore`

- [ ] **Step 1: 建 `webapp/package.json`**

```json
{
  "name": "spec2test-webapp",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "1.3.0",
    "@copilotkit/react-core": "1.83.0",
    "@copilotkit/react-ui": "1.83.0",
    "@copilotkit/runtime": "1.83.0",
    "@fontsource-variable/inter": "5.1.0",
    "@radix-ui/react-dialog": "1.1.2",
    "@radix-ui/react-tooltip": "1.1.3",
    "class-variance-authority": "0.7.0",
    "clsx": "2.1.1",
    "lucide-react": "0.454.0",
    "next": "16.4.3",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "tailwind-merge": "2.5.4",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.64.1",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.47",
    "tailwindcss": "3.4.14",
    "typescript": "5.6.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: 建 `webapp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 建 `webapp/next.config.ts`**

```ts
import type { NextConfig } from "next";

const PY = process.env.PY_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    // afterFiles：先匹配 app/api/* 的真实路由（/api/copilotkit），其余再转给 Python
    return {
      afterFiles: [
        { source: "/api/:path*", destination: `${PY}/api/:path*` },
        { source: "/data/:path*", destination: `${PY}/data/:path*` },
        { source: "/results/:path*", destination: `${PY}/results/:path*` },
      ],
    };
  },
};

export default nextConfig;
```

- [ ] **Step 4: 建 `webapp/postcss.config.js` 与 `webapp/tailwind.config.js`**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./views/**/*.{ts,tsx}", "./ui/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        "accent-solid": "rgb(var(--accent-solid) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-ink": "rgb(var(--ok-ink) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-ink": "rgb(var(--warn-ink) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        "bad-ink": "rgb(var(--bad-ink) / <alpha-value>)",
      },
      borderRadius: { sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)" },
      fontFamily: {
        sans: ["Inter Variable", "system-ui", "-apple-system", "Segoe UI", "Microsoft YaHei", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06)" },
    },
  },
  plugins: [],
};
```

- [ ] **Step 5: 复制样式**

把 `app/src/styles.css` 全文复制为 `webapp/app/globals.css`，把其中 `html, body, #root` 选择器改为 `html, body`（Next 没有 `#root`）。

- [ ] **Step 6: 建 `webapp/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spec2Test",
  description: "把 3GPP 测试条款编译成可校验的测试意图",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-full">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: 建占位 `webapp/app/page.tsx`**

```tsx
export default function Page() {
  return <main className="p-6">Spec2Test</main>;
}
```

- [ ] **Step 8: 建 `webapp/.gitignore`**

```
node_modules/
.next/
test-results/
playwright-report/
```

- [ ] **Step 9: 安装依赖**

Run: `cd webapp && npm install`
Expected: `added N packages`，无 `ERESOLVE`。若 React 19 与 CopilotKit 报 peer 冲突，先确认 `react`/`react-dom` 都是 19.x 再重试。

- [ ] **Step 10: 验证构建**

Run: `cd webapp && npm run build`
Expected: `✓ Compiled successfully`，生成 `.next/`。

- [ ] **Step 11: 提交**

```bash
git add webapp/package.json webapp/package-lock.json webapp/tsconfig.json webapp/next.config.ts \
  webapp/postcss.config.js webapp/tailwind.config.js webapp/.gitignore \
  webapp/app/layout.tsx webapp/app/page.tsx webapp/app/globals.css
git commit -m "feat(webapp): Next.js + CopilotKit 脚手架"
```

---

### Task 2: Python 转发与离线可用

**Files:**
- Modify: `webapp/app/page.tsx`

- [ ] **Step 1: 让占位页展示后端健康信息**

```tsx
"use client";

import { useEffect, useState } from "react";

export default function Page() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      {error ? `后端不可达：${error}` : JSON.stringify(health)}
    </main>
  );
}
```

- [ ] **Step 2: 先起 Python，再起 Next**

Run:
```bash
py -3.12 scripts/serve.py --port 8000 --no-browser
# 另开一个终端
cd webapp && npm run dev
```

- [ ] **Step 3: 验证 rewrite**

Run: `curl -s http://127.0.0.1:3000/api/health`
Expected: 返回 `{"ok":true,...}`（与 `http://127.0.0.1:8000/api/health` 相同）。

Run: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/results/score/report.json`
Expected: `200`。

- [ ] **Step 4: 提交**

```bash
git add webapp/app/page.tsx
git commit -m "feat(webapp): 通过 rewrite 复用 Python API"
```

---

### Task 3: CopilotKit runtime 路由

**Files:**
- Create: `webapp/app/api/copilotkit/route.ts`

- [ ] **Step 1: 写 runtime 路由**

```ts
import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicAdapter,
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

export const dynamic = "force-dynamic";

const runtime = new CopilotRuntime();

// @ai-sdk/anthropic appends `/messages` to the base URL, so it must end in /v1.
function anthropicBase(url?: string) {
  const u = (url || "http://127.0.0.1:15721").replace(/\/+$/, "");
  return u.endsWith("/v1") ? u : `${u}/v1`;
}

const serviceAdapter = new AnthropicAdapter({
  anthropic: new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "local-proxy",
    baseURL: anthropicBase(process.env.LLM_BASE_URL),
    defaultHeaders: {
      "user-agent": "claude-cli/1.0 (external)",
      "x-opencode-session": process.env.LLM_SESSION_ID || "spec2test-webapp",
    },
  }),
  model: process.env.LLM_MODEL || "claude-sonnet-4-6[1M]",
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

export const POST = handleRequest;
```

- [ ] **Step 2: 启动并验证路由存在**

CopilotKit 1.83 的 Next 端点是 v2 单路由协议：POST `{method, params, body}`，不是 GraphQL。

Run: `curl -s -X POST http://127.0.0.1:3000/api/copilotkit -H "content-type: application/json" -d '{"method":"info"}'`
Expected: 200，JSON 含 `"version":"1.83.0"` 与 `"agents":{"default":...}`；不得是 404 或 rewrite 到 Python 的 `{"error":"not_found"}`。

- [ ] **Step 3: 验证模型通道（真实调用）**

Run:
```bash
curl -s -N -X POST http://127.0.0.1:3000/api/copilotkit \
  -H "content-type: application/json" \
  -d '{"method":"agent/run","params":{"agentId":"default"},"body":{"threadId":"t1","runId":"r1","messages":[{"id":"m1","role":"user","content":"只回复两个字：收到"}],"tools":[],"context":[],"state":{},"forwardedProps":{}}}'
```
Expected: SSE 事件流包含 `RUN_STARTED`、`TEXT_MESSAGE_CONTENT`（内容含「收到」）、`RUN_FINISHED`，不得出现 `RUN_ERROR`。若报 `Not Found`，检查 baseURL 是否以 `/v1` 结尾；若 403，检查 `user-agent` 与 `x-opencode-session` 请求头。

- [ ] **Step 4: 提交**

```bash
git add webapp/app/api/copilotkit/route.ts
git commit -m "feat(webapp): CopilotKit runtime 接入本地 Anthropic 代理"
```

---

### Task 4: 迁移共享库（同源 fetch）

**Files:**
- Create: `webapp/lib/{api,cn,export,evidence,plain,stages}.ts`（复制）
- Create: `webapp/vitest.config.ts`
- Test: `webapp/lib/__tests__/api.test.ts`

- [ ] **Step 1: 复制文件**

Run:
```bash
mkdir -p webapp/lib/__tests__
cp app/src/lib/api.ts app/src/lib/cn.ts app/src/lib/export.ts app/src/lib/evidence.ts app/src/lib/plain.ts app/src/lib/stages.ts webapp/lib/
```
`api.ts` 已是相对路径 `/api/...`，无需改 baseURL；`export.ts` 使用 `document`，在客户端组件中调用即可。

- [ ] **Step 2: 建 `webapp/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: { environment: "node", include: ["lib/**/*.test.ts", "components/**/*.test.ts"] },
});
```

- [ ] **Step 3: 写失败测试 `webapp/lib/__tests__/api.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ApiError, pollJob, type Job } from "../api";

describe("api 基础契约", () => {
  it("ApiError 保留状态码与错误码", () => {
    const e = new ApiError(409, "run_in_progress", "run_in_progress");
    expect(e.status).toBe(409);
    expect(e.code).toBe("run_in_progress");
  });
  it("pollJob 在终态停止并返回最后一次快照", async () => {
    const seq: Job[] = [
      { state: "running", log: [] },
      { state: "done", log: [], verdict: "pass" },
    ];
    let i = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => seq[Math.min(i++, seq.length - 1)],
    })) as unknown as typeof fetch;
    try {
      const ac = new AbortController();
      const job = await pollJob("j1", () => {}, ac.signal, 5000);
      expect(job.state).toBe("done");
      expect(job.verdict).toBe("pass");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
```

- [ ] **Step 4: 运行测试（先看它能否跑起来）**

Run: `cd webapp && npx vitest run lib/__tests__/api.test.ts`
Expected: 2 passed（`pollJob` 首次等待 1000ms，总耗时约 1s）。

- [ ] **Step 5: 提交**

```bash
git add webapp/lib webapp/vitest.config.ts
git commit -m "feat(webapp): 迁移共享库并加 Vitest 基线"
```

---

### Task 5: 迁移 UI 基础组件与五个视图

**Files:**
- Create: `webapp/ui/index.tsx`、`webapp/components/{AsyncState,OfflineBanner,StageTimeline}.tsx`、`webapp/views/{DataView,EvalView,ApiView,AboutView,CaseView}.tsx`（复制）

- [ ] **Step 1: 复制文件**

Run:
```bash
mkdir -p webapp/ui webapp/components webapp/views
cp app/src/ui/index.tsx webapp/ui/index.tsx
cp app/src/components/AsyncState.tsx app/src/components/OfflineBanner.tsx app/src/components/StageTimeline.tsx webapp/components/
cp app/src/views/DataView.tsx app/src/views/EvalView.tsx app/src/views/ApiView.tsx app/src/views/AboutView.tsx app/src/views/CaseView.tsx webapp/views/
```

- [ ] **Step 2: 给每个复制文件首行加 `"use client";`**

对以下 8 个文件逐一在文件第 1 行插入 `"use client";`：
`webapp/ui/index.tsx`、`webapp/components/{AsyncState,OfflineBanner,StageTimeline}.tsx`、`webapp/views/{DataView,EvalView,ApiView,AboutView,CaseView}.tsx`。

- [ ] **Step 3: 改写 hash 导航**

在每个视图顶部加：

```tsx
import { useRouter } from "next/navigation";
const router = useRouter();
```

并按下表替换（`window.location.hash = X` → `router.push(Y)`）：

| 旧 | 新 |
|---|---|
| `#/data` | `/data` |
| `#/eval` | `/eval` |
| `#/api` | `/api` |
| `#/chat` | `/` |
| `#/case?case=${encodeURIComponent(id)}` | `/case/${encodeURIComponent(id)}` |

`ApiView.tsx:408` 的 `href="#/chat"` 改成 `href="/"`。
`AboutView.tsx:60` 的三元改为 `caseId ? \`/case/${caseId}\` : "/data"`。

- [ ] **Step 4: 类型检查**

Run: `cd webapp && npx tsc --noEmit`
Expected: 只剩“找不到 app/ 路由文件”之外的错误；本步骤结束时必须 0 错误。若 `CaseView` 依赖 `../lib/...` 相对路径，已因目录结构一致而无需改。

- [ ] **Step 5: 提交**

```bash
git add webapp/ui webapp/components webapp/views
git commit -m "refactor(webapp): 迁移基础组件与五个视图"
```

---

### Task 6: 路由页与 hash 兜底

**Files:**
- Create: `webapp/app/data/page.tsx`、`eval/page.tsx`、`api/page.tsx`、`about/page.tsx`、`case/[id]/page.tsx`
- Modify: `webapp/app/page.tsx`

- [ ] **Step 1: 建四个薄路由页**

`webapp/app/data/page.tsx`：
```tsx
"use client";
import { DataView } from "@/views/DataView";
export default function Page() { return <DataView />; }
```

`webapp/app/eval/page.tsx`：
```tsx
"use client";
import { EvalView } from "@/views/EvalView";
export default function Page() { return <EvalView />; }
```

`webapp/app/api/page.tsx`：
```tsx
"use client";
import { ApiView } from "@/views/ApiView";
export default function Page() { return <ApiView />; }
```

`webapp/app/about/page.tsx`：
```tsx
"use client";
import { AboutView } from "@/views/AboutView";
export default function Page() { return <AboutView />; }
```

- [ ] **Step 2: 建单例页**

`webapp/app/case/[id]/page.tsx`：
```tsx
"use client";
import { use } from "react";
import { CaseView } from "@/views/CaseView";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CaseView caseId={decodeURIComponent(id)} />;
}
```

- [ ] **Step 3: 让根页兜底旧 hash**

替换 `webapp/app/page.tsx`：
```tsx
"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    if (!path) return;
    if (path === "case") {
      const id = new URLSearchParams(query || "").get("case");
      if (id) window.location.replace(`/case/${encodeURIComponent(id)}`);
      return;
    }
    if (["data", "eval", "api", "about", "chat"].includes(path)) {
      window.location.replace(path === "chat" ? "/" : `/${path}`);
    }
  }, []);
  return null;
}
```

- [ ] **Step 4: 验证路由**

Run（Python 与 Next 均在跑）：
```bash
curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:3000/data
curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:3000/eval
curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:3000/api
curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:3000/about
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/case/6.7.1.3
```
Expected: `200 200 200 200 200`。

- [ ] **Step 5: 提交**

```bash
git add webapp/app
git commit -m "feat(webapp): 新路由与旧 hash 重定向"
```

---

### Task 7: 任务状态 store（TDD）

**Files:**
- Create: `webapp/lib/jobStore.ts`, `webapp/lib/followJob.ts`
- Test: `webapp/lib/__tests__/jobStore.test.ts`

- [ ] **Step 1: 写失败测试**

`webapp/lib/__tests__/jobStore.test.ts`：
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJob, getJobByCase, getLatestJob, resetJobs, setJob, subscribeJobs } from "../jobStore";

beforeEach(() => resetJobs());

describe("jobStore", () => {
  it("按 jobId 与用例双索引", () => {
    setJob("j1", { state: "running", log: [], case: "6.7.1.3" });
    expect(getJob("j1")?.state).toBe("running");
    expect(getJobByCase("6.7.1.3")?.state).toBe("running");
  });

  it("同用例新任务覆盖旧任务", () => {
    setJob("j1", { state: "done", log: [], case: "6.7.1.3" });
    setJob("j2", { state: "running", log: [], case: "6.7.1.3" });
    expect(getJobByCase("6.7.1.3")?.state).toBe("running");
    expect(getJob("j1")?.state).toBe("done");
  });

  it("订阅者在更新时收到通知", () => {
    const fn = vi.fn();
    const off = subscribeJobs(fn);
    setJob("j1", { state: "queued", log: [], case: "6.7.1.3" });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("最新任务指向最后一次写入", () => {
    setJob("j1", { state: "done", log: [], case: "6.7.1.3" });
    setJob("j2", { state: "running", log: [], case: "6.7.1.10" });
    expect(getLatestJob()?.case).toBe("6.7.1.10");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd webapp && npx vitest run lib/__tests__/jobStore.test.ts`
Expected: FAIL，`Cannot find module '../jobStore'`。

- [ ] **Step 3: 实现 `webapp/lib/jobStore.ts`**

```ts
import type { Job } from "./api";

type JobWithCase = Job & { case?: string };

const byId = new Map<string, JobWithCase>();
const byCase = new Map<string, JobWithCase>();
const listeners = new Set<() => void>();
let latestId: string | null = null;

export function setJob(jobId: string, job: JobWithCase) {
  byId.set(jobId, job);
  if (job.case) byCase.set(job.case, job);
  latestId = jobId;
  listeners.forEach((fn) => fn());
}

export function getJob(jobId: string) {
  return byId.get(jobId);
}

export function getJobByCase(caseId: string) {
  return byCase.get(caseId);
}

export function getLatestJob() {
  return latestId ? byId.get(latestId) : undefined;
}

export function subscribeJobs(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetJobs() {
  byId.clear();
  byCase.clear();
  listeners.clear();
  latestId = null;
}
```

- [ ] **Step 4: 运行通过**

Run: `cd webapp && npx vitest run lib/__tests__/jobStore.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 实现 `webapp/lib/followJob.ts`**

```ts
import { api, pollJob, type Job } from "./api";
import { setJob } from "./jobStore";

export type FollowResult = { job: Job; sseOk: boolean };

/** 订阅任务；stopAtApproval 时在待审批处提前返回。SSE 断开返回 sseOk=false 由调用方轮询。 */
export function followJob(
  jobId: string,
  caseId: string,
  signal: AbortSignal,
  stopAtApproval = false
): Promise<FollowResult> {
  return new Promise((resolve) => {
    let settled = false;
    let last: Job = { state: "queued", log: [] };
    let es: EventSource | null = null;

    const done = (sseOk: boolean) => {
      if (settled) return;
      settled = true;
      es?.close();
      resolve({ job: last, sseOk });
    };

    if (typeof EventSource === "undefined") return done(false);

    try {
      es = new EventSource(`/api/job/${jobId}/stream`);
    } catch {
      return done(false);
    }

    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as Job;
        last = job;
        setJob(jobId, { ...job, case: caseId });
        const terminal = job.state === "done" || job.state === "failed";
        if (terminal || (stopAtApproval && job.state === "awaiting_approval")) done(true);
      } catch {
        /* 坏帧忽略 */
      }
    };
    es.onerror = () => done(false);
    signal.addEventListener("abort", () => done(false), { once: true });
  });
}

export async function startRun(caseId: string, hitl: boolean, conversationId?: string) {
  const { job_id } = await api.run(caseId, `运行用例 ${caseId}`, conversationId, hitl);
  setJob(job_id, { state: "queued", log: [], case: caseId });
  return job_id;
}

export async function waitTerminal(jobId: string, caseId: string, signal: AbortSignal) {
  const r = await followJob(jobId, caseId, signal, false);
  if (!r.sseOk) return pollJob(jobId, (j) => setJob(jobId, { ...j, case: caseId }), signal);
  return r.job;
}
```

- [ ] **Step 6: 提交**

```bash
git add webapp/lib/jobStore.ts webapp/lib/followJob.ts webapp/lib/__tests__/jobStore.test.ts
git commit -m "feat(webapp): 任务状态 store 与 SSE 追随"
```

---

### Task 8: CopilotKit Provider 与对话外壳

**Files:**
- Create: `webapp/components/CopilotProvider.tsx`, `webapp/components/StatusBar.tsx`, `webapp/components/RunRail.tsx`
- Modify: `webapp/app/layout.tsx`, `webapp/app/page.tsx`

- [ ] **Step 1: 建 Provider**

```tsx
"use client";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  // 1.83 的 Next 端点只实现 v2 单路由协议，必须显式开启单端点传输
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint>
      {children}
    </CopilotKit>
  );
}
```

- [ ] **Step 2: 接进 layout**

```tsx
import { CopilotProvider } from "@/components/CopilotProvider";
// ...
<body className="h-full">
  <CopilotProvider>{children}</CopilotProvider>
</body>
```

- [ ] **Step 3: 建 `StatusBar.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Health = { provider?: string; model?: string; data_source?: string };

export function StatusBar() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const check = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((h) => { setHealth(h); setOffline(false); })
        .catch(() => setOffline(true));
    check();
    const id = window.setInterval(check, 15000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <span className="font-semibold">Spec2Test</span>
      <nav className="flex gap-2 text-sm text-muted">
        <Link href="/">对话</Link>
        <Link href="/data">数据</Link>
        <Link href="/eval">评测</Link>
        <Link href="/api">API</Link>
        <Link href="/about">关于</Link>
      </nav>
      <span className="ml-auto text-xs text-muted">
        {offline ? "后端未连接" : `${health?.provider ?? "—"} · ${health?.model ?? "—"}`}
      </span>
    </header>
  );
}
```

- [ ] **Step 4: 建 `RunRail.tsx`（用例速览 + 最近运行）**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type CaseItem, type RunRec } from "@/lib/api";

export function RunRail({ onPickRun }: { onPickRun: (run: RunRec) => void }) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
    api.runs(8).then(setRuns).catch(() => setRuns([]));
  }, []);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line">
      <div className="px-3 pt-3 text-xs uppercase tracking-wide text-muted">用例</div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 text-sm">
        {cases.map((c) => (
          <li key={c.case}>
            <Link
              href={`/case/${c.case}`}
              className="block truncate rounded px-2 py-1.5 hover:bg-surface"
              title={c.title}
            >
              <span className="font-mono text-xs">{c.case}</span>
              <span className="ml-2 text-muted">{c.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 py-2 text-xs uppercase tracking-wide text-muted">最近运行</div>
      <ul className="max-h-48 overflow-y-auto px-2 pb-2 text-xs">
        {runs.map((r) => (
          <li key={r.job_id}>
            <button
              className="w-full truncate rounded px-2 py-1 text-left hover:bg-surface"
              onClick={() => onPickRun(r)}
              title={r.summary || r.state}
            >
              {r.case} · {r.verdict ?? r.state}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 5: 建对话工作台 `app/page.tsx`**

```tsx
"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useEffect } from "react";
import { StatusBar } from "@/components/StatusBar";
import { RunRail } from "@/components/RunRail";
import { CopilotActions } from "@/components/copilot/actions";

const INSTRUCTIONS = `你是 Spec2Test 的测试意图编译器助手，只覆盖 3GPP TS 38.523-1 §6.7 的 8 个 NR NTN 用例。
规则：
1. 用户给出用例号或能对应到某用例的场景时，调用 run_case；不确定就追问。
2. 所有数字与判定只能来自 action 返回结果，禁止自行生成。
3. abstained 是弃权、reject 是拒收，都不能说成“通过”；failed 直接说明失败原因。
4. 不编造不存在的用例号；范围外请求明确说明只覆盖 §6.7 的 8 个用例。`;

export default function Page() {
  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    if (!path) return;
    if (path === "case") {
      const id = new URLSearchParams(query || "").get("case");
      if (id) window.location.replace(`/case/${encodeURIComponent(id)}`);
      return;
    }
    if (["data", "eval", "api", "about", "chat"].includes(path)) {
      window.location.replace(path === "chat" ? "/" : `/${path}`);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex min-h-0 flex-1">
        <RunRail onPickRun={() => {}} />
        <main className="relative min-w-0 flex-1">
          <CopilotActions />
          <CopilotChat
            className="h-full"
            labels={{
              title: "Spec2Test 助手",
              initial:
                "给我用例号（如 6.7.1.3），或描述场景（卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选）。",
            }}
            instructions={INSTRUCTIONS}
          />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 建占位 actions（Task 9 实现）**

`webapp/components/copilot/actions.tsx`：
```tsx
"use client";

export function CopilotActions() {
  return null;
}
```

- [ ] **Step 7: 验证编译**

Run: `cd webapp && npm run build`
Expected: `✓ Compiled successfully`。

- [ ] **Step 8: 提交**

```bash
git add webapp/components webapp/app
git commit -m "feat(webapp): CopilotKit 对话外壳与会话栏"
```

---

### Task 9: `run_case` action 与 RunCard

**Files:**
- Create: `webapp/components/copilot/RunCard.tsx`
- Modify: `webapp/components/copilot/actions.tsx`

- [ ] **Step 1: 建 RunCard**

```tsx
"use client";

import { useSyncExternalStore } from "react";
import { getJobByCase, subscribeJobs } from "@/lib/jobStore";

export function RunCard({ caseId }: { caseId: string }) {
  const job = useSyncExternalStore(
    subscribeJobs,
    () => getJobByCase(caseId),
    () => undefined
  );

  if (!job) {
    return <div className="rounded-md border border-line bg-surface p-3 text-sm text-muted">准备运行 {caseId}…</div>;
  }

  const done = job.state === "done" || job.state === "failed";
  const pct = done ? 100 : Math.min(95, (job.log?.length ?? 0) * 12);

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">用例 {caseId}</span>
        <span className="text-xs text-muted">{job.state}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
        <div className="h-full bg-accent-solid transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="scroll-thin mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
        {(job.log ?? []).slice(-8).map((l, i) => (
          <li key={i}>{l.msg}</li>
        ))}
      </ul>
      {job.state === "awaiting_approval" && (
        <div className="mt-2 rounded border border-line bg-canvas p-2">
          <div className="text-xs">候选消息：{(job.approval?.candidates ?? []).join(" / ") || "—"}</div>
          <div className="mt-1 text-xs text-muted">在对话里确认后继续；也可用审批卡操作。</div>
        </div>
      )}
      {job.state === "failed" && (
        <div className="mt-2 text-xs text-bad">运行失败，未生成结果。</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 实现 `run_case` action**

`webapp/components/copilot/actions.tsx`：
```tsx
"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import { api, type CaseItem } from "@/lib/api";
import { followJob, startRun } from "@/lib/followJob";
import { getJob } from "@/lib/jobStore";
import { RunCard } from "./RunCard";

const CURRENT = "s2t-current-conv";

export function CopilotActions() {
  const [cases, setCases] = useState<CaseItem[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
  }, []);

  useCopilotReadable({
    description: "当前系统支持的 §6.7 用例清单（case=用例号，title=标题）",
    value: cases.map((c) => ({ case: c.case, title: c.title })),
  });

  useCopilotAction({
    name: "run_case",
    description: "运行一个 §6.7 用例并返回判定结果。hitl=true 时会在候选消息处暂停等待人工批准。",
    parameters: [
      { name: "case", type: "string", description: "用例号，如 6.7.1.3", required: true },
      { name: "hitl", type: "boolean", description: "是否启用人工审批", required: false },
    ],
    handler: async ({ case: caseId, hitl }: { case: string; hitl?: boolean }) => {
      const known = cases.find((c) => c.case === caseId);
      if (!known) return JSON.stringify({ error: "unknown_case", case: caseId });

      const conversationId = localStorage.getItem(CURRENT) || undefined;
      const jobId = await startRun(caseId, Boolean(hitl), conversationId);
      const ac = new AbortController();
      const { job, sseOk } = await followJob(jobId, caseId, ac.signal, true);

      if (!sseOk) {
        return JSON.stringify({ job_id: jobId, state: "unknown", note: "SSE 不可用，请打开结果卡片确认" });
      }
      if (job.state === "awaiting_approval") {
        return JSON.stringify({
          job_id: jobId,
          state: "awaiting_approval",
          candidates: job.approval?.candidates ?? [],
          next: "请让用户确认候选消息，然后调用 approve_candidates",
        });
      }
      return JSON.stringify(summarize(jobId, job));
    },
    render: ({ args, status }) => <RunCard caseId={args.case ?? ""} />,
  });

  return null;
}

function summarize(jobId: string, job: { state?: string; verdict?: string | null; result?: { detail?: { L1?: number; L3?: number | null; violations?: unknown[] } } }) {
  return {
    job_id: jobId,
    state: job.state,
    verdict: job.verdict ?? null,
    L1: job.result?.detail?.L1 ?? null,
    L3: job.result?.detail?.L3 ?? null,
    violations: job.result?.detail?.violations ?? [],
  };
}
```

- [ ] **Step 3: 验证编译**

Run: `cd webapp && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 真实验证（dry-run）**

在浏览器打开 `http://127.0.0.1:3000/`，输入「用 dry-run 跑一下 6.7.1.3」，确认出现 `RunCard` 且阶段前进到 done，助手回复包含 verdict=`pass`。

- [ ] **Step 5: 提交**

```bash
git add webapp/components/copilot
git commit -m "feat(webapp): run_case action 与运行卡片"
```

---

### Task 10: `approve_candidates` action 与审批卡

**Files:**
- Create: `webapp/components/copilot/ApprovalCard.tsx`
- Modify: `webapp/components/copilot/actions.tsx`

- [ ] **Step 1: 建 ApprovalCard**

```tsx
"use client";

import { api, type JobCandidate } from "@/lib/api";

export function ApprovalCard({
  jobId,
  candidates,
  onDecide,
  busy,
}: {
  jobId: string;
  candidates: JobCandidate[];
  onDecide: (d: "approve" | "reject") => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-md border border-warn/40 bg-surface p-3 text-sm">
      <div className="font-medium">需要人工确认</div>
      <p className="mt-1 text-xs text-muted">确认前不会调用模型；取消则不生成任何 IE 字段内容。</p>
      <div className="mt-2 rounded border border-line bg-canvas p-2 text-xs">
        候选消息：{candidates.map((c) => (typeof c === "string" ? c : c.message || c.name || "")).join(" / ") || "—"}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-accent-solid px-3 py-1.5 text-xs text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecide("approve")}
        >
          批准并生成
        </button>
        <button
          className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecide("reject")}
        >
          取消
        </button>
      </div>
      <span className="sr-only">{jobId}</span>
    </div>
  );
}
```

- [ ] **Step 2: 在 actions 里加 action**

在 `CopilotActions` 内、`run_case` 之后加：

```tsx
useCopilotAction({
  name: "approve_candidates",
  description: "对处于 awaiting_approval 的任务做人工审批：approve 继续生成，reject 取消且不调用模型。",
  parameters: [
    { name: "job_id", type: "string", description: "run_case 返回的 job_id", required: true },
    { name: "case", type: "string", description: "用例号", required: true },
  ],
  renderAndWaitForResponse: ({ args, respond, status }) => {
    const [busy, setBusy] = useState(false);
    const job = getJob(args.job_id);

    const decide = async (decision: "approve" | "reject") => {
      setBusy(true);
      try {
        await api.approveJob(args.job_id, decision);
        const ac = new AbortController();
        const { job, sseOk } = await followJob(args.job_id, args.case, ac.signal, false);
        const final = sseOk ? job : await api.job(args.job_id);
        respond(JSON.stringify({ job_id: args.job_id, state: final.state, verdict: final.verdict ?? null }));
      } catch (e) {
        setBusy(false);
        respond(JSON.stringify({ error: String(e) }));
      }
    };

    return (
      <ApprovalCard
        jobId={args.job_id}
        candidates={job?.approval?.candidates ?? []}
        busy={busy}
        onDecide={decide}
      />
    );
  },
});
```

`respond` 只调用一次；取消后按钮 disabled，避免二次提交。

- [ ] **Step 3: 验证编译**

Run: `cd webapp && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 真实验证**

输入「跑一下 6.7.1.3，需要人工审批」，出现审批卡 → 点「取消」→ 助手回复 canceled，页面文案不含「通过」。

- [ ] **Step 5: 提交**

```bash
git add webapp/components/copilot
git commit -m "feat(webapp): HITL 审批 action 与审批卡"
```

---

### Task 11: 证据 action 与 ResultCard

**Files:**
- Create: `webapp/components/copilot/ResultCard.tsx`
- Modify: `webapp/components/copilot/actions.tsx`

- [ ] **Step 1: 建 ResultCard**

```tsx
"use client";

import Link from "next/link";

type Stage = { stage: string; status?: string; summary?: string; detail?: Record<string, unknown> };
type Violation = { rule: string; path: string; detail: string };

export function ResultCard({
  caseId,
  stages,
  verdict,
  violations,
  L1,
  L3,
}: {
  caseId: string;
  stages: Stage[];
  verdict?: string | null;
  violations: Violation[];
  L1?: number | null;
  L3?: number | null;
}) {
  const tone =
    verdict === "pass" ? "border-ok/40" :
    verdict === "abstained" ? "border-line" : "border-bad/40";

  return (
    <div className={`rounded-md border ${tone} bg-surface p-3 text-sm`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">用例 {caseId}</span>
        <span className="text-xs text-muted">
          {verdict === "pass" ? "通过" : verdict === "abstained" ? "弃权" : verdict === "reject" ? "已拒收" : "未判定"}
        </span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span>L1：{L1 ?? "—"}</span>
        <span>L3：{L3 ?? "—"}</span>
        <span>违规：{violations.length}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.stage} className="flex justify-between gap-2">
            <span>{s.stage}</span>
            <span className={s.status === "ok" ? "text-ok-ink" : s.status === "skipped" ? "text-muted" : "text-bad"}>
              {s.summary || s.status}
            </span>
          </li>
        ))}
      </ul>
      {violations.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-bad">
          {violations.map((v, i) => (
            <li key={i}>{v.rule} · {v.path} · {v.detail}</li>
          ))}
        </ul>
      )}
      <Link className="mt-2 inline-block text-xs text-accent-ink" href={`/case/${caseId}`}>
        查看完整证据 →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: 加 `get_case_evidence` action**

在 `CopilotActions` 内加：

```tsx
useCopilotAction({
  name: "get_case_evidence",
  description: "读取某个用例的六阶段证据（不调用模型）。",
  parameters: [{ name: "case", type: "string", description: "用例号", required: true }],
  handler: async ({ case: caseId }: { case: string }) => {
    const res = await fetch(`/api/case/${caseId}`);
    const body = await res.json();
    return JSON.stringify({ case: caseId, stages: body.stages ?? [] });
  },
  render: ({ result }) => {
    const parsed = result ? JSON.parse(String(result)) : null;
    if (!parsed) return <div className="text-xs text-muted">读取证据中…</div>;
    const stages = parsed.stages ?? [];
    const score = stages.find((s: any) => s.stage === "score")?.detail ?? {};
    return (
      <ResultCard
        caseId={parsed.case}
        stages={stages}
        verdict={score.verdict ?? null}
        violations={stages.flatMap((s: any) => s.detail?.violations ?? [])}
        L1={score.L1 ?? null}
        L3={score.L3 ?? null}
      />
    );
  },
});
```

- [ ] **Step 3: 验证编译**

Run: `cd webapp && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 提交**

```bash
git add webapp/components/copilot
git commit -m "feat(webapp): 证据 action 与结果卡片"
```

---

### Task 12: 运行 trace 抽屉

**Files:**
- Create: `webapp/components/copilot/TracePanel.tsx`
- Modify: `webapp/app/page.tsx`

- [ ] **Step 1: 建 TracePanel**

```tsx
"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { getJob, setJob, subscribeJobs } from "@/lib/jobStore";

export function TracePanel({
  jobId,
  caseId,
  onClose,
}: {
  jobId?: string;
  caseId?: string;
  onClose: () => void;
}) {
  const job = useSyncExternalStore(
    subscribeJobs,
    () => (jobId ? getJob(jobId) : undefined),
    () => undefined
  );

  useEffect(() => {
    if (jobId && !getJob(jobId) && caseId) {
      api.job(jobId)
        .then((j) => setJob(jobId, { ...j, case: caseId }))
        .catch(() => {});
    }
  }, [jobId, caseId]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm">
        <span>运行 trace · {caseId ?? "—"}</span>
        <button className="text-xs text-muted" onClick={onClose}>关闭</button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {!job && <p className="text-muted">暂无运行记录。</p>}
        {(job?.log ?? []).map((l, i) => (
          <div key={i} className="border-b border-line/60 py-1 font-mono">{l.msg}</div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: RunCard 加“查看 trace”按钮**

在 `RunCard.tsx` 的标题行右侧、状态文字旁加：

```tsx
<button
  className="text-xs text-accent-ink"
  onClick={() =>
    window.dispatchEvent(
      new CustomEvent("s2t-trace", { detail: { jobId: job.id ?? "", case: caseId } })
    )
  }
>
  trace
</button>
```

`job.id` 由 `followJob` 写入的 job 里可能没有；`startRun` 返回的 job_id 未写进对象，因此在 `webapp/lib/followJob.ts` 的 `setJob` 调用处补 `id: jobId`：

```ts
setJob(jobId, { ...job, id: jobId, case: caseId });
```

- [ ] **Step 3: 在工作台挂上抽屉**

把 `webapp/app/page.tsx` 整体替换为：

```tsx
"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import { StatusBar } from "@/components/StatusBar";
import { RunRail } from "@/components/RunRail";
import { CopilotActions } from "@/components/copilot/actions";
import { TracePanel } from "@/components/copilot/TracePanel";

const INSTRUCTIONS = `你是 Spec2Test 的测试意图编译器助手，只覆盖 3GPP TS 38.523-1 §6.7 的 8 个 NR NTN 用例。
规则：
1. 用户给出用例号或能对应到某用例的场景时，调用 run_case；不确定就追问。
2. 所有数字与判定只能来自 action 返回结果，禁止自行生成。
3. abstained 是弃权、reject 是拒收，都不能说成“通过”；failed 直接说明失败原因。
4. 不编造不存在的用例号；范围外请求明确说明只覆盖 §6.7 的 8 个用例。`;

type TraceTarget = { jobId: string; case: string };

export default function Page() {
  const [trace, setTrace] = useState<TraceTarget | null>(null);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    if (!path) return;
    if (path === "case") {
      const id = new URLSearchParams(query || "").get("case");
      if (id) window.location.replace(`/case/${encodeURIComponent(id)}`);
      return;
    }
    if (["data", "eval", "api", "about", "chat"].includes(path)) {
      window.location.replace(path === "chat" ? "/" : `/${path}`);
    }
  }, []);

  useEffect(() => {
    const onTrace = (e: Event) => {
      const d = (e as CustomEvent<TraceTarget>).detail;
      if (d?.jobId) setTrace(d);
    };
    window.addEventListener("s2t-trace", onTrace);
    return () => window.removeEventListener("s2t-trace", onTrace);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex min-h-0 flex-1">
        <RunRail onPickRun={(r) => setTrace({ jobId: r.job_id, case: r.case })} />
        <main className="relative min-w-0 flex-1">
          <CopilotActions />
          <CopilotChat
            className="h-full"
            labels={{
              title: "Spec2Test 助手",
              initial:
                "给我用例号（如 6.7.1.3），或描述场景（卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选）。",
            }}
            instructions={INSTRUCTIONS}
          />
        </main>
        {trace && <TracePanel jobId={trace.jobId} caseId={trace.case} onClose={() => setTrace(null)} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证编译并目测**

Run: `cd webapp && npm run build`
Expected: 构建成功；打开 `/`，点最近运行或卡片上的 trace 能看到面板。

- [ ] **Step 5: 提交**

```bash
git add webapp/components/copilot/TracePanel.tsx webapp/app/page.tsx webapp/lib/followJob.ts webapp/components/copilot/RunCard.tsx
git commit -m "feat(webapp): 运行 trace 抽屉"
```

---

### Task 13: 演示用的卡片夹具页（仅开发环境）

**Files:**
- Create: `webapp/app/dev/cards/page.tsx`

- [ ] **Step 1: 建夹具页**

```tsx
"use client";

import { ApprovalCard } from "@/components/copilot/ApprovalCard";
import { ResultCard } from "@/components/copilot/ResultCard";
import { RunCard } from "@/components/copilot/RunCard";
import { setJob } from "@/lib/jobStore";
import { useEffect } from "react";

export default function Page() {
  const allowed = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!allowed) return;
    setJob("fixture", {
      case: "6.7.1.3",
      state: "running",
      log: [
        { t: 0, msg: "[ingest] 读取规范用例" },
        { t: 1, msg: "[context] 上下文裁剪完成" },
        { t: 2, msg: "[candidates] 抽取到 1 个候选消息" },
      ],
    });
  }, [allowed]);

  if (!allowed) return <main className="p-6">not available</main>;

  return (
    <main className="space-y-4 p-6" data-testid="cards">
      <RunCard caseId="6.7.1.3" />
      <ApprovalCard jobId="fixture" candidates={["SIB1"]} onDecide={() => {}} />
      <ResultCard
        caseId="6.7.1.3"
        verdict="reject"
        L1={1}
        L3={0.5}
        stages={[
          { stage: "generate", status: "ok", summary: "生成 3 条消息" },
          { stage: "validate", status: "rejected", summary: "违规 1 条" },
        ]}
        violations={[{ rule: "R2", path: "messages[SIB1].ies[0].name", detail: "unknown field" }]}
      />
      <ResultCard caseId="6.7.1.4" verdict="abstained" L1={1} L3={null} stages={[{ stage: "generate", status: "skipped", summary: "弃权：未调用模型" }]} violations={[]} />
    </main>
  );
}
```

- [ ] **Step 2: 目测三种判定**

打开 `http://127.0.0.1:3000/dev/cards`：通过/拒收/弃权三张卡颜色与文案不同，弃权不是红色。

- [ ] **Step 3: 提交**

```bash
git add webapp/app/dev
git commit -m "test(webapp): 卡片夹具页"
```

---

### Task 14: Playwright E2E

**Files:**
- Create: `webapp/playwright.config.ts`, `webapp/e2e/workspace.spec.ts`, `webapp/e2e/cards.spec.ts`

- [ ] **Step 1: 建配置**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command: "py -3.12 ../scripts/serve.py --port 8000 --no-browser",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
```

- [ ] **Step 2: 写卡片测试**

```ts
import { expect, test } from "@playwright/test";

test("三种判定卡片的文案与颜色区分", async ({ page }) => {
  await page.goto("/dev/cards");
  await expect(page.getByTestId("cards")).toBeVisible();
  await expect(page.getByText("已拒收")).toBeVisible();
  await expect(page.getByText("弃权")).toBeVisible();
  await expect(page.getByText("R2 · messages[SIB1].ies[0].name")).toBeVisible();
});
```

- [ ] **Step 3: 写视图测试**

```ts
import { expect, test } from "@playwright/test";

test("视图路由可达且能读到后端数据", async ({ page }) => {
  for (const [path, text] of [
    ["/data", "逐例"],
    ["/eval", "评测"],
    ["/about", "5 分钟"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).toContainText(text);
  }
});

test("旧 hash 链接重定向到新路由", async ({ page }) => {
  await page.goto("/#/case?case=6.7.1.3");
  await expect(page).toHaveURL(/\/case\/6\.7\.1\.3/);
});
```

- [ ] **Step 4: 运行**

Run: `cd webapp && npx playwright install chromium && npm run e2e`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add webapp/playwright.config.ts webapp/e2e
git commit -m "test(webapp): Playwright 冒烟与卡片回归"
```

---

### Task 15: 启动脚本、文档与旧前端下线

**Files:**
- Modify: `scripts/serve.py`（去掉 `web/index.html` 强依赖）
- Modify: `start.bat`
- Modify: `README.md`、`docs/WEB-SPEC.md`、`docs/DEMO-SCRIPT.md`
- Delete: `app/`、`web/`

- [ ] **Step 1: 让 Python 不再要求 web/index.html**

`scripts/serve.py` 的 `main()` 里把：

```python
if not os.path.isfile(os.path.join(ROOT, "web", "index.html")):
    raise SystemExit("找不到 web/index.html，请在仓库根下运行")
```

改为：

```python
if not os.path.isdir(os.path.join(ROOT, "data")):
    raise SystemExit("找不到 data/，请在仓库根下运行")
```

- [ ] **Step 2: 更新 `start.bat`**

在 Python 启动前插入 Node 检查与前端启动（完整替换“启动后自动打开”段落）：

```bat
where node >nul 2>&1
if errorlevel 1 (
  echo [warn] 未检测到 Node.js：仅 API 与数据可用，界面需要 Node 20+
) else (
  if not exist "webapp\node_modules" (
    echo [i] 首次运行，正在安装前端依赖...
    pushd webapp
    call npm install
    popd
  )
  if not exist "webapp\.next" (
    pushd webapp
    call npm run build
    popd
  )
  start "Spec2Test UI" cmd /c "cd /d %~dp0webapp && npm run start"
)
echo [ok] 界面：http://127.0.0.1:3000/   API：http://127.0.0.1:8000/api/health
start "" http://127.0.0.1:3000/
```

删除原来的 `start "" http://127.0.0.1:8000/web/` 与对应提示。

- [ ] **Step 3: 下线旧前端**

```bash
git rm -r app web
```

同步修改 `.gitignore`：删掉 `app/node_modules/`、`app/smoke-about.png`、`app/_*`，改成 `webapp/node_modules/`、`webapp/.next/`。

- [ ] **Step 4: 更新文档**

- `docs/WEB-SPEC.md`：路由表改成 `/`、`/data`、`/eval`、`/api`、`/about`、`/case/[id]`；注明 UI 由 :3000 提供，Python 只提供 API 与静态数据。
- `docs/DEMO-SCRIPT.md`：按新 IA 重写步骤（打开 :3000 → 对话里跑 6.7.1.3 → 展示运行卡 → 发一条 HITL 取消 → 看结果卡）。
- `README.md`：快速开始改为“`start.bat` 或分别启动 `scripts/serve.py` 与 `webapp`”。

- [ ] **Step 5: 全量验证**

Run:
```bash
py -3.12 -m pytest -q
cd webapp && npm run build && npm run test && npm run e2e
```
Expected: Python `62 passed`；Next 构建成功；Vitest 全过；Playwright 3 passed。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore: 切换到 Next.js + CopilotKit 前端，下线旧 SPA"
```

---

## 自检

- **Spec 覆盖**：拓扑（Task 1-2）、runtime（Task 3）、IA/路由（Task 5-6、8）、readables/actions/卡片（Task 9-12）、HITL（Task 10）、迁移与旧链接（Task 5-6、15）、测试与演示（Task 13-15）。无缺项。
- **占位符**：无 TBD/TODO；所有新增文件都给出完整代码，迁移类任务给出逐文件操作与替换表。
- **类型一致**：`Job` 来自 `lib/api.ts`；`setJob(jobId, {...job, case})` 的 `case` 字段在 `jobStore` 的 `JobWithCase` 中声明；`followJob` 返回 `{job, sseOk}` 两个调用点一致。
