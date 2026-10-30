import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

import serve


def _code(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


@pytest.fixture(scope="module")
def base():
    port = 8765
    proc = subprocess.Popen(
        [sys.executable, "scripts/serve.py", "--port", str(port), "--no-browser"],
        cwd=serve.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = "http://127.0.0.1:%d" % port
    try:
        for _ in range(60):
            try:
                if _code(url + "/api/health") == 200:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_health(base):
    assert _code(base + "/api/health") == 200


def test_snapshot_is_served(base):
    assert _code(base + "/results/score/report.json") == 200


def test_secrets_and_source_blocked(base):
    assert _code(base + "/data/settings.json") == 404
    assert _code(base + "/data/%2e%2e/data/settings.json") == 404
    assert _code(base + "/scripts/serve.py") == 404
    assert _code(base + "/.git/config") == 404


def test_unknown_case_rejected(base):
    body = json.dumps({"case": "evil"}).encode()
    assert _code(base + "/api/run", body, {"Content-Type": "application/json"}) == 400


def test_bad_origin_rejected(base):
    body = json.dumps({"case": "6.7.1.12"}).encode()
    headers = {"Content-Type": "application/json", "Origin": "https://evil.example"}
    assert _code(base + "/api/run", body, headers) == 403
