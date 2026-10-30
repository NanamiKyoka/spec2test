import * as React from "react";
import { KeyRound, RefreshCw, Save, PlugZap, Info, ArrowRight } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHead,
  Chip,
  Field,
  Term,
  inputCls,
  useToast,
} from "../ui";
import { api, ApiError, type ModelsResp, type Settings } from "../lib/api";
import { cn } from "../lib/cn";

type Provider = "proxy" | "openai" | "anthropic";

const DEFAULTS: Record<Provider, { base_url: string; model: string }> = {
  proxy: { base_url: "http://127.0.0.1:15721", model: "claude-sonnet-4-6[1M]" },
  openai: { base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  anthropic: { base_url: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
};

const PROVIDER_LABEL: Record<Provider, string> = {
  proxy: "本地代理（OpenCode）",
  openai: "OpenAI 兼容",
  anthropic: "Anthropic 官方",
};

const NO_KEY_PROVIDERS: Provider[] = ["openai", "anthropic"];

export function ApiView() {
  const toast = useToast();

  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [provider, setProvider] = React.useState<Provider>("proxy");
  const [baseUrl, setBaseUrl] = React.useState(DEFAULTS.proxy.base_url);
  const [model, setModel] = React.useState(DEFAULTS.proxy.model);
  const [temperature, setTemperature] = React.useState(0);
  const [apiKey, setApiKey] = React.useState("");

  // 用户手动改过就不再被通道切换覆盖
  const touchedBase = React.useRef(false);
  const touchedModel = React.useRef(false);

  const [models, setModels] = React.useState<ModelsResp | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    text: string;
    latency?: number;
    seen?: string;
  } | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const applySettings = React.useCallback((s: Settings) => {
    setSettings(s);
    const p = (s.provider as Provider) || "proxy";
    setProvider(p);
    setBaseUrl(s.base_url || DEFAULTS[p]?.base_url || "");
    setModel(s.model || DEFAULTS[p]?.model || "");
    setTemperature(typeof s.temperature === "number" ? s.temperature : 0);
    touchedBase.current = false;
    touchedModel.current = false;
  }, []);

  const load = React.useCallback(() => {
    setLoadError(null);
    api
      .getSettings()
      .then(applySettings)
      .catch((e) => setLoadError(msgOf(e)));
  }, [applySettings]);

  React.useEffect(() => {
    load();
  }, [load]);

  const fetchModels = React.useCallback(
    (p: Provider, base: string) => {
      setFetching(true);
      setModels(null);
      api
        .models(p, base)
        .then((r) => setModels(r))
        .catch((e) => setModels({ models: [], source: "error", note: msgOf(e) }))
        .finally(() => setFetching(false));
    },
    []
  );

  // 首次进入按当前通道拉一次模型列表（catalog 场景很便宜）
  React.useEffect(() => {
    if (settings) fetchModels(provider, baseUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  function onProviderChange(next: Provider) {
    setProvider(next);
    setTestResult(null);
    if (!touchedBase.current) setBaseUrl(DEFAULTS[next].base_url);
    if (!touchedModel.current) setModel(DEFAULTS[next].model);
    fetchModels(next, touchedBase.current ? baseUrl : DEFAULTS[next].base_url);
  }

  function onSave() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      provider,
      base_url: baseUrl.trim(),
      model: model.trim(),
      temperature: Number(temperature),
    };
    if (apiKey) payload.api_key = apiKey;
    api
      .saveSettings(payload as never)
      .then(() => api.getSettings())
      .then((s) => {
        applySettings(s);
        setApiKey(""); // 保存后立刻清空，明文不留在 DOM
        toast("已保存");
      })
      .catch((e) => toast("保存失败：" + msgOf(e)))
      .finally(() => setSaving(false));
  }

  function onTest() {
    setTesting(true);
    setTestResult(null);
    const payload: Record<string, unknown> = {
      provider,
      base_url: baseUrl.trim(),
      model: model.trim(),
    };
    if (apiKey) payload.api_key = apiKey;
    api
      .test(payload)
      .then((r) => {
        if (r.ok) {
          setTestResult({
            ok: true,
            text: "连接成功",
            latency: r.latency_ms,
            seen: r.model_seen,
          });
        } else {
          setTestResult({
            ok: false,
            text: r.error === "no_credential" ? "未配置密钥（该通道需要 API Key）" : r.error || "连接失败",
          });
        }
      })
      .catch((e) => {
        const err = e as ApiError;
        setTestResult({
          ok: false,
          text: err.code === "no_credential" ? "未配置密钥（该通道需要 API Key）" : msgOf(e),
        });
      })
      .finally(() => setTesting(false));
  }

  const options = React.useMemo(() => {
    const list = models?.models ? [...models.models] : [];
    if (model && !list.includes(model)) list.unshift(model);
    return list;
  }, [models, model]);

  const keySet = !!settings?.key_set;
  const needsKey = NO_KEY_PROVIDERS.includes(provider);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-[20px] font-semibold tracking-tight">API 管理</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        选择模型通道并配置凭据。凭据只保存在本机{" "}
        <code className="rounded bg-surface px-1 py-0.5 font-mono text-[12px]">data/settings.json</code>
        （已被 gitignore），页面只显示掩码，不会回传明文。
      </p>

      {loadError && (
        <div className="mt-4 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] text-bad">
          读取配置失败：{loadError}
        </div>
      )}

      {/* 三种通道怎么选 */}
      <Card className="mt-4">
        <CardHead className="flex items-center gap-2">
          <Info className="h-4 w-4 text-accent" />
          三种通道怎么选
        </CardHead>
        <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-muted">
          <p>
            <b className="text-ink">本地代理</b>：适合"手上没有厂商 Key"的情况——只要本机 OpenCode
            代理在跑，<b className="text-ink">不需要填 Key</b>。它的模型列表无法枚举，页面会显示内置目录。
          </p>
          <p>
            <b className="text-ink">OpenAI 兼容</b>：适用于 DeepSeek、通义、vLLM 等任意兼容端点，填
            Base URL 与 Key 后点「获取模型列表」即可。
          </p>
          <p>
            <b className="text-ink">Anthropic 官方</b>：直连官方 API，需要 API Key。
          </p>
        </CardBody>
      </Card>

      {/* 表单 */}
      <Card className="mt-4">
        <CardHead className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            模型通道与密钥
          </span>
          <Chip tone={keySet ? "ok" : "warn"}>{keySet ? "已配置密钥" : "未配置密钥"}</Chip>
        </CardHead>

        <CardBody className="space-y-4">
          <Field label="通道" htmlFor="provider">
            <select
              id="provider"
              className={cn(inputCls, "cursor-pointer")}
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as Provider)}
            >
              {(Object.keys(DEFAULTS) as Provider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Base URL"
            htmlFor="base_url"
            hint={provider === "proxy" ? "本地代理根地址，不要带 /v1/messages" : "OpenAI 兼容端点通常以 /v1 结尾"}
          >
            <input
              id="base_url"
              className={inputCls}
              value={baseUrl}
              spellCheck={false}
              onChange={(e) => {
                touchedBase.current = true;
                setBaseUrl(e.target.value);
              }}
            />
          </Field>

          <Field
            label="模型"
            htmlFor="model"
            hint={
              models?.source === "catalog"
                ? "本地代理不支持枚举，显示内置目录"
                : models?.source === "error"
                ? undefined
                : "点右侧「获取模型列表」从端点拉取"
            }
          >
            <div className="flex items-center gap-2">
              <select
                id="model"
                className={cn(inputCls, "cursor-pointer")}
                value={model}
                onChange={(e) => {
                  touchedModel.current = true;
                  setModel(e.target.value);
                }}
              >
                {options.length === 0 && <option value={model}>{model}</option>}
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                onClick={() => fetchModels(provider, baseUrl.trim())}
                disabled={fetching}
                title="从当前通道获取可用模型"
              >
                <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} />
                {fetching ? "获取中" : "获取模型列表"}
              </Button>
            </div>
            {models?.source === "catalog" && (
              <p className="mt-1 text-[11px] text-muted">{models.note || "已回退到内置目录"}</p>
            )}
            {models?.source === "error" && (
              <p className="mt-1 text-[11px] text-bad">获取失败：{models.note || "未知原因"}</p>
            )}
          </Field>

          <Field
            label="温度"
            htmlFor="temperature"
            hint="0 最稳定，评测建议 0；本项目的对比实验固定为 0"
          >
            <input
              id="temperature"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-[rgb(var(--accent))]"
            />
            <div className="mt-1 font-mono text-[12px] text-muted">{temperature.toFixed(1)}</div>
          </Field>

          <Field
            label={needsKey ? "API Key（必填）" : "API Key（可选）"}
            htmlFor="api_key"
            hint={
              keySet
                ? "已保存过密钥；留空表示不修改"
                : needsKey
                ? "该通道需要 Key 才能调用"
                : "本地代理无需 Key，留空即可"
            }
          >
            <input
              id="api_key"
              type="password"
              autoComplete="off"
              className={inputCls}
              value={apiKey}
              placeholder={settings?.key_masked ? `已保存：${settings.key_masked}` : "尚未配置"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "保存中" : "保存"}
            </Button>
            <Button variant="ghost" onClick={onTest} disabled={testing}>
              <PlugZap className="h-4 w-4" />
              {testing ? "测试中" : "测试连接"}
            </Button>
            <a
              href="#/chat"
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              去对话页试运行 <ArrowRight className="h-3 w-3" />
            </a>
          </div>

          {testResult && (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-[12px]",
                testResult.ok
                  ? "border-ok/40 bg-ok/5 text-ok"
                  : "border-bad/40 bg-bad/5 text-bad"
              )}
            >
              {testResult.ok ? (
                <>
                  连接成功
                  {testResult.seen && <> · 模型 {testResult.seen}</>}
                  {typeof testResult.latency === "number" && <> · {testResult.latency} ms</>}
                </>
              ) : (
                <>
                  连接失败：{testResult.text}
                  {testResult.text.includes("未配置密钥") && (
                    <> —— 也可以先用本地代理通道跑通（无需 Key）</>
                  )}
                </>
              )}
            </div>
          )}

          {needsKey && !keySet && (
            <p className="text-[11px] leading-relaxed text-muted">
              提示：未配置 Key 时，对话页会收到{" "}
              <Term term="no_credential" desc="后端返回的错误码，表示当前通道缺少可用凭据" />
              ，这是预期行为，不是故障。
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function msgOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
