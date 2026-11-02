"use client";

import { ArrowUp, Check, ChevronLeft, ChevronRight, Plus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type SkillItem, type ToolItem } from "@/lib/api";
import {
  ENGINE_LABELS,
  MODE_LABELS,
  REPAIR_CHOICES,
  STRICTNESS_LABELS,
  resetRunOptions,
  setRunOptions,
  useRunOptions,
  type Engine,
  type RunMode,
  type Strictness,
} from "@/lib/runParams";

type Props = {
  inProgress: boolean;
  onSend: (text: string) => Promise<unknown>;
  onStop?: () => void;
  chatReady?: boolean;
  isVisible?: boolean;
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-1 py-1.5">
      <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Choice({
  active,
  label,
  onClick,
}: {
  active?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {active && <Check className="h-3.5 w-3.5 text-accent-ink" />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function NavRow({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 border-t border-line/60 px-3 py-2 text-left text-xs transition hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="flex-1">{title}</span>
      <span className="text-[10px] text-muted">{meta}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted" />
    </button>
  );
}

export function ChatInput({ inProgress, onSend, onStop, chatReady }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "skills" | "mcp">("main");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const opts = useRunOptions();
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .skills()
      .then((r) => alive && setSkills(r.skills ?? []))
      .catch(() => {});
    api
      .tools()
      .then((r) => alive && setTools((r.tools ?? []).filter((t) => !t.eval_only)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [text]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const send = async () => {
    const v = text.trim();
    if (!v || inProgress) return;
    setText("");
    await onSend(v);
  };

  const readonly = tools.filter((t) => !t.model);
  const effectiveTools = opts.mcpTools ?? readonly.map((t) => t.name);

  const toggleSkill = (name: string) =>
    setRunOptions({
      skills: opts.skills.includes(name)
        ? opts.skills.filter((x) => x !== name)
        : [...opts.skills, name],
    });

  const toggleTool = (name: string) =>
    setRunOptions({
      mcpTools: effectiveTools.includes(name)
        ? effectiveTools.filter((x) => x !== name)
        : [...effectiveTools, name],
    });

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (opts.engine !== "pipeline")
    chips.push({
      key: "engine",
      label: ENGINE_LABELS[opts.engine],
      clear: () => setRunOptions({ engine: "pipeline" }),
    });
  if (opts.mode !== "full")
    chips.push({ key: "mode", label: MODE_LABELS[opts.mode], clear: () => setRunOptions({ mode: "full" }) });
  if (opts.repairs !== 1)
    chips.push({
      key: "repairs",
      label: opts.repairs === 0 ? "不修复" : `修复 ${opts.repairs} 轮`,
      clear: () => setRunOptions({ repairs: 1 }),
    });
  if (opts.strictness !== "strict")
    chips.push({
      key: "strictness",
      label: STRICTNESS_LABELS[opts.strictness],
      clear: () => setRunOptions({ strictness: "strict" }),
    });
  if (opts.messages.length)
    chips.push({
      key: "messages",
      label: `消息 ${opts.messages.join(" / ")}`,
      clear: () => setRunOptions({ messages: [] }),
    });
  opts.skills.forEach((name) =>
    chips.push({
      key: `skill-${name}`,
      label: `技能 ${name}`,
      clear: () => setRunOptions({ skills: opts.skills.filter((x) => x !== name) }),
    })
  );
  if (opts.mcpTools && readonly.length)
    chips.push({
      key: "mcp",
      label: `MCP ${opts.mcpTools.length}/${readonly.length}`,
      clear: () => setRunOptions({ mcpTools: null }),
    });

  return (
    <div ref={boxRef} className="relative w-full">
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-[19rem] overflow-hidden rounded-lg border border-line bg-surface shadow-overlay">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            {view === "main" ? (
              <span className="text-xs font-medium">运行参数</span>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-accent-ink"
                onClick={() => setView("main")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {view === "skills" ? "技能" : "MCP 连接器"}
              </button>
            )}
            {view === "main" ? (
              <button
                type="button"
                className="text-[11px] text-muted hover:text-accent-ink"
                onClick={() => resetRunOptions()}
              >
                恢复默认
              </button>
            ) : (
              <span className="text-[11px] text-muted">
                {view === "skills" ? `${opts.skills.length} 已选` : `${effectiveTools.length}/${readonly.length}`}
              </span>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            {view === "main" ? (
              <>
                <Group title="编排方式">
                  {(Object.keys(ENGINE_LABELS) as Engine[]).map((e) => (
                    <Choice
                      key={e}
                      active={opts.engine === e}
                      label={ENGINE_LABELS[e]}
                      onClick={() => setRunOptions({ engine: e })}
                    />
                  ))}
                  {opts.engine === "agent" && (
                    <div className="px-2 pt-1 text-[10px] text-muted">
                      模型自行决定调用顺序；生成范围、修复轮数、严格度由它判断，预算 8 次工具调用。
                    </div>
                  )}
                </Group>
                {opts.engine === "pipeline" && (
                  <>
                    <Group title="生成范围">
                      {(Object.keys(MODE_LABELS) as RunMode[]).map((m) => (
                        <Choice
                          key={m}
                          active={opts.mode === m}
                          label={MODE_LABELS[m]}
                          onClick={() => setRunOptions({ mode: m })}
                        />
                      ))}
                    </Group>
                    <Group title="修复轮数">
                      {REPAIR_CHOICES.map((n) => (
                        <Choice
                          key={n}
                          active={opts.repairs === n}
                          label={n === 0 ? "不修复" : n === 1 ? "1 轮（默认）" : `最多 ${n} 轮`}
                          onClick={() => setRunOptions({ repairs: n })}
                        />
                      ))}
                    </Group>
                    <Group title="校验严格度">
                      {(Object.keys(STRICTNESS_LABELS) as Strictness[]).map((s) => (
                        <Choice
                          key={s}
                          active={opts.strictness === s}
                          label={STRICTNESS_LABELS[s]}
                          onClick={() => setRunOptions({ strictness: s })}
                        />
                      ))}
                    </Group>
                  </>
                )}
                <NavRow
                  title="技能"
                  meta={opts.skills.length ? `已选 ${opts.skills.length}` : `${skills.length} 个`}
                  onClick={() => setView("skills")}
                />
                <NavRow
                  title="MCP 连接器"
                  meta={`${effectiveTools.length}/${readonly.length} 只读工具`}
                  onClick={() => setView("mcp")}
                />
              </>
            ) : view === "skills" ? (
              <Group title="选中后随本次修复提示带入">
                {skills.length === 0 && <div className="px-2 py-1 text-xs text-muted">技能库读取中…</div>}
                {skills.map((s) => (
                  <Choice
                    key={s.name}
                    active={opts.skills.includes(s.name)}
                    label={s.name}
                    onClick={() => toggleSkill(s.name)}
                  />
                ))}
              </Group>
            ) : (
              <Group title="未勾选的工具不会被助手调用">
                {readonly.length === 0 && (
                  <div className="px-2 py-1 text-xs text-muted">连接器读取中…</div>
                )}
                {readonly.map((t) => (
                  <Choice
                    key={t.name}
                    active={effectiveTools.includes(t.name)}
                    label={t.name}
                    onClick={() => toggleTool(t.name)}
                  />
                ))}
                {readonly.length > 0 && (
                  <div className="flex justify-between px-2 pt-1 text-[10px] text-muted">
                    <button type="button" className="hover:text-accent-ink" onClick={() => setRunOptions({ mcpTools: null })}>
                      全选
                    </button>
                    <button type="button" className="hover:text-accent-ink" onClick={() => setRunOptions({ mcpTools: [] })}>
                      全不选
                    </button>
                  </div>
                )}
              </Group>
            )}
          </div>
          <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
            参数随本次运行下发，不进入对话内容；技能随修复提示带入，未勾选的只读工具不会被助手调用。
          </div>
        </div>
      )}

      <div className="rounded-md border border-line bg-surface px-3 pb-2 pt-2 shadow-overlay focus-within:border-accent/40">
        {chips.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 py-0.5 pl-2 pr-1 text-[11px] text-accent-ink"
              >
                {c.label}
                <button
                  type="button"
                  aria-label={`移除 ${c.label}`}
                  className="rounded-full p-0.5 hover:bg-accent/20"
                  onClick={c.clear}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          data-testid="copilot-chat-textarea"
          value={text}
          disabled={chatReady === false}
          placeholder="给用例号，或描述场景…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-40 w-full resize-none bg-transparent px-1 py-1 text-sm leading-relaxed outline-none placeholder:text-muted disabled:opacity-60"
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            aria-label="运行参数"
            title="运行参数"
            onClick={() => {
              setView("main");
              setOpen((v) => !v);
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-full border text-muted transition ${
              open ? "border-accent/50 bg-accent/10 text-accent-ink" : "border-line hover:border-accent/40 hover:text-accent-ink"
            }`}
          >
            <Plus className={`h-4 w-4 transition ${open ? "rotate-45" : ""}`} />
          </button>
          <span className="ml-1 hidden text-[11px] text-muted sm:inline">
            {opts.mode === "full" && opts.repairs === 1 && opts.strictness === "strict"
              ? "默认：步骤 + IE，修复 1 轮，严格校验"
              : "参数已调整"}
          </span>
          <div className="ml-auto">
            {inProgress ? (
              <button
                type="button"
                aria-label="停止"
                onClick={() => onStop?.()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/20 text-ink hover:bg-muted/30"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="发送"
                disabled={!text.trim()}
                onClick={() => void send()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-solid text-white transition disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
