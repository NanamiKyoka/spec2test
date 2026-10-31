"""缺陷注入回归：每条注入必须真的触发它标注的规则。

D2/D3 曾只抹掉/删除同一 TP 的重复引用之一，TP 仍被覆盖，属于无效注入。
"""
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import inject  # noqa: E402
import validate  # noqa: E402

GOLD = ROOT / "data" / "gold_ir"
SYMS = ROOT / "data" / "symbols" / "rrc_symbols.json"


pytestmark = pytest.mark.skipif(
    not GOLD.is_dir() or not SYMS.is_file(),
    reason="需要本地 data/gold_ir 与符号表，仓库未入库",
)


def test_every_injected_defect_hits_expected_rule(tmp_path):
    out = tmp_path / "defects"
    inject.main(str(GOLD), str(out))
    syms = json.loads(SYMS.read_text(encoding="utf-8"))
    files = sorted(out.glob("*_D*.json"))
    assert files, "没有生成任何缺陷样本"
    missed = []
    for f in files:
        ir = json.loads(f.read_text(encoding="utf-8"))
        expected = ir.get("_expected_rule")
        rules = {v["rule"] for v in validate.validate(ir, syms)}
        if expected not in rules:
            missed.append((f.name, expected, sorted(rules)))
    assert not missed, f"未触发期望规则: {missed}"
