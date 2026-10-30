import * as React from "react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Copy,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  api,
  ApiError,
  pollJob,
  runJob,
  streamJob,
  type CaseItem,
  type Conversation,
  type ConversationDetail,
  type Job,
  type Message,
  type Violation,
} from "../lib/api";
import { STAGE_LABEL, buildStages, conclusionOf, verdictOf, violationsOf } from "../lib/stages";
import { Button, Card, CardBody, Chip, Empty, Term, useToast } from "../ui";

const GUIDE_KEY = "s2t-chat-guide";
const CONV_KEY = "s2t-current-conv";
const LIVE_KEY = "s2t-live-job";

type LiveRef = { cid: string; caseId: string; jobId: string };

function readLiveJob(): LiveRef | null {
  try {
    const raw = sessionStorage.getItem(LIVE_KEY);
    return raw ? (JSON.parse(raw) as LiveRef) : null;
  } catch {
    return null;
  }
}

function clearLiveJob() {
  try {
    sessionStorage.removeItem(LIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** 当前会话进 URL（#/chat?c=<id>）并留 localStorage 兜底，切视图不丢选择。 */
function hashConvId(): string | null {
  const m = /[?&]c=([0-9a-f]{8})\b/.exec(window.location.hash);
  return m ? m[1] : null;
}

function syncConvLocation(id: string | null) {
  if (id) localStorage.setItem(CONV_KEY, id);
  else localStorage.removeItem(CONV_KEY);
  const want = id ? `#/chat?c=${id}` : "#/chat";
  if (window.location.hash !== want) window.history.replaceState(null, "", want);
}

const SAMPLES = [
  { label: "6.7.1.3 生成测试步骤", text: "6.7.1.3 生成测试步骤" },
  { label: "6.7.1.12 需要哪些信令内容", text: "6.7.1.12 需要哪些信令内容" },
  { label: "禁用 GNSS 后允许注册吗", text: "禁用 GNSS 后允许注册吗" },
  { label: "Sintrasearch 的重选条件是什么", text: "Sintrasearch 的重选条件是什么" },
];

const CASE_RE = /\b6\.7\.1\.\d{1,2}\b/;
const STOP = new Set(["nr", "ntn", "cell", "cells", "enhancement", "enhancements", "rrc", "the", "and", "for", "of"]);

type Resolution =
  | { kind: "hit"; id: string }
  | { kind: "ambiguous"; items: CaseItem[] }
  | { kind: "none" };

/** 用例定位：先看用例号，再按标题关键词打分。 */
export function resolveCase(text: string, cases: CaseItem[]): Resolution {
  const m = CASE_RE.exec(text);
  if (m && cases.some((c) => c.case === m[0])) return { kind: "hit", id: m[0] };
  const low = text.toLowerCase();
  const scored = cases
    .map((c) => {
      const words = c.title.toLowerCase().split(/[^a-z0-9_-]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      const hit = words.filter((w) => low.includes(w)).length;
      return { c, hit };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  if (!scored.length) return { kind: "none" };
  const best = scored[0].hit;
  const top = scored.filter((x) => x.hit === best).map((x) => x.c);
  if (top.length === 1) return { kind: "hit", id: top[0].case };
  return { kind: "ambiguous", items: top };
}

type StoredStage = { stage: string; status?: string; summary?: string };
type Row = { key: string; label: string; status: string; summary: string; lines: string[] };

function rowsOf(job?: Job, stored?: StoredStage[]): Row[] {
  if (job) {
    return buildStages(job).map((s) => ({
      key: s.key,
      label: s.label,
      status: s.status,
      summary: s.summary,
      lines: s.lines,
    }));
  }
  if (stored?.length) {
    return stored.map((s) => ({
      key: s.stage,
      label: STAGE_LABEL[s.stage as keyof typeof STAGE_LABEL] || s.stage,
      status: s.status || "ok",
      summary: s.summary || "",
      lines: [],
    }));
  }
  return [];
}

const toneOf = (status: string) =>
  status === "skipped" ? "muted" : status === "failed" ? "bad" : status === "pending" ? "muted" : "ok";

const statusText = (status: string) =>
  status === "skipped" ? "弃权" : status === "failed" ? "失败" : status === "pending" ? "等待" : "完成";

function VerdictChip({ verdict, skipped }: { verdict?: string; skipped?: boolean }) {
  if (skipped || verdict === "abstained")
    return (
      <Chip tone="muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        <Term term="已弃权" desc="输入信息不足，系统不发起模型调用、不产出信令内容。弃权不是失败，也不计 0 分。" />
      </Chip>
    );
  if (verdict === "reject")
    return (
      <Chip tone="bad">
        <span className="h-1.5 w-1.5 rounded-full bg-bad" />
        已拒收
      </Chip>
    );
  if (verdict === "pass")
    return (
      <Chip tone="ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        通过
      </Chip>
    );
  return null;
}

/** 助手消息：结论 → 说明 → 六阶段 → 违规 → 原始数据。 */
function AssistantBlock({
  content,
  explain,
  verdict,
  stageRows,
  violations,
  raw,
  stopped,
  onCopy,
}: {
  content?: string;
  explain?: string | null;
  verdict?: string;
  stageRows: Row[];
  violations: Violation[];
  raw: unknown;
  stopped?: boolean;
  onCopy: () => void;
}) {
  const skipped = verdict === "abstained" || stageRows.filter((r) => r.status === "skipped").length >= 3;
  const d = ((raw as { result?: { detail?: Record<string, unknown> } })?.result?.detail ||
    (raw as { detail?: Record<string, unknown> })?.detail ||
    {}) as Record<string, unknown>;
  const l1 = typeof d.L1 === "number" ? (d.L1 as number) : undefined;
  const l3 = typeof d.L3 === "number" ? (d.L3 as number) : undefined;
  const [openStages, setOpenStages] = React.useState(false);
  const [openRaw, setOpenRaw] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={verdict} skipped={skipped} />
        {l1 !== undefined && (
          <span className="text-[12px] text-muted">
            <Term term={`L1 ${l1.toFixed(3)}`} desc="结构合法率：输出能否解析成 IR，且每步具备主体/方向/消息。" />
          </span>
        )}
        {l3 !== undefined && (
          <span className="text-[12px] text-muted">
            <Term term={`L3 ${l3.toFixed(3)}`} desc="关键 IE 命中率：生成字段对官方叶子字段的召回。" />
          </span>
        )}
        {content && <span className="text-[13px] text-ink">{content}</span>}
        {stopped && <Chip tone="warn">已停止（后端任务可能仍在运行）</Chip>}
      </div>

      {explain && (
        <p className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          <span className="mr-1 font-medium text-accent">智能解读</span>
          {explain}
        </p>
      )}

      {stageRows.length > 0 && (
        <div className="rounded-md border border-line">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted hover:bg-surface"
            onClick={() => setOpenStages((v) => !v)}
            aria-expanded={openStages}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openStages ? "" : "-rotate-90"}`} />
            六阶段（{stageRows.filter((r) => r.status !== "pending").length}/{stageRows.length}）
          </button>
          {openStages && (
            <ol className="border-t border-line px-3 py-2">
              {stageRows.map((r) => (
                <li key={r.key} className="flex items-start gap-2 py-1 text-[12px]">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      r.status === "ok" ? "bg-ok" : r.status === "failed" ? "bg-bad" : "bg-muted/60"
                    }`}
                  />
                  <span className="w-20 shrink-0 text-muted">{r.label}</span>
                  <span className="shrink-0">
                    <Chip tone={toneOf(r.status) as never}>{statusText(r.status)}</Chip>
                  </span>
                  <span className="min-w-0 flex-1 text-ink/80">{r.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {violations.length > 0 && (
        <div className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2">
          <div className="mb-1 text-[12px] font-medium text-bad">校验违规 {violations.length} 条</div>
          <ul className="space-y-1">
            {violations.map((v, i) => (
              <li key={i} className="font-mono text-[11px] leading-relaxed text-ink/80">
                [{v.rule}] {v.path} — {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="subtle" size="sm" onClick={onCopy} title="复制这条结果">
          <Copy className="h-3.5 w-3.5" />
          复制
        </Button>
        <Button variant="subtle" size="sm" onClick={() => setOpenRaw((v) => !v)} aria-expanded={openRaw}>
          {openRaw ? "收起原始数据" : "原始数据"}
        </Button>
      </div>
      {openRaw && (
        <pre className="max-h-56 overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

function StoredAssistant({ m, onCopy }: { m: Message; onCopy: (t: string) => void }) {
  const rows = rowsOf(undefined, m.stages as StoredStage[] | undefined);
  return (
    <AssistantBlock
      content={m.content}
      verdict={m.verdict}
      stageRows={rows}
      violations={(m.violations as Violation[]) || []}
      raw={m}
      onCopy={() => onCopy([m.content, ...rows.map((r) => `${r.label}: ${statusText(r.status)} ${r.summary}`)].join("\n"))}
    />
  );
}

export function ChatView() {
  const toast = useToast();
  const [convs, setConvs] = React.useState<Conversation[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [cases, setCases] = React.useState<CaseItem[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [liveJob, setLiveJob] = React.useState<Job | null>(null);
  const [pendingRun, setPendingRun] = React.useState<{ caseId: string; say: string; cid: string } | null>(null);
  const [liveExplain, setLiveExplain] = React.useState<string | null>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const [guideOpen, setGuideOpen] = React.useState(() => localStorage.getItem(GUIDE_KEY) !== "1");
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const renamingRef = React.useRef<string | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [drawer, setDrawer] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const streamRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const lastPrompt = React.useRef<string>("");
  const lastCaseRef = React.useRef<string | null>(null);
  const sendingRef = React.useRef(false);

  /* ---------- 载入 ---------- */
  const loadConvs = React.useCallback(() => {
    api.conversations().then(setConvs).catch(() => setConvs([]));
  }, []);

  React.useEffect(() => {
    loadConvs();
    api.cases().then(setCases).catch(() => setCases([]));
  }, [loadConvs]);

  const openSeq = React.useRef(0);
  const openConv = React.useCallback(
    (id: string) => {
      abortRef.current?.abort();
      const seq = ++openSeq.current;
      setBusy(false);
      setLiveJob(null);
      setLiveExplain(null);
      setError(null);
      setStopped(false);
      setInput("");
      setCurrent(id);
      syncConvLocation(id);
      setDrawer(false);
      api.conversation(id)
        .then((d: ConversationDetail) => {
          if (seq !== openSeq.current) return; // 快速切换 A→B：丢弃过期响应
          setMessages(d.messages || []);
          requestAnimationFrame(() => scrollBottom(true));
        })
        .catch((e: unknown) => {
          if (seq !== openSeq.current) return;
          if (e instanceof ApiError && e.status === 404) {
            // 会话已被删：清掉失效锚点，回到空态
            setMessages([]);
            setCurrent(null);
            syncConvLocation(null);
          } else {
            // 断网/5xx：保留锚点，只提示，避免误清当前会话
            setError("加载会话失败：" + (e instanceof Error ? e.message : String(e)));
          }
        });
    },
    []
  );

  const resumeLive = React.useCallback(
    async (ref: LiveRef) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setCurrent(ref.cid);
      syncConvLocation(ref.cid);
      setBusy(true);
      // 立即占位，避免恢复的 1-2 秒里出现"忙但没有运行框"
      setLiveJob({ state: "queued", log: [] });
      setLiveExplain(null);
      try {
        const first = await api.job(ref.jobId);
        if (first.state === "running" || first.state === "queued") {
          setLiveJob(first);
          const r = await streamJob(ref.jobId, (j) => setLiveJob(j), ac.signal);
          if (ac.signal.aborted) return;
          if (r.mode === "fallback") {
            const job = await pollJob(ref.jobId, (j) => setLiveJob(j), ac.signal);
            if (ac.signal.aborted) return;
            setLiveJob(job);
          } else {
            setLiveJob(r.job ?? null);
          }
        } else {
          setLiveJob(null);
        }
        const d = await api.conversation(ref.cid);
        if (!ac.signal.aborted) setMessages(d.messages || []);
        loadConvs();
      } catch {
        // 任务已丢失（服务重启等）：回到会话已有内容
        try {
          const d = await api.conversation(ref.cid);
          if (!ac.signal.aborted) setMessages(d.messages || []);
        } catch {
          /* ignore */
        }
      } finally {
        clearLiveJob();
        if (abortRef.current === ac) {
          abortRef.current = null;
          setBusy(false);
        }
        requestAnimationFrame(() => {
          const el = streamRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    [loadConvs]
  );

  // 挂载时恢复上次会话：URL 优先，localStorage 兜底。否则切视图后 current 归零。
  const currentRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    currentRef.current = current;
  }, [current]);

  React.useEffect(() => {
    const want = hashConvId() || localStorage.getItem(CONV_KEY);
    if (want) openConv(want);
    const live = readLiveJob();
    if (want && live && live.cid === want) resumeLive(live);
    const onHash = () => {
      const id = hashConvId();
      if (id && id !== currentRef.current) openConv(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [openConv, resumeLive]);

  // 卸载时停止轮询：否则切走后仍在 setState，且白耗请求（后端任务不受影响）
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  /* ---------- 滚动 ---------- */
  const scrollBottom = (force = false) => {
    const el = streamRef.current;
    if (!el) return;
    if (force || Math.abs(el.scrollHeight - (el.scrollTop + el.clientHeight)) <= 1) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const onScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const near = Math.abs(el.scrollHeight - (el.scrollTop + el.clientHeight)) <= 1;
    setAtBottom(near);
  };

  React.useEffect(() => {
    if (atBottom) scrollBottom();
  }, [messages, liveJob]);

  /* ---------- 计时 ---------- */
  React.useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  /* ---------- 会话操作 ---------- */
  const newConv = async () => {
    if (busy) return;
    try {
      const c = await api.createConversation("新对话");
      setConvs((prev) => [{ id: c.id, title: c.title, turns: 0 }, ...prev]);
      setCurrent(c.id);
      syncConvLocation(c.id);
      setMessages([]);
      setLiveJob(null);
      setDrawer(false);
      inputRef.current?.focus();
    } catch (e) {
      toast("新建对话失败：" + (e as Error).message);
    }
  };

  const removeConv = async (id: string) => {
    if (!window.confirm("删除这个对话？该操作不可撤销。")) return;
    try {
      await api.deleteConversation(id);
      setConvs((prev) => prev.filter((c) => c.id !== id));
      if (current === id) {
        setCurrent(null);
        syncConvLocation(null);
        setMessages([]);
        abortRef.current?.abort();
        setBusy(false);
        setLiveJob(null);
      }
    } catch (e) {
      toast("删除失败：" + (e as Error).message);
    }
  };

  const commitRename = async (id: string) => {
    // Enter 与 blur 可能先后触发；用 ref 保证只提交一次
    if (renamingRef.current !== id) return;
    renamingRef.current = null;
    const title = renameText.trim();
    setRenaming(null);
    if (!title) return;
    try {
      await api.renameConversation(id, title);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch (e) {
      toast("改名失败：" + (e as Error).message);
    }
  };

  /* ---------- 发送 ---------- */
  const ensureConv = async (): Promise<string | null> => {
    if (current) return current;
    try {
      const c = await api.createConversation("新对话");
      setConvs((prev) => [{ id: c.id, title: c.title, turns: 0 }, ...prev]);
      setCurrent(c.id);
      syncConvLocation(c.id);
      return c.id;
    } catch (e) {
      setError("无法创建对话：" + (e as Error).message);
      return null;
    }
  };

  const pushLocal = (m: Message) => setMessages((prev) => [...prev, m]);

  /** 用例表可能首载失败；发送时补拉一次，避免把「6.7.1.3」误判成无匹配。 */
  const resolveWithRetry = async (text: string): Promise<Resolution> => {
    let cs = cases;
    if (!cs.length) {
      try { cs = await api.cases(); setCases(cs); } catch { /* 保持空表，走 none 分支 */ }
    }
    return resolveCase(text, cs);
  };

  const runForCase = async (caseId: string, cid: string | null) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setLiveJob({ state: "queued", log: [] });
    try {
      // instruction 传空：用户消息由前端写一次，后端不再重复追加
      const job = await runJob(
        caseId,
        "",
        (j) => setLiveJob(j),
        ac.signal,
        cid || undefined,
        (jid) => {
          if (!cid) return;
          try {
            sessionStorage.setItem(LIVE_KEY, JSON.stringify({ cid, caseId, jobId: jid }));
          } catch {
            /* ignore */
          }
        }
      );
      if (ac.signal.aborted) return;
      setLiveJob(job);
      if (cid) {
        const d = await api.conversation(cid);
        if (!ac.signal.aborted) setMessages(d.messages || []);
      }
      loadConvs();
      requestAnimationFrame(() => scrollBottom(true));
      // 读取该用例的 LLM 解读（离线生成，缺失时静默；优先 data，回退快照）
      // 仅当解读记录的判定与本次运行一致时才显示，避免静态解读误导实时结果
      (async () => {
        const skipped = buildStages(job).filter((s) => s.status === "skipped").length >= 3;
        const jv =
          job.result?.status === "abstained" || skipped
            ? "abstained"
            : job.result?.verdict === "reject" || violationsOf(job).length
              ? "reject"
              : job.state === "done"
                ? "pass"
                : undefined;
        for (const url of [`/data/explain/${caseId}.json`, `/results/explain/${caseId}.json`]) {
          try {
            const r = await fetch(url, { cache: "no-store" });
            if (!r.ok) continue;
            const d = await r.json();
            const ev = d?.numbers?.verdict;
            if (d?.headline && (!jv || !ev || ev === jv)) {
              if (!ac.signal.aborted) setLiveExplain(d.headline);
              return;
            }
          } catch {
            /* 继续尝试下一个来源 */
          }
        }
      })();
    } catch (e) {
      if (ac.signal.aborted) return;
      const friendly =
        e instanceof ApiError && e.code === "run_in_progress"
          ? "这个会话已有任务在运行，请等它结束或先停止。"
          : e instanceof ApiError && e.code === "too_many_runs"
            ? "同时运行的任务太多，请稍后再试。"
            : e instanceof ApiError
              ? e.message
              : (e as Error).message;
      setError(friendly);
    } finally {
      // 切页导致的中止保留 job 锚点，回来后可恢复；正常结束才清
      if (!ac.signal.aborted) clearLiveJob();
      // 只有当前控制器仍是自己时才解除忙态，避免旧任务把新任务打回空闲
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sendingRef.current) return;
    sendingRef.current = true;
    lastPrompt.current = t;
    setError(null);
    setStopped(false);
    setInput("");
    setBusy(true);
    setElapsed(0);
    setLiveExplain(null);
    setPendingRun(null);
    try {
      const cid = await ensureConv();
      if (!cid) return;
      pushLocal({ role: "user", content: t, at: Date.now() });
      requestAnimationFrame(() => scrollBottom(true));
      await api.appendMessage(cid, "user", t).catch(() => undefined);

      const r = await resolveWithRetry(t);
      let caseId = r.kind === "hit" ? r.id : null;
      if (!caseId) {
        // 本地没有精确命中：交给 LLM 判断意图（语义匹配到用例，或自然地引导用户）
        let guide: { action: string; case?: string; say: string } | null = null;
        try {
          guide = await api.chatGuide(t, cid);
        } catch {
          guide = null;
        }
        if (guide?.action === "run" && guide.case) {
          // 语义匹配到的用例先走确认卡，避免自动烧一次模型调用
          setPendingRun({ caseId: guide.case, say: guide.say || "", cid });
          return;
        } else {
          const content =
            guide?.say ||
            "你好！我可以把 3GPP §6.7 的 NR NTN 测试条款编译成测试意图。你可以直接给用例号（如 6.7.1.3），或描述场景（如卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选）。";
          pushLocal({ role: "assistant", content, at: Date.now() });
          api.appendMessage(cid, "assistant", content).catch(() => undefined);
          requestAnimationFrame(() => scrollBottom(true));
          return;
        }
      }
      lastCaseRef.current = caseId;
      await runForCase(caseId, cid);
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    clearLiveJob();
    setStopped(true);
    setBusy(false);
    scrollBottom();
  };

  const retry = () => {
    if (sendingRef.current) return;
    if (!lastCaseRef.current) return void send(lastPrompt.current);
    // 重试只重跑任务，不再重复写用户消息
    sendingRef.current = true;
    setError(null);
    setStopped(false);
    setBusy(true);
    runForCase(lastCaseRef.current, current).finally(() => {
      sendingRef.current = false;
      setBusy(false);
    });
  };

  const confirmPending = () => {
    const p = pendingRun;
    setPendingRun(null);
    if (!p || sendingRef.current) return;
    sendingRef.current = true;
    lastCaseRef.current = p.caseId;
    setError(null);
    setStopped(false);
    setBusy(true);
    runForCase(p.caseId, p.cid).finally(() => {
      sendingRef.current = false;
      setBusy(false);
    });
  };

  const cancelPending = () => {
    const p = pendingRun;
    setPendingRun(null);
    if (!p) return;
    const content = "已取消，未发起运行。";
    pushLocal({ role: "assistant", content, at: Date.now() });
    api.appendMessage(p.cid, "assistant", content).catch(() => undefined);
    requestAnimationFrame(() => scrollBottom(true));
  };

  /* ---------- 键盘 ---------- */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组合态的回车是"选词"，不是发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("已复制"); } catch { toast("复制失败"); }
      document.body.removeChild(ta);
    }
  };

  const closeGuide = () => {
    setGuideOpen(false);
    localStorage.setItem(GUIDE_KEY, "1");
  };

  const emptyState = messages.length === 0 && !liveJob;

  return (
    <div className="flex h-full min-h-0">
      {/* 会话栏 */}
      <aside
        className={`${
          drawer ? "absolute inset-y-0 left-0 z-30 flex" : "hidden"
        } w-64 shrink-0 flex-col border-r border-line bg-surface md:relative md:flex`}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <Button variant="primary" size="sm" className="flex-1" onClick={newConv} title="新建对话">
            <Plus className="h-4 w-4" />
            新建对话
          </Button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {convs.length === 0 && (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-muted">还没有对话。点上面的「新建对话」开始。</p>
          )}
          {convs.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] ${
                current === c.id ? "bg-accent/10 font-medium text-accent" : "text-ink hover:bg-canvas"
              }`}
              aria-current={current === c.id ? "true" : undefined}
            >
              {renaming === c.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    if (e.key === "Escape") { renamingRef.current = null; setRenaming(null); }
                  }}
                  className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-[12px] outline-none"
                />
              ) : (
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  title={c.title}
                  onClick={() => openConv(c.id)}
                  onDoubleClick={() => {
                    renamingRef.current = c.id;
                    setRenaming(c.id);
                    setRenameText(c.title || "新对话");
                  }}
                >
                  {c.title || "新对话"}
                </button>
              )}
              <button
                className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-canvas hover:text-bad group-hover:opacity-100"
                title="删除对话"
                aria-label={`删除 ${c.title || "新对话"}`}
                onClick={() => removeConv(c.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {drawer && <div className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />}

      {/* 主区 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 md:hidden">
          <Button variant="subtle" size="sm" onClick={() => setDrawer(true)} title="会话列表">
            <MessageSquarePlus className="h-4 w-4" />
            会话
          </Button>
        </div>

        <div ref={streamRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-4 py-5">
            {guideOpen && (
              <Card className="border-accent/30 bg-accent/5">
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="space-y-1.5">
                    <div className="text-[13px] font-semibold">三步看懂这里</div>
                    <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-ink/80">
                      <li>
                        这是<b>测试意图编译器</b>：把 3GPP 条款编译成步骤与信令，并用确定性校验器判对错。
                      </li>
                      <li>
                        每条回答先看<b>结论</b>（通过 / 已拒收 /
                        <Term term="弃权" desc="输入信息不足时不发起模型调用，不产出信令内容；不是失败，也不计 0 分。" />
                        ），再看六阶段与违规。
                      </li>
                      <li>
                        下面点一个<b>示例问题</b>就能看到完整链路；也可以直接输入用例号，如 <code className="font-mono">6.7.1.3</code>。
                      </li>
                    </ol>
                  </div>
                  <Button variant="subtle" size="sm" onClick={closeGuide} title="不再显示">
                    知道了
                  </Button>
                </div>
              </Card>
            )}

            {emptyState && (
              <div className="flex flex-col gap-3">
                <Empty
                  title="今天想测哪一段？输入用例编号或描述一个场景，系统会给出结论、六阶段与校验结果。"
                  icon={<Sparkles className="h-5 w-5" />}
                />
                <div className="flex flex-wrap justify-center gap-2">
                  {SAMPLES.map((s) => (
                    <button
                      key={s.text}
                      disabled={busy}
                      onClick={() => send(s.text)}
                      className="rounded-full border border-line bg-canvas px-3 py-1.5 text-[12px] text-ink transition-colors hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent/10 px-3 py-2 text-[13px] leading-relaxed text-ink">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="break-words text-[13px] leading-relaxed">
                  <StoredAssistant m={m} onCopy={copy} />
                </div>
              )
            )}

            {pendingRun && (
              <Card className="border-accent/30 bg-accent/5">
                <CardBody className="space-y-2">
                  <div className="text-[12px] text-muted">即将运行（语义匹配结果，确认后才调用模型）</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px]">{pendingRun.caseId}</span>
                    <Chip tone="muted">预计 1 次模型调用</Chip>
                  </div>
                  {pendingRun.say && (
                    <p className="text-[12.5px] leading-relaxed text-ink">{pendingRun.say}</p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={confirmPending}>
                      <Check className="h-3.5 w-3.5" /> 确认运行
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelPending}>
                      取消
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}

            {liveJob && (
              <div className="break-words">
                <AssistantBlock
                  content={busy ? undefined : conclusionOf(liveJob)}
                  explain={busy ? null : liveExplain}
                  verdict={busy ? undefined : verdictOf(liveJob)}
                  stageRows={rowsOf(liveJob)}
                  violations={violationsOf(liveJob)}
                  raw={liveJob}
                  stopped={stopped}
                  onCopy={() => copy(JSON.stringify(liveJob, null, 2))}
                />
                {busy && (
                  <p className="mt-2 text-[12px] text-muted">
                    已等待 {elapsed} 秒 · 当前阶段 {STAGE_LABEL[(liveJob.stage || "ingest") as keyof typeof STAGE_LABEL] || "准备中"}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-[12px] text-bad">
                {error}
                <Button variant="ghost" size="sm" onClick={retry} title="重试">
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              </div>
            )}
          </div>
        </div>

        {!atBottom && (
          <div className="pointer-events-none flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="pointer-events-auto -mt-12 shadow-card"
              onClick={() => scrollBottom(true)}
              title="回到底部"
            >
              <ArrowDown className="h-4 w-4" />
              回到底部
            </Button>
          </div>
        )}

        <div className="border-t border-line bg-canvas px-4 py-3">
          <div className="mx-auto flex w-full max-w-[820px] items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              readOnly={busy}
              rows={1}
              placeholder="输入用例编号或描述场景，Enter 发送，Shift+Enter 换行"
              onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={onKeyDown}
              aria-label="消息输入框"
              className={`max-h-[200px] min-h-[38px] w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                busy ? "cursor-default bg-surface text-muted caret-transparent" : ""
              }`}
            />
            {!busy ? (
              <Button variant="primary" onClick={() => send(input)} disabled={!input.trim()} title="发送">
                <Send className="h-4 w-4" />
                发送
              </Button>
            ) : (
              <Button variant="ghost" onClick={stop} title="停止（仅中断前端轮询）">
                <Square className="h-4 w-4" />
                停止
              </Button>
            )}
          </div>
          <p className="mx-auto mt-1.5 w-full max-w-[820px] text-[11px] text-muted">
            判断依据：每条结论可指回条款；不合格产物会被拒收；输入信息不足时弃权而非编造。
          </p>
        </div>
      </section>
    </div>
  );
}
