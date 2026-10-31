"""用 LLM 为单个用例生成自然语言解读。

用法：
  py -3.12 tools/explain.py 6.7.1.3
  py -3.12 tools/explain.py 6.7.1.3 6.7.1.10 6.7.1.12
  py -3.12 tools/explain.py 6.7.1.3 --dry-run   # 不调模型，写确定性桩
  py -3.12 tools/explain.py 6.7.1.3 --force     # 覆盖已有文件

输出：
  data/explain/<case>.json
  results/explain/<case>.json

约束：只依据仓库内已有产物，不得编造规范事实；unknown/abstained 不得说成"通过"。
"""
import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import llm  # noqa: E402

DATA = os.path.join(ROOT, "data")
RESULTS = os.path.join(ROOT, "results")

SECTION_KEYS = ["tests", "generated", "verdict", "data", "caveats"]
SECTION_TITLES = {
    "tests": "这条用例在验什么",
    "generated": "系统生成了什么",
    "verdict": "为什么是这个判定",
    "data": "数据怎么读",
    "caveats": "哪里还不确定",
}

SYSTEM = """你是 Spec2Test 的解读员。只依据用户给出的 JSON 证据写解读，不得补充证据之外的规范事实。
面向没有 6G 背景的评委，用简体中文，每段不超过 120 字。
判定必须与 numbers.verdict 一致：unknown 就是"未判定"，abstained 是"弃权"，绝不能把二者说成"通过"。
口径：
- pass/reject 且 gold=0 时，L3=null 表示该用例没有可计分的 gold 字段（L3 不适用），不得写成"弃权不计分"。
- abstained 时必须明确"未生成 IE 字段内容（阶段二未调用模型）"；若证据里仍有 steps，说明它只是前序解析产物、只含消息名，不是生成的信令内容。
- generated 段必须直接使用证据里的 steps_count、messages_count、calls；不得改写步骤数或消息名。证据没有 messages_count 时，只描述 messages 字段里实际出现的内容。
只输出一个 JSON 对象，不要 Markdown，不要额外解释。"""


