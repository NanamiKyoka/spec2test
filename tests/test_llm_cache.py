import json
import pathlib

import pytest

import llm


def _fake(payload, calls):
    def _post(url, body, headers, timeout, retries=2):
        calls.append(body)
        if isinstance(payload, Exception):
            raise payload
        data = payload(len(calls)) if callable(payload) else payload
        llm.LAST_MODEL = data.get("model")
        return data
    return _post


PROXY_OK = {"model": "test-model", "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "hello"}]}


@pytest.fixture(autouse=True)
def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(llm, "PROVIDER", "proxy")
    monkeypatch.setattr(llm, "MODEL", "test-model")
    monkeypatch.delenv("LLM_NO_CACHE", raising=False)


def test_second_call_hits_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake(PROXY_OK, calls))
    messages = [{"role": "user", "content": "cache me"}]
    assert llm.complete(messages) == ("hello", "end_turn")
    assert llm.complete(messages) == ("hello", "end_turn")
    assert len(calls) == 1


def test_no_cache_env_bypasses(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake(PROXY_OK, calls))
    monkeypatch.setenv("LLM_NO_CACHE", "1")
    messages = [{"role": "user", "content": "bypass"}]
    llm.complete(messages)
    llm.complete(messages)
    assert len(calls) == 2


def test_errors_are_not_cached(monkeypatch):
    calls = []
    state = {"fail": True}

    def _post(url, body, headers, timeout, retries=2):
        calls.append(body)
        if state["fail"]:
            raise RuntimeError("boom")
        llm.LAST_MODEL = PROXY_OK.get("model")
        return PROXY_OK

    monkeypatch.setattr(llm, "_post", _post)
    messages = [{"role": "user", "content": "retry me"}]
    with pytest.raises(RuntimeError):
        llm.complete(messages)
    state["fail"] = False
    assert llm.complete(messages) == ("hello", "end_turn")
    assert len(calls) == 2


def test_different_system_is_different_key(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake(PROXY_OK, calls))
    messages = [{"role": "user", "content": "same"}]
    llm.complete(messages, system="A")
    llm.complete(messages, system="B")
    assert len(calls) == 2


def test_cache_file_payload(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake(PROXY_OK, calls))
    llm.complete([{"role": "user", "content": "payload"}])
    files = list(pathlib.Path(llm.CACHE_DIR).glob("*.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))
    assert data["text"] == "hello"
    assert data["stop_reason"] == "end_turn"
    assert data["model"] == "test-model"
    assert isinstance(data["created"], int)


def test_different_max_tokens_is_different_key(monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "_post", _fake(PROXY_OK, calls))
    messages = [{"role": "user", "content": "max tokens"}]
    llm.complete(messages, max_tokens=1)
    llm.complete(messages, max_tokens=100)
    assert len(calls) == 2
