import { useEffect, useState } from "react";
import { api, type Settings } from "../lib/api";

const DEFAULTS: Record<string, { base_url: string; model: string }> = {
  proxy: { base_url: "http://127.0.0.1:15721", model: "claude-sonnet-4-6[1M]" },
  openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  anthropic: { base_url: "", model: "claude-sonnet-5-5" },
};

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [s, setS] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "bad" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setApiKey("");
    api
      .getSettings()
      .then(setS)
      .catch((e) => setMsg({ kind: "bad", text: e.message }));
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<Settings>) => setS((old) => (old ? { ...old, ...patch } : old));

  const changeProvider = (provider: string) => {
    const d = DEFAULTS[provider];
    setS((old) => {
      if (!old) return old;
      const keepUserEdited =
        old.base_url && old.base_url !== DEFAULTS[old.provider]?.base_url;
      return {
        ...old,
        provider,
        base_url: keepUserEdited ? old.base_url : d.base_url,
        model: old.model && old.model !== DEFAULTS[old.provider]?.model ? old.model : d.model,
      };
    });
  };

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const body: any = {
        provider: s.provider,
        base_url: s.base_url,
        model: s.model,
        temperature: Number(s.temperature),
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      await api.saveSettings(body);
      setApiKey("");
      const fresh = await api.getSettings();
      setS(fresh);
      setMsg({ kind: "ok", text: "已保存。" });
    } catch (e: any) {
      setMsg({ kind: "bad", text: e.message || "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!s) return;
    setBusy(true);
    setMsg({ kind: "info", text: "正在测试连接…" });
    try {
      const r = await api.test({
        provider: s.provider,
        base_url: s.base_url,
        model: s.model,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      if (r.ok) {
        setMsg({
          kind: "ok",
          text: `连接成功 · ${r.model_seen || s.model}${r.latency_ms ? ` · ${r.latency_ms} ms` : ""}`,
        });
      } else {
        setMsg({ kind: "bad", text: `连接失败：${r.error || "未知错误"}` });
      }
    } catch (e: any) {
      setMsg({ kind: "bad", text: `连接失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded border border-line bg-canvas px-2.5 py-1.5 text-[13px] outline-none focus:border-accent";
  const label = "mb-1 block text-[12px] font-medium text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">模型设置</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-[13px] text-muted hover:bg-line/40">
            关闭
          </button>
        </div>

        {!s ? (
          <div className="text-[13px] text-muted">读取中…</div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={label}>通道</label>
              <select aria-label="通道" className={field} value={s.provider} onChange={(e) => changeProvider(e.target.value)}>
                <option value="proxy">proxy（本地代理，无需 Key）</option>
                <option value="openai">openai（OpenAI 兼容）</option>
                <option value="anthropic">anthropic（官方）</option>
              </select>
            </div>
            <div>
              <label className={label}>Base URL</label>
              <input aria-label="Base URL" className={field} value={s.base_url} onChange={(e) => update({ base_url: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>模型</label>
                <input aria-label="模型" className={field} value={s.model} onChange={(e) => update({ model: e.target.value })} />
              </div>
              <div>
                <label className={label}>温度</label>
                <input
                  aria-label="温度"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  className={field}
                  value={s.temperature}
                  onChange={(e) => update({ temperature: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className={label}>
                API Key{" "}
                <span className="font-normal">
                  {s.key_set ? `（已配置 ${s.key_masked}，留空不修改）` : "（未配置）"}
                </span>
              </label>
              <input
                aria-label="API Key"
                type="password"
                autoComplete="off"
                className={field}
                placeholder={s.key_set ? s.key_masked : "粘贴 Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            {msg && (
              <div
                className={`rounded px-3 py-2 text-[12px] ${
                  msg.kind === "ok"
                    ? "bg-ok/10 text-ok"
                    : msg.kind === "bad"
                    ? "bg-bad/10 text-bad"
                    : "bg-line/40 text-muted"
                }`}
              >
                {msg.text}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={test}
                disabled={busy}
                className="rounded border border-line px-3 py-1.5 text-[13px] hover:bg-line/40 disabled:opacity-50"
              >
                测试连接
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
