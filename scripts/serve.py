"""本地服务：静态页面 + 结果浏览 API + 单例任务执行。

用法：
    python scripts/serve.py                       # 端口 8000，自动开浏览器
    python scripts/serve.py --port 8080 --no-browser

API 见 docs/WEB-SPEC.md。密钥只写不读：GET /api/settings 只返回掩码。
"""
import argparse
import copy
import functools
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser

import secret_store

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))     # 阶段工具与 MCP 共用实现
SETTINGS = os.path.join(ROOT, "data", "settings.json")
CONV_DIR = os.path.join(ROOT, "data", "conversations")
RUNS_FILE = os.path.join(ROOT, "data", "runs.jsonl")
JOBS_DIR = os.path.join(ROOT, "data", "jobs")
JOBS_KEEP = 300
MAX_CONCURRENT_RUNS = 4
STALE_APPROVAL_SECONDS = 700
RUN_ONE = os.path.join(HERE, "run_one.py")
ORCHESTRATE = os.path.join(HERE, "orchestrate.py")
AGENT_BUDGET = 8

CATALOG_PROXY = ["claude-sonnet-4-6[1M]", "claude-opus-4-8[1M]", "claude-haiku-4-5"]
NULLABLE_FIELDS = {"L1", "L3", "status", "verdict"}
DENIED_BASENAMES = {"settings.json", "secret.bin"}

GUIDE_FALLBACK = (
    "你好！我可以把 3GPP §6.7 的 NR NTN 测试条款编译成测试意图。"
    "你可以直接给用例号（如 6.7.1.3），或描述场景（如卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选）。"
)

PROVIDERS = ("proxy", "openai", "anthropic")
DEFAULTS = {
    "proxy": ("http://127.0.0.1:15721", "claude-sonnet-4-6[1M]"),
    "openai": ("https://api.deepseek.com/v1", "deepseek-chat"),
    "anthropic": ("https://api.anthropic.com", "claude-sonnet-5-5"),
}


def norm_base(url):
    """llm.py 会自己拼 /v1/messages 或 /chat/completions，这里剥掉已含的端点。"""
    u = (url or "").strip().rstrip("/")
    for suffix in ("/v1/messages", "/chat/completions"):
        if u.endswith(suffix):
            u = u[: -len(suffix)].rstrip("/")
    return u

_jobs = {}
_jobs_lock = threading.Lock()
_conv_lock = threading.RLock()
_approval_lock = threading.Lock()
_slot_lock = threading.Lock()      # 串行化"槽位检查 + 入表"，避免并发突破上限


def _job_path(jid):
    return os.path.join(JOBS_DIR, jid + ".json")


def save_job(job):
    """任务状态落盘（原子写）。worker 是唯一写入者，避免高频锁。"""
    jid = job.get("id")
    if not jid:
        return
    try:
        os.makedirs(JOBS_DIR, exist_ok=True)
        job["updated"] = time.time()
        tmp = _job_path(jid) + "." + uuid.uuid4().hex + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False)
        os.replace(tmp, _job_path(jid))
    except Exception:
        pass


def load_jobs():
    """启动时恢复历史任务；上次异常退出留下的 running/queued 标记为中断。"""
    if not os.path.isdir(os.path.join(ROOT, "data")):
        return
    try:
        os.makedirs(JOBS_DIR, exist_ok=True)
        names = [n for n in os.listdir(JOBS_DIR) if n.endswith(".json")]
        names.sort(key=lambda n: os.path.getmtime(os.path.join(JOBS_DIR, n)), reverse=True)
        for n in names:
            try:
                with open(os.path.join(JOBS_DIR, n), encoding="utf-8") as f:
                    job = json.load(f)
            except Exception:
                continue
            jid = job.get("id") or n[:-5]
            job["id"] = jid
            if job.get("state") in ("queued", "running", "awaiting_approval"):
                job["state"] = "failed"
                job["error"] = "restarted"
                job["finished"] = job.get("finished") or time.time()
                job.setdefault("log", []).append(
                    {"t": round(time.time(), 3), "msg": "服务重启，任务中断"}
                )
                save_job(job)
            _jobs[jid] = job
        # 只保留最近 JOBS_KEEP 个任务文件，避免 data/ 无限增长
        for n in names[JOBS_KEEP:]:
            try:
                os.remove(os.path.join(JOBS_DIR, n))
            except Exception:
                pass
    except Exception:
        pass


def get_job(jid):
    """内存优先，未命中回读磁盘并缓存。返回深拷贝，读方不得持有内部可变对象。"""
    with _jobs_lock:
        job = _jobs.get(jid)
        if job:
            return copy.deepcopy(job)
    p = _job_path(jid)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            job = json.load(f)
        job["id"] = job.get("id") or jid
        with _jobs_lock:
            cached = _jobs.get(jid)
            if cached is not None:
                return copy.deepcopy(cached)
            _jobs[jid] = job
        return copy.deepcopy(job)
    except Exception:
        return None


def _prune_jobs():
    """内存只留最近 JOBS_KEEP 个终态任务；运行中的永不淘汰（文件另由 load_jobs 裁剪）。"""
    with _jobs_lock:
        excess = len(_jobs) - JOBS_KEEP
        if excess <= 0:
            return
        finished = sorted((j.get("started") or j.get("created") or 0, jid)
                          for jid, j in _jobs.items()
                          if j.get("state") in ("done", "failed"))
        for _, jid in finished[:excess]:
            _jobs.pop(jid, None)


# ---------- settings ----------
def load_settings():
    s = {
        "provider": os.environ.get("LLM_PROVIDER", "proxy").lower(),
        "base_url": os.environ.get("LLM_BASE_URL", ""),
        "model": os.environ.get("LLM_MODEL", ""),
        "temperature": 0,
        "api_key": "",
    }
    if os.path.exists(SETTINGS):
        try:
            with open(SETTINGS, encoding="utf-8") as f:
                disk = json.load(f)
            for k in ("provider", "base_url", "model", "temperature", "api_key"):
                if k in disk and disk[k] not in (None, ""):
                    s[k] = disk[k]
        except Exception:
            pass
    if s["provider"] not in PROVIDERS:
        s["provider"] = "proxy"
    if not s["base_url"]:
        s["base_url"] = DEFAULTS[s["provider"]][0]
    s["base_url"] = norm_base(s["base_url"])
    if not s["model"]:
        s["model"] = DEFAULTS[s["provider"]][1]
    # 密钥不写明文：优先安全存储，其次环境变量，最后兼容旧 settings.json
    s["api_key"] = (s.get("api_key") or "").strip() or secret_store.load_key()
    return s


