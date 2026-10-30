"""把 benchmark 输入侧裁成给模型的上下文。

裁剪策略（避免 11k 字稀释注意力）：保留 TP 全文、条款编号与标题行；
对引用的规范正文，只保留首个段落与出现字段名/消息名的行。
"""
import json
import os
import re
import sys

MAX_CR = 2500          # 条款正文上限（字符）
FIELD_HINT = re.compile(r"[A-Za-z]+-[A-Za-z0-9\-]+|\bSIB\d+\b|\bRRC[A-Za-z]+\b")


def trim_cr(text, limit=MAX_CR):
    lines = [ln.rstrip() for ln in text.splitlines()]
    keep, budget = [], 0
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        important = bool(FIELD_HINT.search(s)) or s.startswith("References:")
        if len(keep) < 6 or important or budget < limit // 2:
            keep.append(ln)
            budget += len(ln)
        if budget >= limit:
            break
    return "\n".join(keep)


def main(bench_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(bench_dir)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        with open(os.path.join(bench_dir, name), encoding="utf-8") as f:
            case = json.load(f)
        ctx = {
            "case_id": case["case_id"],
            "title": case["title"],
            "test_purpose": case["inputs"]["test_purpose"],
            "conformance_requirements": trim_cr(case["inputs"]["conformance_requirements"]),
            "pre_test_conditions": case["inputs"]["pre_test_conditions"],
        }
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(ctx, f, ensure_ascii=False, indent=2)
        n += 1
    sizes = []
    for name in os.listdir(out_dir):
        sizes.append(len(json.dumps(json.load(open(os.path.join(out_dir, name), encoding="utf-8")),
                                    ensure_ascii=False)))
    print(f"contexts={n} chars={sum(sizes)} max={max(sizes) if sizes else 0}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
