"""从金标 IR 派生错误用例（缺陷注入），带期望规则。"""
import copy
import json
import os
import re
import sys

FAKE_MSG = "RRCDefinitelyNotReal"


def pick_ie(ir):
    """只从已覆盖的 NR 消息里挑，否则 R2 会跳过。"""
    for mt in ir.get("messages") or []:
        if not (mt.get("message") or "").startswith("SIB"):
            continue
        for ie in mt.get("ies") or []:
            if ie.get("name"):
                return mt, ie
    return None, None


def main(gold_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    idx = []
    for name in sorted(os.listdir(gold_dir)):
        if not name.endswith(".json"):
            continue
        ir = json.load(open(os.path.join(gold_dir, name), encoding="utf-8"))
        cid = ir.get("case_id", name[:-5])

        # D1 改 IE 名
        mt, ie = pick_ie(ir)
        if ie:
            d = copy.deepcopy(ir)
            for m2 in d["messages"]:
                for i2 in m2["ies"]:
                    if i2["name"] == ie["name"]:
                        i2["name"] = ie["name"] + "-zz9"
                        break
            d["_expected_rule"] = "R2"
            d["_defect"] = f"D1 rename {ie['name']}"
            json.dump(d, open(os.path.join(out_dir, f"{cid}_D1.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            idx.append((f"{cid}_D1", "R2"))
            n += 1

        # D2 抹掉某个 TP 引用
        k = next((i for i, s in enumerate(ir.get("steps") or [])
                  if str(s.get("tp") or "").strip().isdigit()), None)
        if k is not None:
            d = copy.deepcopy(ir)
            d["steps"][k]["tp"] = "-"
            d["_expected_rule"] = "R3"
            d["_defect"] = "D2 clear tp reference"
            json.dump(d, open(os.path.join(out_dir, f"{cid}_D2.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            idx.append((f"{cid}_D2", "R3"))
            n += 1

        # D3 删除唯一引用该 TP 的步骤
        us = [i for i, s in enumerate(ir.get("steps") or [])
              if str(s.get("tp") or "").strip().isdigit()]
        if us:
            d = copy.deepcopy(ir)
            d["steps"] = [s for j, s in enumerate(d["steps"]) if j != us[0]]
            d["_expected_rule"] = "R3"
            d["_defect"] = "D3 drop one U->S step"
            json.dump(d, open(os.path.join(out_dir, f"{cid}_D3.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            idx.append((f"{cid}_D3", "R3"))
            n += 1

        # D4 塞不存在的消息
        if ir.get("steps"):
            d = copy.deepcopy(ir)
            d["steps"].append({"st": "99", "procedure": "injected", "direction": "S->U",
                               "message": FAKE_MSG, "tp": "-", "verdict": "-"})
            d["_expected_rule"] = "R1"
            d["_defect"] = "D4 insert nonexistent message"
            json.dump(d, open(os.path.join(out_dir, f"{cid}_D4.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            idx.append((f"{cid}_D4", "R1"))
            n += 1

    json.dump(idx, open(os.path.join(out_dir, "_index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"defects={n}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