def load(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def pick_out(case):
    """正式产物有判定/弃权时优先；否则用被拒收运行，避免把拒收读成通过。"""
    out = load(os.path.join(DATA, "out", case + ".json"))
    rej = load(os.path.join(DATA, "out_rejected", case + ".json"))
    if out and (out.get("verdict") or out.get("status") == "abstained"):
        return out, "data/out/%s.json" % case
    if rej:
        return rej, "data/out_rejected/%s.json" % case
    if out:
        return out, "data/out/%s.json" % case
    return None, None


def verdict_of(out):
    if not out:
        return "unknown"
    if out.get("verdict") == "reject":
        return "reject"
    if out.get("status") == "abstained":
        return "abstained"
    if out.get("verdict") == "pass":
        return "pass"
    if out.get("violations"):
        return "reject"
    return "unknown"


def short(v, n=160):
    s = "" if v is None else str(v)
    s = " ".join(s.split())
    return s[:n] + ("…" if len(s) > n else "")


def build_evidence(case):
    ctx = load(os.path.join(DATA, "ctx", case + ".json")) or {}
    out, out_path = pick_out(case)
    report = load(os.path.join(DATA, "score", "report.json")) or []
    score = next((r for r in report if r.get("case") == case), None)
    if score:
        score = {k: score.get(k) for k in ("L1", "L3_recall", "status", "calls", "gold_ie_n")}
    ie = load(os.path.join(DATA, "ir", "ie", case + ".json")) or {}
    gold = [
        x.get("name")
        for t in ie.get("message_tables", [])
        for x in (t.get("leaf_ies") or [])
        if x.get("name")
    ]

    messages = []
    for m in ((out or {}).get("messages") or []):
        messages.append({
            "message": m.get("message"),
            "derivation_path": short(m.get("derivation_path"), 120),
            "ies": [
                {
                    "name": i.get("name"),
                    "value": short(i.get("value"), 80),
                    "condition": short(i.get("condition"), 120),
                }
                for i in (m.get("ies") or [])
            ],
        })

    steps = [
        {"st": s.get("st"), "actor": s.get("actor"), "direction": s.get("direction"),
         "message": s.get("message"), "tp_ref": s.get("tp_ref")}
        for s in ((out or {}).get("steps") or [])
    ]

    violations = [
        {"rule": v.get("rule"), "path": v.get("path"), "detail": short(v.get("detail"), 160)}
        for v in ((out or {}).get("violations") or [])
    ]

    evidence = {
        "case_id": case,
        "title": ctx.get("title"),
        "test_purpose": short(ctx.get("test_purpose"), 1200),
        "conformance_requirements": short(ctx.get("conformance_requirements"), 1600),
        "verdict": verdict_of(out),
        "status": (out or {}).get("status"),
        "reason": short((out or {}).get("reason"), 160),
        "violations": violations,
        "steps_count": len(steps),
        "steps": steps[:20],
        "messages": messages[:8],
        "score": score,
        "gold_leaf_ies": gold[:30],
    }
    return evidence, out_path


def numbers_of(evidence):
    score = evidence.get("score") or {}
    l3 = score.get("L3_recall")
    return {
        "L1": score.get("L1"),
        "L3": None if isinstance(l3, str) else l3,
        "gold": score.get("gold_ie_n") if score.get("gold_ie_n") is not None else len(evidence.get("gold_leaf_ies") or []),
        "calls": score.get("calls"),
        "violations": len(evidence.get("violations") or []),
        "verdict": evidence.get("verdict"),
    }


def user_prompt(evidence):
    return (
        "请基于以下证据写解读，只输出 JSON 对象。\n\n"
        "证据：\n" + json.dumps(evidence, ensure_ascii=False, indent=2) + "\n\n"
        "输出结构：\n"
        "{\n"
        '  "headline": "一句话结论，<=40字",\n'
        '  "sections": [\n'
        '    {"key":"tests","title":"这条用例在验什么","body":"<=120字"},\n'
        '    {"key":"generated","title":"系统生成了什么","body":"<=120字"},\n'
        '    {"key":"verdict","title":"为什么是这个判定","body":"<=120字"},\n'
        '    {"key":"data","title":"数据怎么读","body":"<=120字"},\n'
        '    {"key":"caveats","title":"哪里还不确定","body":"<=120字"}\n'
        "  ]\n"
        "}\n\n"
        "写作要求：\n"
        "- generated 必须写出证据里的 steps_count 具体步数。\n"
        "- data 必须写出 numbers 里的 L1、L3、gold、calls 具体数值；L3 为 null 时写“弃权不计分”。\n"
        "- verdict 必须写出 numbers.verdict 与实际违规条数。\n"
        "- 所有数字必须与证据一致，不得改写。\n"
    )


def validate(obj):
    if not isinstance(obj, dict):
        return "not_object"
    if not obj.get("headline"):
        return "missing_headline"
    sections = obj.get("sections")
    if not isinstance(sections, list) or len(sections) != 5:
        return "sections_not_5"
    keys = [s.get("key") for s in sections if isinstance(s, dict)]
    if keys != SECTION_KEYS:
        return "section_keys:%s" % keys
    for s in sections:
        if not s.get("body"):
            return "empty_body:%s" % s.get("key")
    return None


def dry_result(evidence, case):
    n = numbers_of(evidence)
    return {
        "headline": "[dry-run] %s：%s" % (case, n["verdict"]),
        "sections": [
            {"key": "tests", "title": SECTION_TITLES["tests"], "body": "（桩）依据测试目的说明该用例验证的规范行为。"},
            {"key": "generated", "title": SECTION_TITLES["generated"], "body": "（桩）共 %d 步、%d 条消息。" % (evidence.get("steps_count") or 0, len(evidence.get("messages") or []))},
            {"key": "verdict", "title": SECTION_TITLES["verdict"], "body": "（桩）判定为 %s。" % n["verdict"]},
            {"key": "data", "title": SECTION_TITLES["data"], "body": "（桩）L1=%s，L3=%s，gold=%s。" % (n["L1"], n["L3"], n["gold"])},
            {"key": "caveats", "title": SECTION_TITLES["caveats"], "body": "（桩）dry-run 不含真实解读。"},
        ],
    }


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def process(case, dry_run, force):
    target = os.path.join(DATA, "explain", case + ".json")
    if os.path.exists(target) and not force:
        print("[skip] %s exists (use --force)" % target)
        return True, None, None

    evidence, out_path = build_evidence(case)
    if out_path is None and not evidence.get("title"):
        print("[fail] no artifacts for %s" % case)
        return False, None, None

    started = datetime.datetime.now()
    used_model = "dry-run"
    if dry_run:
        body = dry_result(evidence, case)
    else:
        body = None
        last_err = None
        for attempt in range(2):
            text, _ = llm.complete(
                [{"role": "user", "content": user_prompt(evidence)}],
                temperature=0, system=SYSTEM,
            )
            obj = llm.extract_json(text)
            err = validate(obj)
            if err is None:
                body = obj
                break
            last_err = err
        if body is None:
            print("[fail] %s model output invalid: %s" % (case, last_err))
            return False, None, None
        used_model = llm.LAST_MODEL or llm.MODEL

    numbers = numbers_of(evidence)
    grounded = ["data/ctx/%s.json" % case]
    if out_path:
        grounded.append(out_path)
    grounded += ["data/score/report.json", "data/ir/ie/%s.json" % case]

    result = {
        "case_id": case,
        "provider": llm.PROVIDER,
        "model": used_model,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "headline": body.get("headline"),
        "sections": body.get("sections"),
        "numbers": numbers,
        "grounded_on": grounded,
    }

    write_json(os.path.join(DATA, "explain", case + ".json"), result)
    write_json(os.path.join(RESULTS, "explain", case + ".json"), result)
    elapsed = (datetime.datetime.now() - started).total_seconds()
    print("[ok] %s -> data/explain/%s.json (%.1fs)" % (case, case, elapsed))
    return True, result.get("headline"), elapsed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    ok = True
    for case in args.cases:
        try:
            success, headline, _ = process(case, args.dry_run, args.force)
        except Exception as e:
            print("[fail] %s: %s" % (case, e))
            success, headline = False, None
        if not success:
            ok = False
        elif headline:
            print("      headline: %s" % headline)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
