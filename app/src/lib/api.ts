export type CaseItem = {
  case: string;
  title: string;
  status: string;
  gold_ies: number;
};

export type Settings = {
  provider: "proxy" | "openai" | "anthropic" | string;
  base_url: string;
  model: string;
  temperature: number;
  key_set: boolean;
  key_masked: string;
};

export type ModelsResp = { models: string[]; source: "live" | "catalog" | "error"; note?: string };

export type Conversation = {
  id: string;
  title: string;
  updated?: number;
  turns?: number;
  last_case?: string | null;
};

export type StageRec = {
  stage: string;
  status?: string;
  summary?: string;
  detail?: Record<string, unknown>;
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  at?: number;
  job_id?: string;
  case?: string;
  verdict?: "pass" | "reject" | "abstained" | string;
  stages?: StageRec[];
  violations?: Violation[];
  L1?: number | null;
  L3?: number | null;
  status?: string;
  summary?: string;
  explain?: ExplainData | null;
};

export type ExplainSection = { key?: string; title?: string; body?: string };

export type ExplainData = {
  headline?: string;
  sections?: ExplainSection[];
  model?: string;
  generated_at?: string;
};

export type ConversationDetail = Conversation & { created?: number; messages: Message[] };

export type RunRec = {
  job_id: string;
  case: string;
  state: string;
  verdict?: string | null;
  summary?: string;
  started?: number;
  finished?: number;
  seconds?: number;
};

export type JobLog = { t: number; msg: string };

export type Violation = { rule: string; path: string; detail: string };

export type JobCandidate = string | { message?: string; name?: string };

export type Job = {
  id?: string;
  state: "queued" | "running" | "awaiting_approval" | "done" | "failed";
  stage?: string;
  log: JobLog[];
  verdict?: "pass" | "reject" | "canceled" | null;
  approval?: {
    status: "pending" | "approved" | "rejected" | "timeout" | string;
    candidates?: JobCandidate[];
  };
  result?: {
    stage?: string;
    status?: string;
    summary?: string;
    verdict?: "pass" | "reject";
    detail?: { violations?: Violation[]; [k: string]: unknown };
    violations?: Violation[];
  };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError(0, "后端不可达，请确认已启动 scripts/serve.py");
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error || `HTTP ${res.status}`, body?.error);
  }
  return body as T;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? "?" + s : "";
};

export const api = {
  health: () => call<any>("/api/health"),
  cases: () => call<CaseItem[]>("/api/cases"),
  getSettings: () => call<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings> & { api_key?: string }) =>
    call<any>("/api/settings", { method: "POST", body: JSON.stringify(s) }),
  test: (s?: Record<string, unknown>) =>
    call<{ ok: boolean; latency_ms?: number; model_seen?: string; error?: string }>("/api/test", {
      method: "POST",
      body: JSON.stringify(s || {}),
    }),
  models: (provider?: string, base_url?: string) =>
    call<ModelsResp>("/api/models" + qs({ provider, base_url })),

  conversations: () => call<Conversation[]>("/api/conversations"),
  createConversation: (title?: string) =>
    call<{ id: string; title: string }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  conversation: (id: string) => call<ConversationDetail>(`/api/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    call<{ ok: true }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) =>
    call<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" }),
  appendMessage: (id: string, role: Message["role"], content: string) =>
    call<{ ok: true; at: number }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }),

  runs: (limit = 20) => call<RunRec[]>("/api/runs" + qs({ limit })),

  chatGuide: (message: string, conversationId?: string) =>
    call<{ action: "run" | "reply"; case?: string; say: string; source?: string; model?: string }>(
      "/api/chat",
      { method: "POST", body: JSON.stringify({ message, conversation_id: conversationId }) }
    ),

  run: (caseId: string, instruction: string, conversationId?: string, hitl?: boolean) =>
    call<{ job_id: string }>("/api/run", {
      method: "POST",
      body: JSON.stringify({
        case: caseId,
        instruction,
        conversation_id: conversationId,
        hitl: Boolean(hitl),
      }),
    }),
  approveJob: (jobId: string, decision: "approve" | "reject") =>
    call<{ ok: true }>(`/api/job/${jobId}/approve`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  job: (id: string) => call<Job>(`/api/job/${id}`),
};

/** 轮询已有任务：1s 起，逐步退避到 3s；超过 maxMs 抛错，避免永久卡死。 */
export async function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  signal: AbortSignal,
  maxMs = 1200000
): Promise<Job> {
  const t0 = Date.now();
  let last: Job = { state: "queued", log: [] };
  let delay = 1000;
  while (!signal.aborted) {
    if (Date.now() - t0 > maxMs) throw new ApiError(0, "任务超时（超过 20 分钟未完成）");
    await new Promise((r) => setTimeout(r, delay));
    if (signal.aborted) break;
    last = await api.job(jobId);
    onUpdate(last);
    if (last.state === "done" || last.state === "failed") return last;
    delay = Math.min(Math.round(delay * 1.5), 3000);
  }
  return last;
}

/** SSE 订阅任务；不可用/断开时返回 fallback，由调用方回退到 pollJob。 */
export function streamJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  signal: AbortSignal
): Promise<{ mode: "done" | "fallback"; job?: Job }> {
  return new Promise((resolve) => {
    if (typeof EventSource === "undefined") {
      resolve({ mode: "fallback" });
      return;
    }
    let es: EventSource | null = null;
    let settled = false;
    let last: Job | undefined;
    const finish = (r: { mode: "done" | "fallback"; job?: Job }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      es?.close();
      resolve(r);
    };
    const onAbort = () => finish({ mode: "fallback", job: last });
    if (signal.aborted) {
      resolve({ mode: "fallback", job: last });
      return;
    }
    signal.addEventListener("abort", onAbort);
    try {
      es = new EventSource(`/api/job/${jobId}/stream`);
    } catch {
      finish({ mode: "fallback" });
      return;
    }
    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as Job;
        last = job;
        onUpdate(job);
        if (job.state === "done" || job.state === "failed") finish({ mode: "done", job });
      } catch {
        /* 忽略坏帧，继续等下一帧 */
      }
    };
    es.onerror = () => finish({ mode: "fallback", job: last });
  });
}

/** 发起任务：优先 SSE，失败回退轮询。 */
export async function runJob(
  caseId: string,
  instruction: string,
  onUpdate: (job: Job) => void,
  signal: AbortSignal,
  conversationId?: string,
  onJobId?: (jobId: string) => void,
  hitl?: boolean
): Promise<Job> {
  const { job_id } = await api.run(caseId, instruction, conversationId, hitl);
  onJobId?.(job_id);
  const r = await streamJob(job_id, onUpdate, signal);
  if (signal.aborted) return r.job ?? { state: "done", log: [] };
  if (r.mode === "fallback") return pollJob(job_id, onUpdate, signal);
  return r.job ?? { state: "done", log: [] };
}
