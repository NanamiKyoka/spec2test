"""从 IE 表重建叶子字段（leaf_ies）：排除容器/类型定义行，只保留有取值的字段。

判定（三条全满足）：
(a) 该行有非空取值列；
(b) 名字不含 '::='、不以 '{' 结尾；
(c) 不是 ASN.1 类型定义行（如 'CellGroupConfig ::= SEQUENCE {'、'CHOICE {'）。
"""
import json
import os
import re

BASE = "E:/workspace/ai_competition/data/ir/ie"
TYPE_LINE = re.compile(r"^(SEQUENCE|CHOICE|ENUMERATED)\b")
TARGET = {"6.7.1.10": 2, "6.7.1.12": 14, "6.7.1.2": 4,
          "6.7.1.3": 3, "6.7.1.4": 3, "6.7.1.5": 7, "6.7.1.6": 9}


def is_leaf(raw, value):
    name = (raw or "").strip()
    if not (value or "").strip() or value.strip() in ("-", "–"):
        return False
    if "::=" in name or name.endswith("{"):
        return False
    if TYPE_LINE.match(name):
        return False
    return bool(re.match(r"^[A-Za-z][A-Za-z0-9\-]*", name))


def main():
    total = 0
    print(f"{'case':<10}{'叶子字段':>9}{'目标':>6}{'一致':>5}")
    for name in sorted(os.listdir(BASE)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        p = os.path.join(BASE, name)
        d = json.load(open(p, encoding="utf-8"))
        n = 0
        seen = set()
        for t in d["message_tables"]:
            leaves = []
            for it in t.get("ies") or []:
                if is_leaf(it.get("raw", it.get("name")), it.get("value")):
                    # 口径：按字段名去重；同一字段的 GSO/NGSO 条件取值不重复计数
                    v = re.sub(r"\s+in TS.*$", "", (it["value"] or "").strip())
                    key = (t.get("message"), it["name"], v)
                    if key in seen:
                        continue
                    seen.add(key)
                    leaves.append({"name": it["name"], "value": it["value"],
                                   "condition": it.get("condition", "")})
            t["leaf_ies"] = leaves
            n += len(leaves)
        json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        tgt = TARGET.get(d["case_id"], 0)
        total += n
        print(f"{d['case_id']:<10}{n:>9}{tgt:>6}{'OK' if n == tgt else 'MISS':>5}")
    print(f"合计 {total}（目标 42）")


if __name__ == "__main__":
    main()
