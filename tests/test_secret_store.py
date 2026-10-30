import json
import os
import sys

import pytest

import secret_store


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI only on Windows")
def test_dpapi_roundtrip(tmp_path):
    p = tmp_path / "secret.bin"
    assert secret_store.store_key("sk-test-123", str(p)) == "dpapi"
    assert p.read_bytes().startswith(secret_store.HEADER)
    assert secret_store.load_key(str(p), str(tmp_path / "settings.json")) == "sk-test-123"


def test_no_plaintext_when_crypto_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(secret_store, "_dpapi", lambda data, protect: (_ for _ in ()).throw(OSError("no")))
    monkeypatch.setitem(sys.modules, "keyring", None)
    p = tmp_path / "secret.bin"
    assert secret_store.store_key("sk-test", str(p)) == ""
    assert not p.exists()


def test_migrate_requires_secure_store(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"provider": "proxy", "api_key": "sk-plain"}), encoding="utf-8")
    monkeypatch.setattr(secret_store, "_dpapi", lambda data, protect: (_ for _ in ()).throw(OSError("no")))
    monkeypatch.setitem(sys.modules, "keyring", None)
    assert secret_store.migrate(str(tmp_path / "secret.bin"), str(settings)) is False
    assert json.loads(settings.read_text(encoding="utf-8"))["api_key"] == "sk-plain"


def test_load_key_env_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("LLM_API_KEY", "sk-env")
    assert secret_store.load_key(str(tmp_path / "none.bin"), str(tmp_path / "none.json")) == "sk-env"


def test_load_key_legacy_settings(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"api_key": "sk-legacy"}), encoding="utf-8")
    assert secret_store.load_key(str(tmp_path / "none.bin"), str(settings)) == "sk-legacy"
