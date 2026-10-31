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


def tp_ref_map(ir):
    """TP index -> 引用它的步骤下标。兼容 tp_ref 列表与旧 tp 字符串。"""
    refs = {}
    for i, s in enumerate(ir.get("steps") or []):
        raw = s.get("tp_ref")
        vals = raw if isinstance(raw, list) else [s.get("tp")]
        for v in vals:
            for part in re.split(r"[,/\s]+", str(v or "").strip()):
                if part.isdigit():
                    refs.setdefault(int(part), []).append(i)
    return refs


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

        # D2 抹掉某个 TP 的全部引用（只抹一条可能仍被其他步骤覆盖，不构成缺陷）
        refs = tp_ref_map(ir)
        if refs:
            tp_idx = next(iter(refs))
            d = copy.deepcopy(ir)
            for i in refs[tp_idx]:
                d["steps"][i]["tp"] = "-"
                if "tp_ref" in d["steps"][i]:
                    d["steps"][i]["tp_ref"] = []
            d["_expected_rule"] = "R3"
            d["_defect"] = f"D2 clear all refs to tp {tp_idx}"
            json.dump(d, open(os.path.join(out_dir, f"{cid}_D2.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
            idx.append((f"{cid}_D2", "R3"))
            n += 1

        # D3 删除所有引用该 TP 的步骤（删一条可能仍被其他步骤覆盖，不构成缺陷）
        if refs:
            tp_idx = next(iter(refs))
            drop = set(refs[tp_idx])
            d = copy.deepcopy(ir)
            d["steps"] = [s for j, s in enumerate(d["steps"]) if j not in drop]
            d["_expected_rule"] = "R3"
            d["_defect"] = f"D3 drop all steps referencing tp {tp_idx}"
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
