import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

import serve

NEEDS_DATA = pytest.mark.skipif(
    not (pathlib.Path(serve.ROOT) / "data" / "benchmark" / "v0").is_dir(),
    reason="需要本地 data/ 基准，仓库未入库",
)


def _request(url, data=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def _wait_state(base, jid, states, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, job = _request(base + "/api/job/" + jid)
        if code == 200 and job.get("state") in states:
            return job
        time.sleep(0.2)
    raise AssertionError("job %s 未在 %ss 内进入 %s" % (jid, timeout, states))


def test_approval_event_toggles_state():
    job = {"id": "j1", "state": "running", "log": [], "stages": []}
    serve._apply_job_event(
        job,
        {"stage": "approval", "status": "pending", "summary": "等待确认",
         "detail": {"candidates": ["SIB1", "SIB19"]}},
    )
    assert job["state"] == "awaiting_approval"
    assert job["approval"] == {"status": "pending", "candidates": ["SIB1", "SIB19"]}

    serve._apply_job_event(
        job,
        {"stage": "approval", "status": "approved", "summary": "已批准",
         "detail": {"candidates": ["SIB1", "SIB19"]}},
    )
    assert job["state"] == "running"
    assert job["approval"]["status"] == "approved"


def test_awaiting_approval_marked_interrupted_on_restart(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    (jobs / "wait.json").write_text(
        json.dumps({"id": "wait", "state": "awaiting_approval",
                    "approval": {"status": "pending"}, "log": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(serve, "JOBS_DIR", str(jobs))
    serve._jobs.clear()
    serve.load_jobs()
    assert serve._jobs["wait"]["state"] == "failed"
    assert serve._jobs["wait"]["error"] == "restarted"


def test_get_job_returns_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "JOBS_DIR", str(tmp_path / "jobs"))
    serve._jobs.clear()
    serve._jobs["snap"] = {"id": "snap", "state": "running", "log": [], "stages": []}
    got = serve.get_job("snap")
    got["state"] = "done"
    got["log"].append({"msg": "mutated"})
    assert serve._jobs["snap"]["state"] == "running"
    assert serve._jobs["snap"]["log"] == []


@pytest.fixture(scope="module")
def base():
    port = 8766
    proc = subprocess.Popen(
        [sys.executable, "scripts/serve.py", "--port", str(port), "--no-browser"],
        cwd=serve.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = "http://127.0.0.1:%d" % port
    try:
        for _ in range(80):
            try:
                if _request(url + "/api/health")[0] == 200:
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


def _start(base):
    code, body = _request(base + "/api/run",
                          {"case": "6.7.1.3", "dry_run": True, "hitl": True})
    assert code == 200
    return body["job_id"]


@NEEDS_DATA
def test_approve_resumes_job(base):
    jid = _start(base)
    job = _wait_state(base, jid, ("awaiting_approval",))
    assert job["approval"]["status"] == "pending"
    assert job["approval"]["candidates"]

    code, body = _request(base + "/api/job/%s/approve" % jid, {"decision": "approve"})
    assert code == 200 and body["ok"] is True

    # 重复审批必须被拒：第一次提交后 status 已不是 pending
    code, body = _request(base + "/api/job/%s/approve" % jid, {"decision": "reject"})
    assert code == 409

    done = _wait_state(base, jid, ("done", "failed"))
    assert done["state"] == "done"
    assert done["approval"]["status"] == "approved"
    assert done["result"]["detail"]["verdict"] in ("pass", "reject")

    # 已终态的任务不能再审批
    code, _ = _request(base + "/api/job/%s/approve" % jid, {"decision": "approve"})
    assert code == 409


@NEEDS_DATA
def test_reject_skips_model(base):
    jid = _start(base)
    _wait_state(base, jid, ("awaiting_approval",))
    code, body = _request(base + "/api/job/%s/approve" % jid, {"decision": "reject"})
    assert code == 200 and body["ok"] is True

    done = _wait_state(base, jid, ("done", "failed"))
    assert done["state"] == "done"
    assert done["verdict"] == "canceled"
    assert done["result"]["status"] == "skipped"
    assert done["approval"]["status"] == "rejected"


def test_approve_unknown_job_404(base):
    code, _ = _request(base + "/api/job/deadbeef/approve", {"decision": "approve"})
    assert code == 404


@NEEDS_DATA
def test_options_flow_through_run_and_approval(base):
    code, body = _request(base + "/api/run", {
        "case": "6.7.1.3", "dry_run": True, "hitl": True,
        "options": {"mode": "steps", "repairs": 0, "strictness": "r1_only"},
    })
    assert code == 200
    assert body["options"] == {"messages": [], "mode": "steps", "repairs": 0,
                               "strictness": "r1_only", "engine": "pipeline",
                               "skills": [], "mcpTools": None}
    jid = body["job_id"]
    job = _wait_state(base, jid, ("awaiting_approval",))
    assert job["options"]["mode"] == "steps"

    picked = job["approval"]["candidates"][:1]
    code, body = _request(base + "/api/job/%s/approve" % jid, {
        "decision": "approve",
        "options": {"mode": "steps", "repairs": 0, "strictness": "r1_only",
                    "messages": picked},
    })
    assert code == 200 and body["options"]["messages"] == picked

    done = _wait_state(base, jid, ("done", "failed"))
    assert done["state"] == "done"
    # 只生成步骤（dry-run 下走桩生成）时没有字段可召回，L3 记为空而不是 0
    assert done["result"]["detail"]["L3"] is None
