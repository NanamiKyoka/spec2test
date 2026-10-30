"""把 gold 步骤与 IE 表组装成 IR，供校验器误报检查与缺陷注入使用。"""
import json
import os
import re
import sys


def main(steps_dir, ie_dir, out_dir, tp_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(steps_dir)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        cid = name[:-5]
        steps = json.load(open(os.path.join(steps_dir, name), encoding="utf-8"))["steps"]
        msgs_raw = []
        p = os.path.join(ie_dir, name)
        if os.path.exists(p):
            msgs_raw = json.load(open(p, encoding="utf-8"))["message_tables"]
        messages = [{
            "step": m.get("step"),
            "message": m.get("message"),
            "ies": [{"name": i["name"], "value": i.get("value", "")} for i in m.get("leaf_ies", [])],
        } for m in msgs_raw]
        tp = []
        if tp_dir:
            tp_path = os.path.join(tp_dir, name)
            if os.path.exists(tp_path):
                tp = json.load(open(tp_path, encoding="utf-8")).get("tp", [])
        ir = {"case_id": cid, "tp": tp, "steps": steps, "messages": messages, "source": "gold"}
        json.dump(ir, open(os.path.join(out_dir, name), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        n += 1
    print(f"gold_ir={n}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
