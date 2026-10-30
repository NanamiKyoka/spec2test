"""诊断探针：复跑 8 例，记录 stop_reason / 后端模型 / 解析结果 / 缺失字段。只诊断，不改生成逻辑。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm
from generate import SYSTEM

CTX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "ctx")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "diag")


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for name in sorted(os.listdir(CTX)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        ctx = json.load(open(os.path.join(CTX, name), encoding="utf-8"))
        rec = {"case": ctx["case_id"], "status": "ok"}
        user = json.dumps({k: ctx[k] for k in
                           ("test_purpose", "conformance_requirements", "pre_test_conditions")},
                          ensure_ascii=False)
        try:
            text, stop = llm.complete([{"role": "user", "content": user}], system=SYSTEM)
        except Exception as e:
            rec.update(status=f"call_failed:{type(e).__name__}", error=str(e)[:160],
                       stop=None, backend=llm.LAST_MODEL, text_len=0)
            rows.append(rec)
            continue
        ir = llm.extract_json(text)
        rec.update(stop=stop, backend=llm.LAST_MODEL, text_len=len(text),
                   parse_ok=isinstance(ir, dict))
        if isinstance(ir, dict):
            st = ir.get("steps") or []
            rec.update(steps=len(st),
                       no_actor=sum(1 for s in st if s.get("actor") not in ("SS", "UE")),
                       no_dir=sum(1 for s in st if s.get("direction") not in ("S->U", "U->S")),
                       no_msg_field=sum(1 for s in st if not isinstance(s.get("message"), str)),
                       empty_msg=sum(1 for s in st if isinstance(s.get("message"), str)
                                     and not s["message"].strip()),
                       messages=len(ir.get("messages") or []))
        else:
            rec["raw_head"] = text[:120]
        rows.append(rec)
        print(json.dumps(rec, ensure_ascii=False))
    json.dump(rows, open(os.path.join(OUT, "probe.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