def save_settings(patch):
    cur = load_settings()
    key = (patch.get("api_key") or "").strip()
    for k in ("provider", "base_url", "model", "temperature"):
        if k in patch and patch[k] not in (None, ""):
            cur[k] = patch[k]
    if key:
        cur["_key_storage"] = secret_store.store_key(key)
        cur["api_key"] = key
    cur["base_url"] = norm_base(cur.get("base_url", "")) or DEFAULTS[cur["provider"]][0]
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    disk = {k: v for k, v in cur.items() if k not in ("api_key", "_key_storage")}
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(disk, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(SETTINGS, 0o600)
    except Exception:
        pass
    return cur


def mask(key):
    if not key:
        return ""
    if len(key) <= 8:
        return "…" + key[-2:]
    return key[:3] + "…" + key[-4:]


def credential_ok(s):
    if s["provider"] == "proxy":
        return True
    if s.get("api_key"):
        return True
    env = "ANTHROPIC_API_KEY" if s["provider"] == "anthropic" else "LLM_API_KEY"
    return bool(os.environ.get(env))


def child_env(s):
    e = dict(os.environ)
    e["LLM_PROVIDER"] = s["provider"]
    e["LLM_MODEL"] = s["model"]
    e["LLM_BASE_URL"] = s["base_url"]
    if s.get("api_key"):
        if s["provider"] == "anthropic":
            e["ANTHROPIC_API_KEY"] = s["api_key"]
        else:
            e["LLM_API_KEY"] = s["api_key"]
    return e


# ---------- conversations ----------
def _conv_path(cid):
    return os.path.join(CONV_DIR, "%s.json" % cid)


def _load_conv(cid):
    if not re.fullmatch(r"[0-9a-f]{8}", cid or ""):
        return None
    p = _conv_path(cid)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_conv(conv):
    os.makedirs(CONV_DIR, exist_ok=True)
    conv["updated"] = int(time.time())
    p = _conv_path(conv["id"])
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def new_conv(title=None):
    cid = uuid.uuid4().hex[:8]
    conv = {"id": cid, "schema": 1, "title": (title or "新对话")[:40],
            "created": int(time.time()), "updated": int(time.time()), "messages": []}
    _save_conv(conv)
    return conv


def list_convs():
    out = []
    if not os.path.isdir(CONV_DIR):
        return out
    for n in os.listdir(CONV_DIR):
        if not n.endswith(".json"):
            continue
        c = _load_conv(n[:-5])
        if not c:
            continue
        last_case = None
        for m in reversed(c.get("messages") or []):
            if m.get("case"):
                last_case = m["case"]
                break
        out.append({"id": c["id"], "title": c.get("title", ""),
                    "updated": c.get("updated", 0),
                    "turns": len(c.get("messages") or []),
                    "last_case": last_case})
    out.sort(key=lambda x: -x["updated"])
    return out


def append_message(cid, role, content, **extra):
    with _conv_lock:
        conv = _load_conv(cid)
        if conv is None:
            return None
        first_user = not any(m.get("role") == "user" for m in conv["messages"])
        msg = {"role": role, "content": content, "at": int(time.time())}
        for k, v in extra.items():
            if v is not None or k in NULLABLE_FIELDS:   # L1/L3/status 允许显式 null
                msg[k] = v
        conv["messages"].append(msg)
        if role == "user" and first_user and conv.get("title") in ("", "新对话"):
            conv["title"] = content[:20]
        _save_conv(conv)
        return msg


def update_conv_state(cid, **kw):
    """更新会话工作记忆：active_case / last_job_id / last_verdict 等。"""
    with _conv_lock:
        conv = _load_conv(cid)
        if conv is None:
            return
        state = conv.setdefault("state", {})
        state.update({k: v for k, v in kw.items() if v is not None})
        _save_conv(conv)


def conversation_context(cid, limit=8):
    """给自然语言入口的工作记忆：最近 N 轮 + 会话状态（不读全文、不注入密钥）。"""
    conv = _load_conv(cid)
    if conv is None:
        return {"messages": [], "state": {}}
    msgs = (conv.get("messages") or [])[-limit:]
    state = dict(conv.get("state") or {})
    if not state:
        active = last_job = last_verdict = None
        for m in reversed(conv.get("messages") or []):
            if not active and m.get("case"):
                active = m["case"]
            if not last_job and m.get("job_id"):
                last_job = m["job_id"]
            if not last_verdict and m.get("verdict"):
                last_verdict = m["verdict"]
        state = {"active_case": active, "last_job_id": last_job,
                 "last_verdict": last_verdict}
    return {
        "messages": [{"role": m.get("role"), "content": (m.get("content") or "")[:300]}
                     for m in msgs],
        "state": state,
    }


# ---------- run history ----------
def load_runs():
    """从 data/runs.jsonl 读历史；文件不存在或行损坏都跳过，不抛异常。"""
    out = []
    if not os.path.exists(RUNS_FILE):
        return out
    try:
        with open(RUNS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if isinstance(r, dict) and r.get("job_id"):
                    out.append(r)
    except Exception:
        return out
    return out


def append_run(rec):
    try:
        os.makedirs(os.path.dirname(RUNS_FILE), exist_ok=True)
        with open(RUNS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        print("runs 写入失败：%s" % e)


# ---------- models ----------
def fetch_models(provider, base_url, api_key):
    """按 provider 取模型列表；任何失败都降级为 source=error，不抛异常。"""
    if provider == "proxy":
        return {"models": list(CATALOG_PROXY), "source": "catalog",
                "note": "本地代理不支持枚举模型，显示内置目录"}

    base = norm_base(base_url or DEFAULTS.get(provider, ("", ""))[0])
    if not base:
        return {"models": [], "source": "error", "note": "缺少 base_url"}
    if not api_key:
        return {"models": [], "source": "error", "note": "缺少 API Key"}

    if provider == "anthropic":
        url = base + "/v1/models"
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    else:
        url = base + "/models"
        headers = {"Authorization": "Bearer " + api_key}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=3) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return {"models": [], "source": "error", "note": "HTTP %s" % e.code}
    except Exception as e:
        return {"models": [], "source": "error", "note": "%s" % str(e)[:120]}

    items = data.get("data") if isinstance(data, dict) else None
    if items is None and isinstance(data, dict):
        items = data.get("models")
    models = []
    for it in items or []:
        if isinstance(it, str):
            models.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                models.append(str(mid))
    if not models:
        return {"models": [], "source": "error", "note": "响应中没有模型条目"}
    return {"models": models, "source": "live"}


# ---------- data helpers ----------
def read_json(rel_live, rel_snap=None):
    for rel in [rel_live] + ([rel_snap] if rel_snap else []):
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
    return None


def _score_of(cid):
    """取某用例的评分行（live 优先，回落快照）。"""
    report = read_json("data/score/report.json", "results/score/report.json") or []
    return next((r for r in report if r.get("case") == cid), None)


def _case_title(cid):
    ctx = read_json("data/ctx/%s.json" % cid, "results/ctx/%s.json" % cid) or {}
    return (ctx.get("title") or "").strip()


def _explain_of(cid):
    """LLM 智能解读（若已生成）；页面与历史消息共用同一份。"""
    return read_json("data/explain/%s.json" % cid, "results/explain/%s.json" % cid)


def _plain_summary(job, verdict):
    """一句白话摘要：智能解读的 headline 只在判定一致时复用，失败任务单独说明。"""
    if job.get("state") == "failed" or verdict == "failed":
        title = _case_title(job.get("case"))
        return "运行失败：%s" % (title or job.get("case") or "未知用例")
    explain = _explain_of(job.get("case"))
    headline = ((explain or {}).get("headline") or "").strip()
    if headline and (explain.get("numbers") or {}).get("verdict") == verdict:
        return headline
    label = {"pass": "通过", "reject": "已拒收", "abstained": "已弃权",
             "canceled": "已取消", "failed": "运行失败"}.get(verdict, "运行完成")
    title = _case_title(job.get("case"))
    return "%s：%s" % (label, title or job.get("case"))


def list_cases():
    report = read_json("data/score/report.json", "results/score/report.json") or []
    by = {r.get("case"): r for r in report}
    bench_dir = os.path.join(ROOT, "data", "benchmark", "v0")
    cases = []
    if os.path.isdir(bench_dir):
        for n in sorted(os.listdir(bench_dir)):
            if not re.match(r"^6\..*\.json$", n):
                continue
            cid = n[:-5]
            b = read_json("data/benchmark/v0/" + n) or {}
            r = by.get(cid, {})
            cases.append({"case": cid, "title": b.get("title", ""),
                          "status": r.get("status", "unknown"),
                          "gold_ies": r.get("gold_ie_n", 0)})
    if not cases:
        cases = [{"case": r.get("case"), "title": "", "status": r.get("status"),
                  "gold_ies": r.get("gold_ie_n", 0)} for r in report]
    return cases


def build_guide_system(cases):
    lines = ["%s — %s" % (c.get("case"), c.get("title") or "") for c in cases]
    return (
        "你是 Spec2Test 的输入理解助手。系统唯一能处理的是 3GPP TS 38.523-1 §6.7 中以下 NR NTN 测试用例：\n"
        + "\n".join(lines)
        + "\n\n用户可能只是打招呼、问你能做什么、描述一个测试场景、给用例号，或说得含糊。"
        "请判断用户意图，只输出一个 JSON 对象（不要代码围栏）：\n"
        "- 若用户的话能对应到上面某个用例（包括按场景描述，如卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选等），输出 "
        '{"action":"run","case":"<id>","say":"<1-2 句白话，说明这条用例在测什么，不要只说‘处理 X’>"}\n'
        "- 否则输出 "
        '{"action":"reply","say":"<简体中文，最多 3 句；先白话回答，再出现术语时顺带解释；'
        '问能做什么就给 1-2 个具体示例；范围外就说明只覆盖 §6.7 的 8 个用例；含糊就追问一个最关键的点>"}\n'
        "规则：面向没有射频背景的读者；绝不编造不存在的用例号；不承诺范围外能力；语气自然，不要像报错。"
    )


def case_stages(cid):
    stages = []
    b = read_json("data/benchmark/v0/%s.json" % cid)
    stages.append({"stage": "ingest", "status": "ok" if b else "unavailable",
                   "summary": (b or {}).get("title", "无基准数据（快照不含该阶段）")[:120],
                   "detail": {k: len((b or {}).get("inputs", {}).get(k) or "")
                              for k in ("test_purpose", "conformance_requirements",
                                        "pre_test_conditions")} if b else {}})

    ctx = read_json("data/ctx/%s.json" % cid)
    stages.append({"stage": "context", "status": "ok" if ctx else "unavailable",
                   "summary": "上下文裁剪" if ctx else "快照中不含该阶段数据",
                   "detail": {k: len((ctx or {}).get(k) or "") for k in
                              ("test_purpose", "conformance_requirements",
                               "pre_test_conditions")} if ctx else {}})

    out = read_json("data/out/%s.json" % cid)
    abstained = bool(out) and (out.get("status") == "abstained" or not out.get("messages"))
    cands = ((out or {}).get("_stage2") or {}).get("candidates") or []
    stages.append({"stage": "candidates", "status": ("skipped" if abstained else "ok") if out else "unavailable",
                   "summary": ("候选为空 → 弃权" if abstained else "候选消息 %d 个" % len(cands)) if out else "快照中不含该阶段数据",
                   "detail": {"candidates": cands}})

    if abstained:
        for st in ("generate", "validate", "score"):
            stages.append({"stage": st, "status": "skipped",
                           "summary": "弃权：未调用模型 / 不计分", "detail": {}})
        # score 阶段仍给出官方 gold 信息
        rep = {r.get("case"): r for r in (read_json("data/score/report.json", "results/score/report.json") or [])}
        r = rep.get(cid, {})
        stages[-1]["detail"] = {"L1": r.get("L1"), "L3": r.get("L3_recall"),
                                "gold_ies": r.get("gold_ie_n", 0)}
        return stages

    if out:
        stages.append({"stage": "generate", "status": "ok",
                       "summary": "生成 %d 条消息" % len(out.get("messages") or []),
                       "detail": {"steps": len(out.get("steps") or []),
                                  "messages": len(out.get("messages") or []),
                                  "calls": (out.get("_stage2") or {}).get("calls")}})
    else:
        stages.append({"stage": "generate", "status": "unavailable",
                       "summary": "快照中不含该阶段数据", "detail": {}})

    vrep = read_json("data/validate/report.json", "results/validate/report.json") or []
    hit = next((x for x in vrep if x.get("case_id") == cid), None)
    stages.append({"stage": "validate", "status": "ok" if hit is not None else "unavailable",
                   "summary": ("无违规" if hit is not None and not hit.get("violations")
                               else "违规 %d 条" % len(hit.get("violations") or []))
                   if hit is not None else "快照中不含该阶段数据",
                   "detail": {"violations": (hit or {}).get("violations", [])}})

    rep = {r.get("case"): r for r in (read_json("data/score/report.json", "results/score/report.json") or [])}
    r = rep.get(cid)
    stages.append({"stage": "score", "status": "ok" if r else "unavailable",
                   "summary": ("L1=%.3f  L3=%s" % (r.get("L1", 0), r.get("L3_recall")))
                   if r else "快照中不含该阶段数据",
                   "detail": {"L1": (r or {}).get("L1"), "L3": (r or {}).get("L3_recall"),
                              "gold_ies": (r or {}).get("gold_ie_n", 0), "calls": (r or {}).get("calls")}})
    return stages


# ---------- job runner ----------
def _apply_job_event(job, ev, last_t=None):
    """把 run_one 的一行事件并入 job，返回本阶段计时的起点。"""
    stage = ev.get("stage")
    job["stage"] = stage or job["stage"]
    if stage == "approval":
        detail = ev.get("detail") or {}
        status = ev.get("status") or ""
        job["approval"] = {"status": status,
                           "candidates": detail.get("candidates") or []}
        job["state"] = "awaiting_approval" if status == "pending" else "running"
    if stage and stage != "verdict":
        job["stages"].append({"stage": stage, "status": ev.get("status"),
                              "summary": (ev.get("summary") or "")[:200]})
    job["log"].append({"t": round(time.time(), 3),
                       "msg": "[%s] %s" % (stage, ev.get("summary"))})
    if stage == "verdict":
        job["verdict"] = "reject" if ev.get("status") == "rejected" else "pass"
    if stage == "score":
        job["result"] = ev
        job["verdict"] = (ev.get("detail") or {}).get("verdict", job.get("verdict"))
    now = time.time()
    if stage and stage != "verdict" and last_t is not None:
        st = job.setdefault("stage_seconds", {})
        st[stage] = round(st.get(stage, 0) + (now - last_t), 2)
    return now


RUN_MODES = ("steps", "full", "repair_only")
RUN_ENGINES = ("pipeline", "agent")
RUN_STRICTNESS = ("strict", "skip_lte_r2", "r1_only")


def norm_run_options(raw):
    """把前端传的运行参数收敛成固定结构；非法值回落到默认，不报错。"""
    raw = raw if isinstance(raw, dict) else {}
    msgs = raw.get("messages")
    if isinstance(msgs, list):
        msgs = [str(m).strip() for m in msgs if str(m).strip()][:40]
    else:
        msgs = []
    try:
        repairs = max(0, min(5, int(raw.get("repairs", 1))))
    except (TypeError, ValueError):
        repairs = 1

    import skills as skills_lib
    known_skills = {s["name"] for s in skills_lib.list_skills()}
    picked = raw.get("skills")
    skills = ([str(s).strip() for s in picked if str(s).strip() in known_skills][:12]
              if isinstance(picked, list) else [])

    import stage_tools
    readonly = {n for n, t in stage_tools.TOOLS.items()
                if not t["model"] and not t["eval_only"]}
    picked_tools = raw.get("mcpTools", raw.get("mcp_tools"))
    mcp_tools = (sorted({str(t).strip() for t in picked_tools if str(t).strip() in readonly})
                 if isinstance(picked_tools, list) else None)

    return {
        "messages": msgs,
        "mode": raw.get("mode") if raw.get("mode") in RUN_MODES else "full",
        "repairs": repairs,
        "strictness": (raw.get("strictness")
                       if raw.get("strictness") in RUN_STRICTNESS else "strict"),
        "engine": raw.get("engine") if raw.get("engine") in RUN_ENGINES else "pipeline",
        "skills": skills,
        "mcpTools": mcp_tools,
    }


def start_job(cid, dry_run=False, conversation_id=None, hitl=False, options=None):
    options = norm_run_options(options)
    jid = uuid.uuid4().hex[:12]
    with _jobs_lock:
        _jobs[jid] = {"id": jid, "state": "queued", "stage": "", "log": [], "result": None,
                      "created": time.time(), "updated": time.time(), "case": cid,
                      "conversation_id": conversation_id, "hitl": bool(hitl),
                      "options": options,
                      "approval": None,
                      "verdict": None, "stages": [], "started": None, "finished": None}
    with _jobs_lock:
        save_job(_jobs[jid])
    s = load_settings()
    with _jobs_lock:
        _jobs[jid].update({"provider": s["provider"], "model": s["model"],
                           "mode": "dry" if dry_run else "live",
                           "engine": options["engine"]})
        save_job(_jobs[jid])

    def worker():
        job = _jobs[jid]
        with _jobs_lock:
            job["state"] = "running"
            job["started"] = time.time()
            save_job(job)
        last_t = time.time()
        if options["engine"] == "agent":
            cmd = [sys.executable, ORCHESTRATE, cid, "--max-steps", str(AGENT_BUDGET)]
        else:
            cmd = [sys.executable, RUN_ONE, cid]
            if dry_run:
                cmd.append("--dry-run")
            if hitl:
                cmd.extend(["--hitl", "--job-id", jid])
            cmd.extend(["--mode", options["mode"], "--repairs", str(options["repairs"]),
                        "--strictness", options["strictness"]])
            if options["messages"]:
                cmd.extend(["--messages", ",".join(options["messages"])])
            if options["skills"]:
                cmd.extend(["--skills", ",".join(options["skills"])])
        try:
            env = child_env(s)
            env["SPEC2TEST_JOB"] = jid        # 工具调用按任务归档，供 trace 面板取决策轨迹
            proc = subprocess.Popen(cmd, cwd=ROOT, env=env, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    encoding="utf-8", errors="replace", bufsize=1)
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    with _jobs_lock:
                        job["log"].append({"t": round(time.time(), 3), "msg": line[:300]})
                        save_job(job)
                    continue
                with _jobs_lock:
                    last_t = _apply_job_event(job, ev, last_t)
                    save_job(job)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
                with _jobs_lock:
                    job["error"] = "timeout"
                    job["log"].append({"t": round(time.time(), 3), "msg": "进程超时，已终止"})
            with _jobs_lock:
                if proc.returncode != 0:
                    job["state"] = "failed"
                    job.setdefault("error", "process_exit_%d" % proc.returncode)
                else:
                    job["state"] = "done"
                save_job(job)
        except Exception as e:
            with _jobs_lock:
                job["state"] = "failed"
                job["error"] = str(e)[:200]
                job["log"].append({"t": round(time.time(), 3), "msg": "执行异常：%s" % e})
                save_job(job)
        finally:
            with _jobs_lock:
                job["finished"] = time.time()
                job["verdict"] = _job_verdict(job)
                rec = {"job_id": jid, "case": job.get("case"), "state": job.get("state"),
                       "verdict": job.get("verdict"),
                       "started": job.get("started"), "finished": job.get("finished"),
                       "seconds": round(job["finished"] - job["started"], 2)
                       if job.get("started") else None,
                       "mode": job.get("mode"), "provider": job.get("provider"),
                       "model": job.get("model"), "conversation_id": job.get("conversation_id"),
                       "stages": job.get("stage_seconds") or {}}
                if job.get("error"):
                    rec["error"] = job["error"]
                save_job(job)
            summary = _plain_summary(job, job.get("verdict"))
            job["summary"] = summary
            rec["summary"] = summary
            append_run(rec)
            if conversation_id:
                try:
                    _attach_job_result(conversation_id, jid, job)
                except Exception as e:
                    with _jobs_lock:
                        job["log"].append({"t": round(time.time(), 3),
                                           "msg": "会话写入失败：%s" % e})
                        save_job(job)
            _prune_jobs()

    threading.Thread(target=worker, daemon=True).start()
    return jid



def _expire_stale_jobs():
    """审批等待超时的任务视为结束：否则旧任务会一直占着会话运行锁。"""
    now = time.time()
    stale = []
    with _jobs_lock:
        for jid, job in _jobs.items():
            if job.get("state") != "awaiting_approval":
                continue
            started = job.get("started") or job.get("created") or 0
            if now - started <= STALE_APPROVAL_SECONDS:
                continue
            job["state"] = "failed"
            job["error"] = "approval_timeout"
            job["finished"] = now
            job.setdefault("log", []).append(
                {"t": round(now, 3), "msg": "审批等待超时，任务已自动结束"}
            )
            stale.append((jid, job))
    for jid, job in stale:
        try:
            os.makedirs(JOBS_DIR, exist_ok=True)
            with open(os.path.join(JOBS_DIR, jid + ".approval"), "w", encoding="utf-8") as f:
                json.dump({"decision": "reject", "at": now}, f)
        except Exception:
            pass
        save_job(job)


def _job_verdict(job):
    """pass / reject / abstained / canceled / None。失败任务不给判定，避免继承崩溃前的 pass。"""
    if (job.get("approval") or {}).get("status") in ("rejected", "timeout"):
        return "canceled"
    if job.get("state") == "failed":
        return None
    detail = ((job.get("result") or {}).get("detail") or {})
    v = detail.get("verdict") or job.get("verdict")
    if not v and job.get("state") == "done":
        skipped = {s.get("stage") for s in (job.get("stages") or []) if s.get("status") == "skipped"}
        if {"generate", "score"} & skipped:
            v = "abstained"
    return v


def _attach_job_result(conversation_id, jid, job):
    """任务结束后把一条 assistant 摘要写入会话（不含任何凭据）。"""
    approval = (job.get("approval") or {}).get("status")
    if job.get("state") == "failed":
        err = (job.get("error") or "").strip()
        content = "用例 %s · 运行失败%s" % (
            job.get("case"), "（%s）" % err[:80] if err else "")
        append_message(conversation_id, "assistant", content,
                       job_id=jid, case=job.get("case"), stages=job.get("stages") or [],
                       verdict=None, L1=None, L3=None, status="failed",
                       summary=content, explain=_explain_of(job.get("case")))
        update_conv_state(conversation_id, active_case=job.get("case"),
                          last_job_id=jid, last_verdict="failed")
        return
    if approval in ("rejected", "timeout") or job.get("verdict") == "canceled":
        content = (("用例 %s · 审批超时（未调用模型）" if approval == "timeout"
                    else "用例 %s · 已取消（未批准候选消息，未调用模型）")
                   % job.get("case"))
        append_message(conversation_id, "assistant", content,
                       job_id=jid, case=job.get("case"), stages=[],
                       verdict="canceled", L1=None, L3=None, status="canceled",
                       summary=content, explain=_explain_of(job.get("case")))
        update_conv_state(conversation_id, active_case=job.get("case"),
                          last_job_id=jid, last_verdict="canceled")
        return
    detail = ((job.get("result") or {}).get("detail") or {})
    verdict = _job_verdict(job)
    status = None
    if job.get("state") == "done":
        status = "abstained" if verdict == "abstained" else (
            "rejected" if verdict == "reject" else "generated")
    L1 = detail.get("L1")
    L3 = detail.get("L3")
    if status == "abstained":
        L1 = L3 = None
    elif status:
        if L1 is None or L3 is None:
            rep = _score_of(job.get("case")) or {}
            if L1 is None:
                L1 = rep.get("L1")
            if L3 is None:
                L3 = rep.get("L3_recall")
            if isinstance(L3, str):
                L3 = None
    content = _plain_summary(job, verdict)
    append_message(conversation_id, "assistant", content,
                   job_id=jid, case=job.get("case"),
                   stages=job.get("stages") or [],
                   verdict=verdict, L1=L1, L3=L3, status=status,
                   summary=content, explain=_explain_of(job.get("case")))
    update_conv_state(conversation_id, active_case=job.get("case"),
                      last_job_id=jid, last_verdict=verdict)


# ---------- http ----------
def resolve_static_path(root, path):
    """把 URL 解析为静态文件路径；只允许 web/、data/、results/ 三棵树。

    返回 __denied__ 表示拒绝（路径穿越、settings.json、目录、源码等）。
    """
    clean = urllib.parse.unquote(urllib.parse.urlparse(path).path)
    denied = os.path.join(root, "__denied__")
    if "\x00" in clean:
        return denied
    if not (clean == "/web" or clean.startswith("/web/")
            or clean.startswith("/data/") or clean.startswith("/results/")):
        return denied

    def inside(base, rel):
        target = os.path.realpath(os.path.join(base, rel.lstrip("/")))
        if target != base and not target.startswith(base + os.sep):
            return None
        if os.path.isdir(target):
            return None
        return target

    data_root = os.path.realpath(os.path.join(root, "data"))
    results_root = os.path.realpath(os.path.join(root, "results"))
    if clean.startswith("/data/"):
        rel = clean[len("/data/"):]
        target = inside(data_root, rel)
        if not target or os.path.basename(target).lower() in DENIED_BASENAMES:
            return denied
        if os.path.exists(target):
            return target
        snap = inside(results_root, rel)
        if snap and os.path.exists(snap):
            return snap
        return target
    if clean.startswith("/results/"):
        rel = clean[len("/results/"):]
        target = inside(results_root, rel)
        return target or denied
    # web/ 静态站点：目录映射到 index.html，路径必须在 web/ 内
    web_root = os.path.realpath(os.path.join(root, "web"))
    rel = clean[len("/web/"):] if clean.startswith("/web/") else ""
    target = os.path.realpath(os.path.join(web_root, rel))
    if target != web_root and not target.startswith(web_root + os.sep):
        return denied
    if os.path.isdir(target):
        idx = os.path.join(target, "index.html")
        return idx if os.path.exists(idx) else denied
    return target


class Handler(http.server.SimpleHTTPRequestHandler):
    root = "."

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _data_source(self):
        live = os.path.exists(os.path.join(self.root, "data", "score", "report.json"))
        return "live" if live else "snapshot"

    def translate_path(self, path):
        resolved = resolve_static_path(self.root, path)
        if resolved is None:
            return super().translate_path(path)
        return resolved

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if n <= 0:
            return {}
        if n > 1_000_000:                      # 1MB 上限
            return {}
        ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ct and ct != "application/json":
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def _stream_job(self, jid):
        """SSE：任务 updated 变化时推一帧，终态后关闭；15 分钟上限。"""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        last_sig = None
        last_ping = time.time()
        deadline = time.time() + 1800
        try:
            while time.time() < deadline:
                job = get_job(jid)
                if job is None:
                    self.wfile.write(b'event: error\ndata: {"error":"job_not_found"}\n\n')
                    self.wfile.flush()
                    return
                sig = job.get("updated") or job.get("finished") or 0
                if sig != last_sig:
                    payload = json.dumps(job, ensure_ascii=False)
                    self.wfile.write(("data: %s\n\n" % payload).encode("utf-8"))
                    self.wfile.flush()
                    last_sig = sig
                if job.get("state") in ("done", "failed"):
                    return
                now = time.time()
                if now - last_ping >= 10:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    last_ping = now
                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/data/_source.json":
            return self._json({"source": self._data_source()})
        if path == "/api/health":
            s = load_settings()
            return self._json({"ok": True, "python": sys.version.split()[0],
                               "provider": s["provider"], "model": s["model"],
                               "credential": credential_ok(s),
                               "data_source": self._data_source()})
        if path == "/api/settings":
            s = load_settings()
            return self._json({"provider": s["provider"], "base_url": s["base_url"],
                               "model": s["model"], "temperature": s["temperature"],
                               "key_set": bool(s.get("api_key")) or
                                          credential_ok(s) and s["provider"] != "proxy",
                               "key_masked": mask(s.get("api_key", ""))})
        if path == "/api/models":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            s = load_settings()
            provider = (q.get("provider", [s["provider"]])[0] or s["provider"]).lower()
            base_url = q.get("base_url", [s["base_url"]])[0]
            api_key = q.get("api_key", [s.get("api_key", "")])[0]
            return self._json(fetch_models(provider, base_url, api_key))
        if path == "/api/conversations":
            return self._json(list_convs())
        m = re.match(r"^/api/conversations/([0-9a-f]{8})$", path)
        if m:
            c = _load_conv(m.group(1))
            if not c:
                return self._json({"error": "conversation_not_found"}, 404)
            return self._json(c)
        if path == "/api/runs":
            _expire_stale_jobs()
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                limit = max(1, min(200, int(q.get("limit", ["20"])[0])))
            except ValueError:
                limit = 20
            with _jobs_lock:
                live = {jid: j for jid, j in _jobs.items()}
            merged = {}
            for r in load_runs():
                merged[r["job_id"]] = r
            for jid, j in live.items():          # 内存里更新（运行中/刚完成）
                detail = (j.get("result") or {}).get("detail") or {}
                merged[jid] = {"job_id": jid, "case": j.get("case"),
                               "state": j.get("state"), "verdict": _job_verdict(j),
                               "started": j.get("started"), "finished": j.get("finished"),
                               "seconds": round(j["finished"] - j["started"], 2)
                               if j.get("started") and j.get("finished") else None,
                               "mode": j.get("mode"), "provider": j.get("provider"),
                               "model": j.get("model"),
                               "conversation_id": j.get("conversation_id"),
                               "summary": j.get("summary"),
                               "L1": detail.get("L1"), "L3": detail.get("L3"),
                               "violations": len(detail.get("violations") or [])
                               if detail else None,
                               "stages": j.get("stage_seconds") or {}}
                if j.get("error"):
                    merged[jid]["error"] = j["error"]
            runs = list(merged.values())
            runs.sort(key=lambda x: -(x.get("started") or x.get("finished") or 0))
            return self._json(runs[:limit])
        if path == "/api/metrics":
            _expire_stale_jobs()
            with _jobs_lock:
                live = {jid: j for jid, j in _jobs.items()}
            merged = {r["job_id"]: r for r in load_runs() if r.get("job_id")}
            for jid, j in live.items():
                merged[jid] = {
                    "job_id": jid, "case": j.get("case"), "state": j.get("state"),
                    "verdict": _job_verdict(j), "error": j.get("error"),
                    "finished": j.get("finished"),
                    "seconds": round(j["finished"] - j["started"], 2)
                    if j.get("started") and j.get("finished") else None,
                }
            rows = list(merged.values())
            by_state, by_verdict = {}, {}
            for r in rows:
                by_state[r.get("state")] = by_state.get(r.get("state"), 0) + 1
                v = str(r.get("verdict"))
                by_verdict[v] = by_verdict.get(v, 0) + 1
            secs = sorted(r["seconds"] for r in rows
                          if isinstance(r.get("seconds"), (int, float)))

            def pct(p):
                if not secs:
                    return None
                return secs[min(len(secs) - 1, int(round((len(secs) - 1) * p)))]

            now = time.time()
            last24 = sum(1 for r in rows if (r.get("finished") or 0) >= now - 86400)
            failures = [{"job_id": r.get("job_id"), "case": r.get("case"),
                         "error": r.get("error")}
                        for r in rows if r.get("state") == "failed"][-5:]
            return self._json({"runs_total": len(rows), "by_state": by_state,
                               "by_verdict": by_verdict,
                               "seconds_p50": pct(0.5), "seconds_p95": pct(0.95),
                               "runs_last_24h": last24,
                               "recent_failures": failures})
        if path == "/api/cases":
            return self._json(list_cases())
        if path == "/api/trace/tools":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                limit = max(1, min(200, int(q.get("limit", ["20"])[0])))
            except ValueError:
                limit = 20
            import stage_tools
            return self._json({"rows": stage_tools.recent_trace(
                limit, job=(q.get("job", [""])[0] or None))})
        if path == "/api/skills":
            import skills as skills_lib
            return self._json({"skills": skills_lib.list_skills()})
        if path == "/api/tools":
            import stage_tools
            return self._json({"tools": [{"name": k, "model": v["model"],
                                          "eval_only": v["eval_only"]}
                                         for k, v in stage_tools.TOOLS.items()]})
        if path == "/api/explain":
            cases, source = set(), "none"
            for sub, tag in (("data", "live"), ("results", "snapshot")):
                base = os.path.join(ROOT, sub, "explain")
                if not os.path.isdir(base):
                    continue
                for n in os.listdir(base):
                    m2 = re.match(r"^(6\.7\.1\.\d{1,2})\.json$", n)
                    if m2:
                        cases.add(m2.group(1))
                        if tag == "live":
                            source = "live"
            if source != "live" and cases:
                source = "snapshot"
            return self._json({"cases": sorted(cases), "source": source})
        m = re.match(r"^/api/case/([0-9.]+)$", path)
        if m:
            return self._json({"case": m.group(1), "stages": case_stages(m.group(1))})
        m = re.match(r"^/api/job/([0-9a-f]+)/stream$", path)
        if m:
            return self._stream_job(m.group(1))
        m = re.match(r"^/api/job/([0-9a-f]+)$", path)
        if m:
            jid = m.group(1)
            job = get_job(jid)
            if not job:
                return self._json({"error": "job_not_found"}, 404)
            return self._json(job)
        super().do_GET()

    def _origin_ok(self):
        orig = self.headers.get("Origin")
        if not orig:
            return True
        try:
            host = urllib.parse.urlparse(orig).hostname
        except ValueError:
            return False
        return host in ("127.0.0.1", "localhost")

    def do_POST(self):
        if not self._origin_ok():
            return self._json({"error": "bad_origin"}, 403)
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/tools/([a-z0-9_]+)$", path)
        if m:
            name = m.group(1)
            import stage_tools
            spec = stage_tools.TOOLS.get(name)
            if not spec:
                return self._json({"ok": False, "error": "unknown_tool"}, 404)
            if spec["model"] and not credential_ok(load_settings()):
                return self._json({"ok": False, "error": "no_credential"}, 400)
            args = self._body().get("args")
            try:
                res = stage_tools.call(name, args if isinstance(args, dict) else {})
            except stage_tools.ToolError as e:
                return self._json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                return self._json({"ok": False, "error": "tool_failed",
                                   "message": str(e)[:160]}, 500)
            return self._json({"ok": True, **res})
        if path == "/api/settings":
            body = self._body()
            s = save_settings(body)
            return self._json({"ok": True, "provider": s["provider"], "model": s["model"],
                               "key_set": bool(s.get("api_key"))})
        if path == "/api/test":
            body = self._body()
            s = load_settings()
            for k in ("provider", "base_url", "model"):
                if body.get(k):
                    s[k] = body[k]
            s["base_url"] = norm_base(s.get("base_url", "")) or DEFAULTS[s["provider"]][0]
            if body.get("api_key"):
                s["api_key"] = body["api_key"]
            if not credential_ok(s):
                return self._json({"ok": False, "error": "no_credential"})
            # 自带最小探活：复用 tools/llm.py 的 complete()，不依赖外部脚本参数
            probe = (
                "import sys,json,time;"
                "sys.path.insert(0,'tools');"
                "import llm;"
                "t0=time.time();"
                "txt,stop=llm.complete([{'role':'user','content':'ping'}],max_tokens=1,timeout=15);"
                "print(json.dumps({'ok':True,'latency_ms':int((time.time()-t0)*1000),"
                "'model_seen':getattr(llm,'LAST_MODEL',None),'text':(txt or '')[:40]}))"
            )
            try:
                p = subprocess.run([sys.executable, "-c", probe], cwd=ROOT, env=child_env(s),
                                   capture_output=True, text=True, timeout=25,
                                   encoding="utf-8", errors="replace")
                payload = None
                for line in reversed((p.stdout or "").strip().splitlines()):
                    try:
                        payload = json.loads(line)
                        break
                    except Exception:
                        continue
                if payload is None:
                    return self._json({"ok": False,
                                       "error": (p.stderr or "探测进程无输出").strip()[-200:]})
                if not payload.get("ok"):
                    payload.setdefault("error", "probe_failed")
                return self._json(payload)
            except subprocess.TimeoutExpired:
                return self._json({"ok": False, "error": "探测超时（>25s）"})
            except Exception as e:
                return self._json({"ok": False, "error": str(e)[:200]})
        if path == "/api/chat":
            body = self._body()
            msg = (body.get("message") or "").strip()[:800]
            fallback = {"action": "reply", "say": GUIDE_FALLBACK, "source": "fallback"}
            if not msg:
                return self._json({"action": "reply", "say": "请告诉我你想测哪个场景或用例号。",
                                   "source": "fallback"})
            s = load_settings()
            if not credential_ok(s):
                return self._json(fallback)
            cases = list_cases()
            system = build_guide_system(cases)
            conv_id = (body.get("conversation_id") or "").strip() or None
            mem = (conversation_context(conv_id)
                   if conv_id and _load_conv(conv_id) else {"messages": [], "state": {}})
            user_content = msg
            if mem.get("messages") or mem.get("state"):
                user_content = (msg + "\n\n[会话上下文]\n"
                                + json.dumps(mem, ensure_ascii=False))
                system += ("\n\n你会收到 [会话上下文]：最近对话与会话状态。"
                           "用户可能用“它/这个用例/刚才那个”指代 state.active_case；"
                           "若 action=run 未给出 case，可沿用 active_case。")
            probe = (
                "import sys,json;"
                "sys.path.insert(0,'tools');"
                "import llm;"
                "msg=" + json.dumps(user_content, ensure_ascii=False) + ";"
                "system=" + json.dumps(system, ensure_ascii=False) + ";"
                "txt,stop=llm.complete([{'role':'user','content':msg}],system=system,"
                "temperature=0,max_tokens=400,timeout=60);"
                "data=llm.extract_json(txt);"
                "print(json.dumps({'text':txt,'parsed':data,"
                "'model':getattr(llm,'LAST_MODEL',None)},ensure_ascii=False))"
            )
            try:
                p = subprocess.run([sys.executable, "-c", probe], cwd=ROOT, env=child_env(s),
                                   capture_output=True, text=True, timeout=75,
                                   encoding="utf-8", errors="replace")
                payload = None
                for line in reversed((p.stdout or "").strip().splitlines()):
                    try:
                        payload = json.loads(line)
                        break
                    except Exception:
                        continue
                if not payload:
                    return self._json(fallback)
                parsed = payload.get("parsed") or {}
                valid = {c.get("case") for c in cases}
                cid = (parsed.get("case") or "").strip() or \
                      ((mem.get("state") or {}).get("active_case") or "")
                say = (parsed.get("say") or "").strip()
                if parsed.get("action") == "run":
                    if cid in valid:
                        return self._json({"action": "run", "case": cid,
                                           "say": say or ("好的，处理 %s。" % cid),
                                           "model": payload.get("model")})
                    return self._json(dict(fallback, model=payload.get("model")))
                return self._json({"action": "reply", "say": say or GUIDE_FALLBACK,
                                   "model": payload.get("model"),
                                   "source": "llm" if say else "fallback"})
            except subprocess.TimeoutExpired:
                return self._json(dict(fallback, source="timeout"))
            except Exception as e:
                return self._json(dict(fallback, source="error", error=str(e)[:160]))
        if path == "/api/conversations":
            body = self._body()
            conv = new_conv(body.get("title"))
            return self._json({"id": conv["id"], "title": conv["title"],
                               "created": conv["created"]})
        m = re.match(r"^/api/conversations/([0-9a-f]{8})/messages$", path)
        if m:
            body = self._body()
            role = (body.get("role") or "user").strip()
            if role not in ("user", "assistant"):
                return self._json({"error": "bad_role"}, 400)
            content = (body.get("content") or "").strip()
            if not content:
                return self._json({"error": "empty_content"}, 400)
            msg = append_message(m.group(1), role, content)
            if msg is None:
                return self._json({"error": "conversation_not_found"}, 404)
            return self._json({"ok": True, "at": msg["at"]})
        m = re.match(r"^/api/job/([0-9a-f]+)/approve$", path)
        if m:
            jid = m.group(1)
            with _approval_lock:
                job = get_job(jid)
                if not job:
                    return self._json({"error": "job_not_found"}, 404)
                approval = job.get("approval") or {}
                if job.get("state") != "awaiting_approval" or approval.get("status") != "pending":
                    return self._json({"error": "not_awaiting_approval"}, 409)
                body = self._body()
                decision = (body.get("decision") or "").strip()
                if decision not in ("approve", "reject"):
                    return self._json({"error": "bad_decision"}, 400)
                options = norm_run_options(body.get("options") or job.get("options"))
                try:
                    os.makedirs(JOBS_DIR, exist_ok=True)
                    dest = os.path.join(JOBS_DIR, jid + ".approval")
                    tmp = dest + "." + uuid.uuid4().hex + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump({"decision": decision, "options": options,
                                   "at": time.time()}, f)
                    os.replace(tmp, dest)
                except Exception as e:
                    return self._json({"error": "write_failed", "message": str(e)[:120]}, 500)
                with _jobs_lock:
                    live = _jobs.get(jid)
                    if live is not None:
                        live.setdefault("approval", {})["status"] = (
                            "approved" if decision == "approve" else "rejected")
                        live["options"] = options
                        save_job(live)
            return self._json({"ok": True, "options": options})
        if path == "/api/run":
            body = self._body()
            cid = (body.get("case") or "").strip()
            if not cid:
                return self._json({"error": "missing_case"}, 400)
            if not re.match(r"^6\.7\.1\.\d{1,2}$", cid) or cid not in {c.get("case") for c in list_cases()}:
                return self._json({"error": "unknown_case"}, 400)
            s = load_settings()
            if not credential_ok(s):
                return self._json({"error": "no_credential"}, 400)
            conv_id = (body.get("conversation_id") or "").strip() or None
            if conv_id and _load_conv(conv_id) is None:
                return self._json({"error": "conversation_not_found"}, 404)
            opts = norm_run_options(body.get("options"))
            if body.get("dry_run"):
                opts["engine"] = "pipeline"      # 快速模式不调用模型
            if body.get("hitl") and opts["engine"] == "agent":
                return self._json({"error": "hitl_not_supported_with_agent"}, 400)
            # 槽位检查与任务入表必须在同一把锁内，否则并发请求会突破并发上限
            _expire_stale_jobs()
            with _slot_lock:
                with _jobs_lock:
                    active = [j for j in _jobs.values()
                              if j.get("state") in ("queued", "running", "awaiting_approval")]
                    if conv_id and any(j.get("conversation_id") == conv_id for j in active):
                        return self._json({"error": "run_in_progress"}, 409)
                    if len(active) >= MAX_CONCURRENT_RUNS:
                        return self._json({"error": "too_many_runs"}, 429)
                instruction = (body.get("instruction") or "").strip()
                if conv_id and instruction:
                    append_message(conv_id, "user", instruction)
                jid = start_job(cid, bool(body.get("dry_run")), conv_id,
                                hitl=bool(body.get("hitl")), options=opts)
            return self._json({"job_id": jid, "options": opts})
        return self._json({"error": "not_found"}, 404)

    def do_PATCH(self):
        if not self._origin_ok():
            return self._json({"error": "bad_origin"}, 403)
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/conversations/([0-9a-f]{8})$", path)
        if not m:
            return self._json({"error": "not_found"}, 404)
        body = self._body()
        title = (body.get("title") or "").strip()
        with _conv_lock:
            conv = _load_conv(m.group(1))
            if conv is None:
                return self._json({"error": "conversation_not_found"}, 404)
            if title:
                conv["title"] = title[:40]
                _save_conv(conv)
        return self._json({"ok": True})

    def do_DELETE(self):
        if not self._origin_ok():
            return self._json({"error": "bad_origin"}, 403)
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/conversations/([0-9a-f]{8})$", path)
        if not m:
            return self._json({"error": "not_found"}, 404)
        cid = m.group(1)
        p = _conv_path(cid)
        with _conv_lock:
            if not os.path.exists(p):
                return self._json({"error": "conversation_not_found"}, 404)
            try:
                os.remove(p)
            except Exception as e:
                return self._json({"error": str(e)}, 500)
        return self._json({"ok": True})

    def log_message(self, fmt, *args):
        msg = fmt % args
        # 日志脱敏：URL 查询里的 key/token 一律替换
        msg = re.sub(r"(?i)(api_key|key|token|authorization|session)=([^&\s]+)", r"\1=***", msg)
        print("%s - %s" % (self.address_string(), msg))


def main():
    ap = argparse.ArgumentParser(description="Spec2Test 本地服务")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    os.chdir(ROOT)
    if not os.path.isdir(os.path.join(ROOT, "data")):
        print("[warn] 未找到 data/：仅能使用 results/ 快照")

    Handler.root = ROOT
    secret_store.migrate()
    load_jobs()
    url = "http://%s:%d/api/health" % (args.host, args.port)
    handler = functools.partial(Handler, directory=ROOT)

    socketserver.TCPServer.allow_reuse_address = True
    try:
        # 多线程：模型调用/长任务在后台进行时，/api/job 等轮询不能被阻塞
        httpd = socketserver.ThreadingTCPServer((args.host, args.port), handler)
        httpd.daemon_threads = True
    except OSError as e:
        print("端口 %d 已被占用（%s）。已在运行，请打开 %s" % (args.port, e, url))
        return

    print("serving %s at %s  [data source: %s]  (Ctrl+C 停止)"
          % (ROOT, url, Handler._data_source(Handler)))
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        with httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
