import threading

import serve


def test_concurrent_append_no_loss(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "CONV_DIR", str(tmp_path / "conv"))
    conv = serve.new_conv("race")

    threads = [
        threading.Thread(target=serve.append_message, args=(conv["id"], "user", "m%d" % i))
        for i in range(20)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    saved = serve._load_conv(conv["id"])
    assert len(saved["messages"]) == 20
    assert {m["content"] for m in saved["messages"]} == {"m%d" % i for i in range(20)}


def test_conversation_context_carries_state(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "CONV_DIR", str(tmp_path / "conv"))
    conv = serve.new_conv("memory")
    serve.append_message(conv["id"], "user", "再跑一次")
    serve.append_message(conv["id"], "assistant", "用例 6.7.1.3 · 通过",
                         case="6.7.1.3", job_id="abc", verdict="pass")
    serve.update_conv_state(conv["id"], active_case="6.7.1.3",
                            last_job_id="abc", last_verdict="pass")
    ctx = serve.conversation_context(conv["id"])
    assert ctx["state"]["active_case"] == "6.7.1.3"
    assert ctx["state"]["last_verdict"] == "pass"
    assert [m["role"] for m in ctx["messages"]] == ["user", "assistant"]


def test_conversation_context_derives_state(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "CONV_DIR", str(tmp_path / "conv"))
    conv = serve.new_conv("derive")
    serve.append_message(conv["id"], "assistant", "用例 6.7.1.12 · 弃权",
                         case="6.7.1.12", verdict="abstained")
    ctx = serve.conversation_context(conv["id"])
    assert ctx["state"]["active_case"] == "6.7.1.12"
    assert ctx["state"]["last_verdict"] == "abstained"
