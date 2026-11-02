import json

import serve


def test_job_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "JOBS_DIR", str(tmp_path / "jobs"))
    serve._jobs.clear()
    serve.save_job({"id": "abc", "state": "done", "case": "6.7.1.3"})
    assert (tmp_path / "jobs" / "abc.json").exists()

    serve._jobs.clear()
    serve.load_jobs()
    assert serve._jobs["abc"]["state"] == "done"
    assert serve._jobs["abc"]["case"] == "6.7.1.3"


def test_running_marked_interrupted(tmp_path, monkeypatch):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    (jobs / "run1.json").write_text(
        json.dumps({"id": "run1", "state": "running", "log": []}), encoding="utf-8"
    )
    monkeypatch.setattr(serve, "JOBS_DIR", str(jobs))
    serve._jobs.clear()
    serve.load_jobs()
    assert serve._jobs["run1"]["state"] == "failed"
    assert any("服务重启" in line.get("msg", "") for line in serve._jobs["run1"]["log"])


def test_plain_summary_follows_verdict(monkeypatch):
    """explain 的 headline 只在判定一致时复用；拒收不能显示“用例通过”。"""
    monkeypatch.setattr(serve, "_explain_of", lambda cid: {
        "headline": "用例通过：12步流程覆盖三种 cellBarredNTN 场景",
        "numbers": {"verdict": "pass"},
    })
    monkeypatch.setattr(serve, "_case_title", lambda cid: "空闲态小区禁止")
    job = {"case": "6.7.1.3", "state": "done"}
    assert serve._plain_summary(job, "reject") == "已拒收：空闲态小区禁止"
    assert serve._plain_summary(job, "pass").startswith("用例通过")


def test_failed_job_has_no_verdict(monkeypatch):
    """失败任务不继承崩溃前 emit 的 pass，摘要也不能是“通过”。"""
    monkeypatch.setattr(serve, "_explain_of", lambda cid: {
        "headline": "用例通过：…", "numbers": {"verdict": "pass"}})
    monkeypatch.setattr(serve, "_case_title", lambda cid: "标题")
    job = {"case": "6.7.1.3", "state": "failed", "error": "process_exit_1",
           "approval": None, "result": {"detail": {"verdict": "pass"}}}
    assert serve._job_verdict(job) is None
    summary = serve._plain_summary(job, serve._job_verdict(job))
    assert summary == "运行失败：标题"
    assert "通过" not in summary


def test_failed_job_message_is_failure(monkeypatch):
    captured = {}

    def fake_append(conversation_id, role, content, **kw):
        captured.update(dict(kw, role=role, content=content))

    monkeypatch.setattr(serve, "append_message", fake_append)
    monkeypatch.setattr(serve, "update_conv_state", lambda cid, **kw: None)
    monkeypatch.setattr(serve, "_explain_of", lambda cid: {
        "headline": "用例通过：…", "numbers": {"verdict": "pass"}})
    serve._attach_job_result(
        "abcd1234", "j1",
        {"case": "6.7.1.3", "state": "failed", "error": "process_exit_1", "stages": []},
    )
    assert captured["status"] == "failed"
    assert captured["verdict"] is None
    assert "运行失败" in captured["content"]
    assert "通过" not in captured["content"]
