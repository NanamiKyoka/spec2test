import { useEffect, useRef, useState } from "react";
import { api, runJob, type CaseItem, type Job } from "../lib/api";
import { StageTimeline, skippedNote } from "./StageTimeline";
import { conclusionOf, verdictOf, violationsOf, buildStages } from "../lib/stages";

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; kind: "result"; caseId: string; job?: Job; text?: string }
  | { id: string; role: "assistant"; kind: "info"; text: string; suggestions?: CaseItem[] }
  | { id: string; role: "assistant"; kind: "error"; text: string; needSettings?: boolean };

const uid = () => Math.random().toString(36).slice(2);

export function ChatPanel({
  cases,
  onOpenSettings,
  seed,
}: {
  cases: CaseItem[];
  onOpenSettings: () => void;
  seed?: { text: string; n: number };
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const resolveCase = (text: string): { hit?: CaseItem; many?: CaseItem[] } => {
    const m = text.match(/6\.7\.1\.\d+/);
    if (m) {
      const exact = cases.find((c) => c.case === m[0]);
      if (exact) return { hit: exact };
    }
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9一-龥]+/)
      .filter((t) => t.length > 1);
    const scored = cases
      .map((c) => {
        const t = c.title.toLowerCase();
        let score = 0;
        for (const tok of tokens) if (t.includes(tok)) score += 1;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return {};
    if (scored.length === 1 || scored[0].score > scored[1].score) return { hit: scored[0].c };
    return { many: scored.slice(0, 3).map((x) => x.c) };
  };

  const push = (m: Msg) => setMsgs((old) => [...old, m]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");
    push({ id: uid(), role: "user", text });

    const { hit, many } = resolveCase(text);
    if (!hit) {
      if (many?.length) {
        push({
          id: uid(),
          role: "assistant",
          kind: "info",
          text: "匹配到多个用例，你指的是哪一个？",
          suggestions: many,
        });
      } else {
        push({
          id: uid(),
          role: "assistant",
          kind: "info",
          text: "未找到对应用例。可以直接给我用例号（如 6.7.1.3），或在左侧列表里点选。",
          suggestions: cases.slice(0, 8),
        });
      }
      return;
    }

    const id = uid();
    push({ id, role: "assistant", kind: "result", caseId: hit.case, job: { state: "queued", log: [] } });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const final = await runJob(
        hit.case,
        text,
        (job) =>
          setMsgs((old) =>
            old.map((m) => (m.id === id && m.role === "assistant" && m.kind === "result" ? { ...m, job } : m))
          ),
        ctrl.signal
      );
      setMsgs((old) =>
        old.map((m) =>
          m.id === id && m.role === "assistant" && m.kind === "result" ? { ...m, job: final } : m
        )
      );
    } catch (e: any) {
      const needSettings = e?.status === 400 && (e?.code === "no_credential" || /credential/i.test(e?.message || ""));
      setMsgs((old) =>
        old.map((m) =>
          m.id === id && m.role === "assistant" && m.kind === "result"
            ? {
                id,
                role: "assistant",
                kind: "error",
                text: needSettings ? "尚未配置模型凭据，无法运行。" : e?.message || "运行失败",
                needSettings,
              }
            : m
        )
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (seed?.n) send(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const copy = async (m: Msg) => {
    let text = "";
    if (m.role === "user") text = m.text;
    else if (m.kind === "info" || m.kind === "error") text = m.text;
    else {
      const job = m.job;
      const stages = buildStages(job)
        .map((s) => `- ${s.label}：${s.status} — ${s.summary}`)
        .join("\n");
      const vs = violationsOf(job)
        .map((v) => `  · [${v.rule}] ${v.path} — ${v.detail}`)
        .join("\n");
      text = `${m.caseId}\n${conclusionOf(job)}\n${stages}${vs ? "\n违规：\n" + vs : ""}`;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 忽略 */
    }
  };

  const examples = ["6.7.1.3", "禁用 GNSS 后不允许注册", "6.7.1.12 为什么弃权？"];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {msgs.length === 0 && (
          <div className="mx-auto mt-10 max-w-md text-center">
            <div className="text-[15px] font-semibold">把条款变成可执行的测试意图</div>
            <p className="mt-1 text-[13px] text-muted">
              输入用例号或一句话描述，系统会走完
              <span className="font-mono"> 读取 → 裁剪 → 候选 → 生成 → 校验 → 评分 </span>
              六步，并在校验不通过时拒收。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {examples.map((e) => (
                <button
                  key={e}
                  onClick={() => send(e)}
                  className="rounded-full border border-line px-3 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="prose-cn max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-[13px] text-white">
                  {m.text}
                </div>
              </div>
            );
          }
          const isResult = m.kind === "result";
          const job = isResult ? m.job : undefined;
          const verdict = verdictOf(job);
          const vs = violationsOf(job);
          return (
            <div key={m.id} className="flex justify-start">
              <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-surface px-3.5 py-3">
                {m.kind === "info" && (
                  <>
                    <div className="prose-cn text-[13px]">{m.text}</div>
                    {m.suggestions?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.suggestions.map((c) => (
                          <button
                            key={c.case}
                            onClick={() => send(c.case)}
                            className="rounded border border-line px-2 py-0.5 font-mono text-[12px] hover:border-accent hover:text-accent"
                            title={c.title}
                          >
                            {c.case}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}

                {m.kind === "error" && (
                  <div className="text-[13px]">
                    <span className="text-bad">{m.text}</span>
                    {m.needSettings && (
                      <button
                        onClick={onOpenSettings}
                        className="ml-2 rounded border border-accent px-2 py-0.5 text-[12px] text-accent"
                      >
                        去设置
                      </button>
                    )}
                  </div>
                )}

                {isResult && (
                  <>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 rounded bg-line/60 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                        {m.caseId}
                      </span>
                      <div className="min-w-0 flex-1 text-[13px] font-medium">
                        {job && job.state === "queued" ? "已排队…" : conclusionOf(job)}
                      </div>
                      <button
                        onClick={() => copy(m)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-line/40"
                      >
                        复制
                      </button>
                    </div>

                    <StageTimeline job={job} />
                    {skippedNote(job)}

                    {vs.length > 0 && (
                      <div className="mt-3 rounded border border-bad/30 bg-bad/5 p-2.5">
                        <div className="mb-1 text-[12px] font-semibold text-bad">
                          违规 {vs.length} 条{verdict === "reject" ? " · 已拒收，未写入结果" : ""}
                        </div>
                        <ul className="space-y-0.5">
                          {vs.map((v, i) => (
                            <li key={i} className="font-mono text-[11.5px] text-muted">
                              [{v.rule}] {v.path} — {v.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {verdict === "pass" && (
                      <div className="mt-2 text-[12px] text-ok">✓ 校验通过，产物已写入结果</div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line bg-surface p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={areaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="输入用例号或一句话需求，Enter 发送，Shift+Enter 换行"
            className="scroll-thin max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          {busy ? (
            <button
              onClick={stop}
              className="h-[44px] shrink-0 rounded-lg border border-line px-3 text-[13px] hover:bg-line/40"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="h-[44px] shrink-0 rounded-lg bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
          <span>校验器为确定性程序，不参与生成；弃权时不调用模型</span>
          <button onClick={onOpenSettings} className="hover:text-accent">
            模型设置
          </button>
        </div>
      </div>
    </div>
  );
}
