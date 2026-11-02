"""真实错误集快照：范围内必须全检出，范围外漏检必须显式保留。"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "results" / "blindset" / "report.json"


def test_blindset_snapshot():
    data = json.loads(REPORT.read_text(encoding="utf-8"))
    cur = data["summary"]["current"]
    old = data["summary"]["legacy"]
    assert cur["in_scope"]["detected"] == cur["in_scope"]["total"] > 0
    assert cur["out_of_scope"]["detected"] == 0
    assert old["detected"] < cur["detected"]
    assert any(not x["current_detected"] for x in data["core"]
               if not x["in_scope"])
