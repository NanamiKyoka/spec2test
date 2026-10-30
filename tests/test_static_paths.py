import os

import serve


def denied(path):
    return serve.resolve_static_path(serve.ROOT, path).endswith("__denied__")


def test_allows_web_and_results():
    assert serve.resolve_static_path(serve.ROOT, "/web/").endswith("index.html")
    got = serve.resolve_static_path(serve.ROOT, "/results/score/report.json")
    want = os.path.realpath(os.path.join(serve.ROOT, "results", "score", "report.json"))
    assert os.path.realpath(got) == want


def test_denies_settings_every_where():
    for url in (
        "/data/settings.json",
        "/data/./settings.json",
        "/data/%2e%2e/data/settings.json",
        "/data/../data/settings.json",
    ):
        assert denied(url), url


def test_denies_source_git_and_directories():
    for url in ("/scripts/serve.py", "/.git/config", "/README.md", "/data/", "/results/"):
        assert denied(url), url


def test_denies_web_traversal():
    assert denied("/web/../scripts/serve.py")
    assert denied("/web/%2e%2e/scripts/serve.py")


def test_data_falls_back_to_results(tmp_path):
    snap = tmp_path / "results" / "score"
    snap.mkdir(parents=True)
    (snap / "report.json").write_text("[]", encoding="utf-8")
    got = serve.resolve_static_path(str(tmp_path), "/data/score/report.json")
    assert os.path.realpath(got) == os.path.realpath(snap / "report.json")
