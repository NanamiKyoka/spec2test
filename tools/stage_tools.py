"""阶段级工具：HTTP API（serve.py）与 MCP server 共用的实现。

约定：
- 每个工具是普通函数，成功返回 dict，失败抛 ToolError（HTTP 层转 400）。
- 不读前端状态、不依赖全局可变状态，便于被 MCP 直接包装。
- 调用模型的工具（generate_steps / generate_ies / repair_intent）单独标记，便于门控。
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
BENCH = os.path.join(DATA, "benchmark", "v0")
CTX = os.path.join(DATA, "ctx")
SYMBOLS = os.path.join(DATA, "symbols", "rrc_symbols.json")
GOLD_IE = os.path.join(DATA, "ir", "ie")
TRACE_DIR = os.path.join(DATA, "trace")

sys.path.insert(0, HERE)

STRICTNESS = {
    "strict": ("R1", "R2", "R3"),
    "skip_lte_r2": ("R1", "R3"),
    "r1_only": ("R1",),
}
MODES = ("steps", "full", "repair_only")


class ToolError(Exception):
    pass


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _case(case):
    case = (case or "").strip()
    bench = _load(os.path.join(BENCH, case + ".json")) if case else None
    if not bench:
        raise ToolError("unknown_case: %s" % case)
    return case, bench


def _ctx(case):
    return _load(os.path.join(CTX, case + ".json")) or {}


def _symbols():
    syms = _load(SYMBOLS)
    if syms is None:
        raise ToolError("symbols_missing")
    return syms


def norm_strictness(value):
    """把调用方给的严格度收敛到三档；无法识别时按 strict（只会更严，不会更松）。"""
    if isinstance(value, str):
        key = value.strip().lower()
        if key in STRICTNESS:
            return key
        rules = set(re.findall(r"r[123]", key))
        if rules == {"r1"}:
            return "r1_only"
        if rules == {"r1", "r3"}:
            return "skip_lte_r2"
    return "strict"


def filter_violations(violations, strictness="strict"):
    """按严格度筛规则；未知严格度按 strict 处理，不静默放宽。"""
    keep = STRICTNESS[norm_strictness(strictness)]
    # R0 是校验器自身异常，任何严格度下都不能被筛掉
    return [v for v in (violations or [])
            if v.get("rule") == "R0" or v.get("rule") in keep]


def _trace(tool, started, **extra):
    rec = {"tool": tool, "at": round(time.time(), 3),
           "ms": int((time.time() - started) * 1000)}
    job = os.environ.get("SPEC2TEST_JOB")
    if job:
        rec["job"] = job
    rec.update(extra)
    try:
        os.makedirs(TRACE_DIR, exist_ok=True)
        with open(os.path.join(TRACE_DIR, "tools.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return rec


# ---------------------------------------------------------------- 只读阶段

def prepare_case(case):
    """切片 + 上下文摘要：不调用模型。"""
    t0 = time.time()
    case, bench = _case(case)
    ctx = _ctx(case)
    ins = bench.get("inputs") or {}
    import gen_ie
    cand = gen_ie.candidate_messages(ctx, SYMBOLS) if os.path.exists(SYMBOLS) else []
    data = {
        "case_id": case,
        "title": bench.get("title", ""),
        "sections": {k: {"chars": len(v or ""), "head": (v or "")[:160]} for k, v in ins.items()},
        "ctx_ready": bool(ctx),
        "candidates": cand,
        "abstain": not cand,
    }
    return {"data": data, "trace": _trace("prepare_case", t0, case=case)}


def list_candidates(case):
    """候选消息清单：不调用模型。"""
    t0 = time.time()
    case, _ = _case(case)
    import gen_ie
    cand = gen_ie.candidate_messages(_ctx(case), SYMBOLS)
    return {"data": {"case_id": case, "candidates": cand, "abstain": not cand},
            "trace": _trace("list_candidates", t0, case=case)}


def validate_intent(ir, strictness="strict"):
    """确定性校验：R1/R2/R3，按严格度筛。"""
    t0 = time.time()
    if not isinstance(ir, dict):
        raise ToolError("ir_required")
    import validate
    level = norm_strictness(strictness)
    violations = validate.validate(ir, _symbols())
    kept = filter_violations(violations, level)
    return {"data": {"violations": kept, "dropped_by_strictness": len(violations) - len(kept),
                     "strictness": level,
                     "verdict": "reject" if kept else "pass"},
            "trace": _trace("validate_intent", t0, strictness=level)}


def compare_gold(case, ir=None):
    """与官方 gold 对照：仅评测使用，不暴露给编排模型。"""
    t0 = time.time()
    case, _ = _case(case)
    import score
    ir = ir if isinstance(ir, dict) else (
        _load(os.path.join(DATA, "out", case + ".json"))
        or _load(os.path.join(DATA, "out_rejected", case + ".json")))
    if not isinstance(ir, dict):
        raise ToolError("no_ir: %s" % case)
    gen = [score.norm_ie(i.get("name", ""))
           for m in ir.get("messages") or [] for i in m.get("ies") or []]
    gold_path = os.path.join(GOLD_IE, case + ".json")
    gold = score.gold_leaf_ies(gold_path) if os.path.exists(gold_path) else []
    missing = sorted(set(gold) - set(gen))
    return {"data": {"case_id": case, "L1": score.l1_ok(ir),
                     "L3": score.recall(gen, gold), "gold_ies": len(gold),
                     "gen_ies": len(gen), "missing": missing[:20]},
            "trace": _trace("compare_gold", t0, case=case)}


def export_intent(ir):
    """导出 JSON 与 Markdown：不调用模型。"""
    t0 = time.time()
    if not isinstance(ir, dict):
        raise ToolError("ir_required")
    lines = ["# %s" % ir.get("case_id", ""), ""]
    for s in ir.get("steps") or []:
        lines.append("%s. %s %s %s" % (s.get("st"), s.get("actor"),
                                       s.get("direction"), s.get("message") or "—"))
    for m in ir.get("messages") or []:
        lines.append("")
        lines.append("## %s" % m.get("message"))
        for i in m.get("ies") or []:
            lines.append("- %s：%s" % (i.get("name"), i.get("value") or ""))
    return {"data": {"json": ir, "markdown": "\n".join(lines)},
            "trace": _trace("export_intent", t0)}


# ---------------------------------------------------------------- 调用模型

def generate_steps_tool(case, repairs=1):
    t0 = time.time()
    case, _ = _case(case)
    import gen_steps
    steps, meta = gen_steps.generate_steps(_ctx(case), repairs=max(0, int(repairs)))
    if meta.get("error"):
        return {"data": {"case_id": case, "steps": [], "error": meta["error"]},
                "trace": _trace("generate_steps", t0, case=case, ok=False)}
    return {"data": {"case_id": case, "steps": steps, "repairs": meta.get("repairs", 0)},
            "trace": _trace("generate_steps", t0, case=case)}


def generate_ies_tool(case, steps=None, messages=None):
    t0 = time.time()
    case, _ = _case(case)
    import gen_ie
    ctx = _ctx(case)
    if not (isinstance(steps, list) and steps):
        raise ToolError("steps_required")
    pool = gen_ie.candidate_messages(ctx, SYMBOLS)
    pick = [m for m in pool if not messages or m in messages]
    if not pick:
        return {"data": {"case_id": case, "messages": [], "status": "abstained"},
                "trace": _trace("generate_ies", t0, case=case)}
    msgs = [gen_ie.generate_ie(ctx, steps, m, SYMBOLS) for m in pick]
    return {"data": {"case_id": case, "messages": msgs, "calls": len(msgs)},
            "trace": _trace("generate_ies", t0, case=case, calls=len(msgs))}


def _skill_hint(names):
    """把选中的技能正文拼成提示片段；未知技能静默跳过。"""
    if not names:
        return ""
    import skills as skills_lib
    parts = []
    for n in names:
        s = skills_lib.get_skill(n)
        if s:
            parts.append("## 技能：%s\n%s" % (s["name"], s["body"]))
    return ("\n\n".join(parts))[:4000]


def repair_step(ir, strictness="strict", skills=None):
    """一轮自诊断修复：先修步骤（R1/R3），再修字段（R2），然后重校验。

    只做有依据的定向修改；无进展时由调用方停止，避免反复烧调用。
    """
    import gen_ie
    import repair_steps as rs
    import validate

    syms = _symbols()
    ctx = _ctx(ir.get("case_id", ""))
    hint = _skill_hint(skills)
    before = filter_violations(validate.validate(ir, syms), strictness)
    if not before:
        return {"ir": ir, "changed": False, "before": 0, "after": 0, "actions": []}

    out = dict(ir)
    actions = []
    steps = list(out.get("steps") or [])
    if any(v.get("rule") in ("R1", "R3") for v in before):
        fixed_steps, meta = rs.repair_steps(ctx, steps, before, SYMBOLS, hint=hint)
        if meta.get("error"):
            actions.append({"layer": "steps", "error": meta["error"]})
        elif meta.get("changed"):
            out["steps"] = fixed_steps
            actions.append({"layer": "steps", "changed": meta["changed"]})

    msgs = list(out.get("messages") or [])
    bad = gen_ie._r2_messages([v for v in before if v.get("rule") == "R2"])
    for msg, feedback in list(bad.items())[:3]:
        idx = next((i for i, m in enumerate(msgs) if (m.get("message") or "") == msg), None)
        if idx is None:
            continue
        fixed = gen_ie.generate_ie(ctx, out.get("steps") or [], msg, SYMBOLS,
                                   feedback=feedback, hint=hint)
        if fixed.get("ies") or not (msgs[idx].get("ies") or []):
            msgs[idx] = fixed
            actions.append({"layer": "fields", "message": msg})
    out["messages"] = msgs

    after = filter_violations(validate.validate(out, syms), strictness)
    return {"ir": out, "changed": bool(actions), "before": len(before),
            "after": len(after), "actions": actions}


def repair_intent(ir, repairs=1, strictness="strict", skills=None):
    """多轮修复闭环；每轮记录前后违规数，供 A/B 对照。"""
    t0 = time.time()
    if not isinstance(ir, dict):
        raise ToolError("ir_required")
    import validate

    syms = _symbols()
    cur = ir
    initial = len(filter_violations(validate.validate(cur, syms), strictness))
    rounds = []
    for i in range(max(0, int(repairs))):
        r = repair_step(cur, strictness, skills=skills)
        if r["before"] == 0:          # 已无违规，不算一轮
            break
        cur = r["ir"]
        rounds.append({"round": i + 1, "before": r["before"], "after": r["after"],
                       "actions": r["actions"]})
        if r["after"] >= r["before"] and not r["actions"]:
            break
    final = filter_violations(validate.validate(cur, syms), strictness)
    return {"data": {"ir": cur, "initial": initial, "before": initial,
                     "after": len(final), "repairs": len(rounds),
                     "rounds": rounds, "violations": final},
            "trace": _trace("repair_intent", t0, repairs=len(rounds))}


def list_skills():
    """技能清单一览：不调用模型。"""
    t0 = time.time()
    import skills as skills_lib
    return {"data": {"skills": skills_lib.list_skills()},
            "trace": _trace("list_skills", t0)}


def use_skill(name):
    """取出一份技能的完整说明，供编排时按需加载。"""
    t0 = time.time()
    import skills as skills_lib
    s = skills_lib.get_skill(name)
    if not s:
        raise ToolError("unknown_skill: %s" % name)
    return {"data": s, "trace": _trace("use_skill", t0, skill=s["name"])}


TOOLS = {
    "prepare_case": {"fn": prepare_case, "model": False, "eval_only": False},
    "list_candidates": {"fn": list_candidates, "model": False, "eval_only": False},
    "validate_intent": {"fn": validate_intent, "model": False, "eval_only": False},
    "export_intent": {"fn": export_intent, "model": False, "eval_only": False},
    "compare_gold": {"fn": compare_gold, "model": False, "eval_only": True},
    "list_skills": {"fn": list_skills, "model": False, "eval_only": False},
    "use_skill": {"fn": use_skill, "model": False, "eval_only": False},
    "generate_steps": {"fn": generate_steps_tool, "model": True, "eval_only": False},
    "generate_ies": {"fn": generate_ies_tool, "model": True, "eval_only": False},
    "repair_intent": {"fn": repair_intent, "model": True, "eval_only": False},
}


def call(name, args):
    """统一入口：校验工具名并分发。"""
    spec = TOOLS.get(name)
    if not spec:
        raise ToolError("unknown_tool: %s" % name)
    if not isinstance(args, dict):
        raise ToolError("args_required")
    return spec["fn"](**args)


def recent_trace(limit=20, job=None):
    """最近的工具调用记录；给 job 时只取该任务的调用（决策轨迹）。"""
    path = os.path.join(TRACE_DIR, "tools.jsonl")
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except Exception:
        return []
    out = []
    for line in lines:
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if job and rec.get("job") != job:
            continue
        out.append(rec)
    return list(reversed(out[-max(1, int(limit)):]))
