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
