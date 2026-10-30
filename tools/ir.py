"""IR 的确定性部分：解析测试目的（TP）。

TP 在规范里是准形式化写法：
    (1)
    with { ... }
    ensure that {
        when { ... }
            then { ... }
    }

本模块只做括号匹配与切片，不调用任何模型。
"""
import json
import sys
import os
import re


def _brace_content(s, idx):
    """从 s[idx:] 里找到第一个 '{'，返回匹配括号内的内容与结束位置。"""
    start = s.find("{", idx)
    if start < 0:
        return None, idx
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i + 1
    return s[start + 1:], len(s)


def _norm(x):
    if x is None:
        return None
    return re.sub(r"\s+", " ", x).strip()


def parse_test_purpose(text):
    """返回 [{index, given, when, then}]。解析不到的条目保留原文，标记 ok=False。"""
    if not text:
        return []
    marks = [(m.start(), int(m.group(1))) for m in re.finditer(r"\((\d+)\)", text)]
    if not marks:
        marks = [(0, 1)]
    items = []
    for k, (pos, num) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(text)
        chunk = text[pos:end]

        given = when = then = None
        m_with = re.search(r"\bwith\b", chunk)
        if m_with:
            given, _ = _brace_content(chunk, m_with.end())

        ensure_at = chunk.find("ensure that")
        when = then = None
        if ensure_at >= 0:
            inner, _ = _brace_content(chunk, ensure_at)
            if inner:
                m_when = re.search(r"\bwhen\b", inner)
                if m_when:
                    when, after = _brace_content(inner, m_when.end())
                    m_then = re.search(r"\bthen\b", inner[after:] if after else inner)
                    if m_then:
                        base = after if after else 0
                        then, _ = _brace_content(inner, base + m_then.end())

        item = {
            "index": num,
            "given": _norm(given),
            "when": _norm(when),
            "then": _norm(then),
        }
        item["ok"] = all(item[k] for k in ("given", "when", "then"))
        if not item["ok"]:
            item["raw"] = _norm(chunk)
        items.append(item)
    return items


def main(bench_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for name in sorted(os.listdir(bench_dir)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        with open(os.path.join(bench_dir, name), encoding="utf-8") as f:
            case = json.load(f)
        tp = parse_test_purpose(case["inputs"]["test_purpose"])
        ir = {"case_id": case["case_id"], "title": case["title"], "tp": tp}
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(ir, f, ensure_ascii=False, indent=2)
        rows.append((case["case_id"], len(tp), sum(1 for i in tp if i["ok"])))

    print(f"{'case':<10}{'TP项':>5}{'解析成功':>8}")
    for cid, n, ok in rows:
        print(f"{cid:<10}{n:>5}{ok:>8}")
    print(f"合计 {sum(r[1] for r in rows)} 项，成功 {sum(r[2] for r in rows)} 项")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
