"""LLM 通道抽象：proxy / openai / anthropic，同一上层接口。

    complete(messages, temperature=0, max_tokens=8192, system=None) -> (text, stop_reason)

环境变量
  LLM_PROVIDER       proxy(默认) | openai | anthropic
  LLM_MODEL          模型名（随通道解释）
  LLM_BASE_URL       覆盖默认地址
  LLM_SESSION        proxy 通道的 session id（默认每进程一个 uuid）
  LLM_API_KEY        openai 通道的 key
  ANTHROPIC_API_KEY  anthropic 通道的 key（proxy 通道下作为 x-api-key 一并发送）

统一行为：过滤 thinking 块、剥 ```json 围栏、5xx 重试 2 次。
"""
import hashlib
import json
import os
import re
import time
import uuid

PROVIDER = os.environ.get("LLM_PROVIDER", "proxy").lower()
TEMPERATURE = 0
MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "16384"))
SESSION = os.environ.get("LLM_SESSION") or str(uuid.uuid4())

DEFAULTS = {
    "proxy": ("http://127.0.0.1:15721", "claude-sonnet-4-6[1M]"),
    "openai": ("https://api.deepseek.com/v1", "deepseek-chat"),
    "anthropic": ("https://api.anthropic.com", "claude-sonnet-4-6"),
}
BASE = os.environ.get("LLM_BASE_URL") or DEFAULTS.get(PROVIDER, DEFAULTS["proxy"])[0]
MODEL = os.environ.get("LLM_MODEL") or DEFAULTS.get(PROVIDER, DEFAULTS["proxy"])[1]

UA = "claude-cli/1.0 (external)"
LAST_MODEL = None

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "cache", "llm")


def _cache_key(temperature, max_tokens, system, messages):
    payload = {
        "provider": PROVIDER,
        "base": BASE,
        "model": MODEL,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "system": system or "",
        "messages": messages,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_read(key):
    try:
        with open(os.path.join(CACHE_DIR, key + ".json"), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) and "text" in data else None
    except Exception:
        return None


def _cache_write(key, text, stop_reason):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = os.path.join(CACHE_DIR, key + ".json")
        tmp = "%s.%s.tmp" % (path, uuid.uuid4().hex[:8])
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"text": text, "stop_reason": stop_reason,
                       "model": LAST_MODEL, "created": int(time.time())},
                      f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def _post(url, body, headers, timeout, retries=2):
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    last = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
                global LAST_MODEL
                LAST_MODEL = data.get("model")
                return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code < 500 or attempt == retries:
                raise
            time.sleep(3 * (attempt + 1))
        except Exception as e:
            last = e
            if attempt == retries:
                raise
            time.sleep(3 * (attempt + 1))
    raise last


def complete(messages, temperature=None, max_tokens=None, system=None, timeout=300):
    global LAST_MODEL
    temperature = TEMPERATURE if temperature is None else temperature
    max_tokens = MAX_TOKENS if max_tokens is None else max_tokens
    no_cache = os.environ.get("LLM_NO_CACHE") == "1"
    cache_key = None if no_cache else _cache_key(temperature, max_tokens, system, messages)
    if cache_key:
        hit = _cache_read(cache_key)
        if hit is not None:
            LAST_MODEL = hit.get("model") or MODEL
            return hit.get("text") or "", hit.get("stop_reason")

    if PROVIDER in ("proxy", "anthropic"):
        body = {"model": MODEL, "max_tokens": max_tokens, "temperature": temperature,
                "messages": messages}
        if system:
            body["system"] = system
        headers = {"content-type": "application/json",
                   "anthropic-version": "2023-06-01",
                   "user-agent": UA}
        key = os.environ.get("ANTHROPIC_API_KEY")
        if PROVIDER == "anthropic" and not key:
            raise RuntimeError("MISSING_ANTHROPIC_API_KEY")
        if key:
            headers["x-api-key"] = key
        if PROVIDER == "proxy":
            headers["x-opencode-session"] = SESSION
        data = _post(BASE.rstrip("/") + "/v1/messages", body, headers, timeout)
        text = "".join(b.get("text", "") for b in (data.get("content") or [])
                       if b.get("type") == "text")
        stop = data.get("stop_reason")
        if cache_key and text:
            _cache_write(cache_key, text, stop)
        return text, stop

    key = os.environ.get("LLM_API_KEY")
    if not key:
        raise RuntimeError("MISSING_OPENAI_API_KEY")
    msgs = ([{"role": "system", "content": system}] if system else []) + list(messages)
    body = {"model": MODEL, "max_tokens": max_tokens, "temperature": temperature,
            "messages": msgs}
    headers = {"content-type": "application/json",
               "authorization": "Bearer " + key, "user-agent": UA}
    data = _post(BASE.rstrip("/") + "/chat/completions", body, headers, timeout)
    choice = (data.get("choices") or [{}])[0]
    text = choice.get("message", {}).get("content") or ""
    stop = choice.get("finish_reason")
    if cache_key and text:
        _cache_write(cache_key, text, stop)
    return text, stop


def extract_json(text):
    if not text:
        return None
    t = re.sub(r"```(?:json)?", "", text).replace("```", "")
    start = t.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(t)):
        if t[i] == "{":
            depth += 1
        elif t[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except Exception:
                    return None
    return None
