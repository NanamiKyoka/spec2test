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
