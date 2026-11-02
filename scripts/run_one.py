"""跑单个用例的完整链路，逐阶段向 stdout 输出 JSON Lines。

用法：
    python scripts/run_one.py 6.7.1.3            # 真实调用（需要可用模型通道）
    python scripts/run_one.py 6.7.1.3 --dry-run  # 不调模型，用桩 IR 验证链路
    python scripts/run_one.py 6.7.1.3 --no-write # 不写 data/out

输出示例（每行一个 JSON）：
    {"stage":"ingest","status":"ok","summary":"...","detail":{...}}
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOLS = os.path.join(ROOT, "tools")
sys.path.insert(0, TOOLS)
from ir import parse_test_purpose as parse_tp
import stage_tools

SYMBOLS = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")
BENCH = os.path.join(ROOT, "data", "benchmark", "v0")
CTX = os.path.join(ROOT, "data", "ctx")
OUT = os.path.join(ROOT, "data", "out")
OUT_REJECTED = os.path.join(ROOT, "data", "out_rejected")
GOLD_IE = os.path.join(ROOT, "data", "ir", "ie")


def emit(stage, status, summary, detail=None):
    print(json.dumps({"stage": stage, "status": status,
                      "summary": summary, "detail": detail or {}},
                     ensure_ascii=False), flush=True)


def load(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def await_approval(job_id, candidates, timeout):
    """HITL：候选消息生成后暂停，等用户批准再调用模型；超时按拒绝处理。

    审批文件可带 options（本次运行的参数），批准后据此覆盖命令行默认值。
    """
    emit("approval", "pending", "等待人工确认候选消息",
         {"candidates": candidates, "timeout": timeout})
    path = os.path.join(ROOT, "data", "jobs", job_id + ".approval")
    deadline = time.time() + max(1, timeout)
    while time.time() < deadline:
        if os.path.exists(path):
            decision, options = "", {}
            try:
                with open(path, encoding="utf-8") as f:
                    body = json.load(f)
                    decision = (body.get("decision") or "").strip()
                    options = body.get("options") if isinstance(body.get("options"), dict) else {}
            except Exception:
                decision = ""
            if decision in ("approve", "reject"):
                try:
                    os.remove(path)
                except Exception:
                    pass
                status = "approved" if decision == "approve" else "rejected"
                emit("approval", status,
                     "已批准，开始生成" if decision == "approve" else "已取消，未调用模型",
                     {"candidates": candidates, "decision": decision, "options": options})
                return decision, options
            if os.path.exists(path):
                # 非法内容（空/损坏）：删掉继续等，避免坏文件卡满 600 秒
                try:
                    os.remove(path)
                except Exception:
                    pass
        time.sleep(0.5)
    emit("approval", "timeout", "审批超时，未调用模型", {"candidates": candidates})
    return "reject", {}


def pick_candidates(cand, raw):
    """按用户勾选的消息过滤候选；返回 (保留, 未命中)。空选择=全选。"""
    want = [x.strip() for x in (raw or "").split(",") if x.strip()]
    if not want:
        return list(cand), []
    picked = [c for c in cand if c in want]
    return picked, [w for w in want if w not in cand]


def apply_options(a, opts):
    """审批文件里的参数优先级高于命令行默认值。"""
    if not isinstance(opts, dict):
        return a
    if opts.get("mode") in stage_tools.MODES:
        a.mode = opts["mode"]
    try:
        a.repairs = max(0, min(5, int(opts.get("repairs", a.repairs))))
    except (TypeError, ValueError):
        pass
    if opts.get("strictness") in stage_tools.STRICTNESS:
        a.strictness = opts["strictness"]
    msgs = opts.get("messages")
    if isinstance(msgs, list) and msgs:
        a.messages = ",".join(str(m) for m in msgs)
    return a


def repair_only(case, a, sym_path):
    """repair_only：不重新生成步骤，只对已有产物做定向重修。"""
    src = getattr(a, "ir_file", "") or os.path.join(OUT, case + ".json")
    if not os.path.exists(src):
        src = os.path.join(OUT_REJECTED, case + ".json")
    ir = load(src)
    if not ir:
        emit("generate", "failed", "repair_only：找不到已有产物 %s.json" % case)
        emit("validate", "skipped", "上游失败")
        emit("score", "skipped", "上游失败")
        return 1
    emit("generate", "ok", "从已有产物加载（repair_only，未调用模型生成步骤）",
         {"steps": len(ir.get("steps") or []), "messages": len(ir.get("messages") or []),
          "calls": 0, "source": os.path.relpath(src, ROOT).replace("\\", "/")})
    if a.repairs > 0 and not a.dry_run:
        d = stage_tools.repair_intent(ir, a.repairs, a.strictness,
                                      skills=skill_names(a))["data"]
        for r in d["rounds"]:
            emit("repair", "ok" if r["after"] < r["before"] else "unchanged",
                 "第 %d 轮修复：违规 %d → %d" % (r["round"], r["before"], r["after"]), r)
        emit("repair", "ok", "定向重修 %d 次：违规 %d → %d"
             % (d["repairs"], d["before"], d["after"]),
             {"repairs": d["repairs"], "before": d["before"], "after": d["after"],
              "rounds": d["rounds"], "violations": d["violations"]})
        ir = d["ir"]
    return finish(case, ir, a, sym_path)


def skill_names(a):
    return [x.strip() for x in (getattr(a, "skills", "") or "").split(",") if x.strip()]


def finish(case, ir, a, sym_path):
    """校验 → 判定 → 写盘 → 评分。拒收时写 out_rejected，绝不覆盖 data/out。"""
    viol = []
    try:
        import validate
        syms = load(sym_path) if sym_path else {}
        raw = validate.validate(ir, syms)
        viol = stage_tools.filter_violations(raw, getattr(a, "strictness", "strict"))
        if len(raw) != len(viol):
            emit("validate", "ok", "按严格度 %s 忽略 %d 条违规（保留 %d 条）"
                 % (a.strictness, len(raw) - len(viol), len(viol)),
                 {"violations": viol, "raw_violations": raw})
        else:
            emit("validate", "ok" if not viol else "rejected",
                 "无违规" if not viol else "发现 %d 条违规（将拒收）" % len(viol),
                 {"violations": viol})
    except Exception as e:
        # 校验器自身出错不能当成“无违规”：按拒收处理，并留下可审计记录
        viol = [{"rule": "R0", "path": "validate", "detail": "校验异常：%s" % e}]
        emit("validate", "failed", "校验异常：%s" % e)

    verdict = "reject" if viol else "pass"

    if not a.no_write:
        target = OUT_REJECTED if verdict == "reject" else OUT
        os.makedirs(target, exist_ok=True)
        ir_out = dict(ir)
        ir_out["verdict"] = verdict
        ir_out["violations"] = viol
        with open(os.path.join(target, case + ".json"), "w", encoding="utf-8") as f:
            json.dump(ir_out, f, ensure_ascii=False, indent=2)
        if verdict == "reject":
            emit("verdict", "rejected", "已拒收，未写入结果",
                 {"written_to": "data/out_rejected/%s.json" % case})
        else:
            emit("verdict", "pass", "通过，产物已写入结果",
                 {"written_to": "data/out/%s.json" % case})

    try:
        import score
        l1 = score.l1_ok(ir)
        gold_path = os.path.join(GOLD_IE, case + ".json")
        gold = score.gold_leaf_ies(gold_path) if os.path.exists(gold_path) else []
        gen = []
        for m in ir.get("messages") or []:
            for it in m.get("ies") or []:
                gen.append(score.norm_ie(it.get("name", "")))
        # 只生成步骤时没有字段可召回，L3 记为空而不是 0（避免把“范围外”算成“全漏”）
        l3 = None if (getattr(a, "mode", "full") == "steps" and not gen) \
            else score.recall(gen, gold)
        head = "已拒收 · L1=%.3f · L3=%s" if verdict == "reject" else "L1=%.3f · L3=%s"
        emit("score", "ok" if verdict == "pass" else "rejected",
             head % (l1, "—" if l3 is None else "%.3f" % l3),
             {"L1": l1, "L3": l3, "gold_ies": len(gold), "gen_ies": len(gen),
              "violations": viol, "verdict": verdict})
    except Exception as e:
        emit("score", "failed", "评分异常：%s" % e)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--force-write", action="store_true",
                    help="dry-run 默认不写盘；需要覆盖真实结果时显式指定")
    ap.add_argument("--revalidate", action="store_true",
                    help="不调用模型：读现有 IR 重新校验并判定 verdict")
    ap.add_argument("--ir-file", default="", help="配合 --revalidate，指定 IR 文件路径")
    ap.add_argument("--hitl", action="store_true",
                    help="候选消息生成后暂停，等待人工批准再调用模型")
    ap.add_argument("--job-id", default="", help="配合 --hitl，审批文件的 job 标识")
    ap.add_argument("--approval-timeout", type=int, default=600,
                    help="等待审批的秒数，超时按拒绝处理")
    ap.add_argument("--mode", choices=stage_tools.MODES, default="full",
                    help="生成范围：steps 只生成步骤 / full 步骤+IE / repair_only 只重修已有产物")
    ap.add_argument("--repairs", type=int, default=1, help="修复轮数上限")
    ap.add_argument("--strictness", choices=tuple(stage_tools.STRICTNESS), default="strict",
                    help="校验严格度")
    ap.add_argument("--messages", default="",
                    help="只用这些候选消息生成 IE（逗号分隔）；空=全部")
    ap.add_argument("--skills", default="",
                    help="随修复提示带入的技能名（逗号分隔）")
    a = ap.parse_args()
    case = a.case
    if a.dry_run and not a.force_write:
        a.no_write = True
    sym_path = SYMBOLS if os.path.exists(SYMBOLS) else None

    if a.revalidate:
        src = a.ir_file or os.path.join(OUT, case + ".json")
        ir = load(src)
        if not ir:
            emit("ingest", "failed", "找不到 IR：%s" % src)
            return 1
        emit("ingest", "ok", "从已有产物加载 IR：%s" % src,
             {"steps": len(ir.get("steps") or []), "messages": len(ir.get("messages") or [])})
        emit("context", "skipped", "revalidate 模式：跳过")
        emit("candidates", "skipped", "revalidate 模式：跳过")
        emit("generate", "skipped", "revalidate 模式：未调用模型")
        return finish(case, ir, a, sym_path)

    # 1) ingest
    bench = load(os.path.join(BENCH, case + ".json"))
    if bench:
        ins = bench.get("inputs", {})
        emit("ingest", "ok", "读取规范用例：%s" % (bench.get("title", "")[:60]),
             {"sections": {k: len(v or "") for k, v in ins.items()},
              "answers": {k: len(v or "") for k, v in bench.get("answers", {}).items()}})
    else:
        emit("ingest", "failed", "找不到用例文件 data/benchmark/v0/%s.json" % case)
        emit("context", "skipped", "上游失败")
        emit("candidates", "skipped", "上游失败")
        emit("generate", "skipped", "上游失败")
        emit("validate", "skipped", "上游失败")
        emit("score", "skipped", "上游失败")
        return 1

    # 2) context
    ctx = load(os.path.join(CTX, case + ".json"))
    if ctx:
        emit("context", "ok", "上下文裁剪完成",
             {k: len(ctx.get(k) or "") for k in
              ("test_purpose", "conformance_requirements", "pre_test_conditions")})
    else:
        emit("context", "failed", "找不到 data/ctx/%s.json（先跑 build_ir.py）" % case)
        ctx = {"case_id": case, "test_purpose": "", "conformance_requirements": "",
               "pre_test_conditions": "", "title": bench.get("title", "")}

    # 2.5) repair_only：只重修已有产物，不重新抽取候选、不生成步骤
    if a.mode == "repair_only":
        emit("candidates", "skipped", "repair_only：不重新抽取候选")
        return repair_only(case, a, sym_path)

    # 3) candidates
    import gen_ie
    if not sym_path:
        emit("candidates", "failed", "找不到符号表 data/symbols/rrc_symbols.json")
        cand = []
    else:
        try:
            cand = gen_ie.candidate_messages(ctx, sym_path)
        except Exception as e:
            cand = []
            emit("candidates", "failed", "候选抽取异常：%s" % e)
            return 1
        cand, missing = pick_candidates(cand, a.messages)
        if missing:
            emit("candidates", "ok", "已忽略不在候选中的消息：%s" % ", ".join(missing[:6]),
                 {"missing": missing})
        if cand:
            note = "（按选择筛选）" if a.messages else ""
            emit("candidates", "ok", "抽取到 %d 个候选消息%s" % (len(cand), note),
                 {"candidates": cand, "selected": bool(a.messages)})
        else:
            emit("candidates", "skipped",
                 "没有可用候选消息 → 弃权（不发起模型调用）", {"candidates": []})

    # 3.5) HITL：确定性阶段已完成，调用模型前等人工批准
    if a.hitl and a.job_id and cand:
        decision, opts = await_approval(a.job_id, cand, a.approval_timeout)
        if decision != "approve":
            emit("generate", "skipped", "未获批准：未调用模型", {"calls": 0})
            emit("validate", "skipped", "未获批准：未调用模型")
            emit("score", "skipped", "未获批准：不计分")
            return 0
        apply_options(a, opts)
        if a.mode == "repair_only":
            return repair_only(case, a, sym_path)
        cand, missing = pick_candidates(cand, a.messages)
        if missing:
            emit("candidates", "ok", "已忽略不在候选中的消息：%s" % ", ".join(missing[:6]),
                 {"missing": missing})
        if not cand:
            emit("candidates", "skipped", "按选择筛选后无候选 → 弃权（不发起模型调用）",
                 {"candidates": []})

    # 4) generate
    ir = None
    if not cand:
        emit("generate", "skipped", "弃权：未调用模型", {"calls": 0})
        emit("validate", "skipped", "弃权：无产物可校验")
        emit("score", "skipped", "弃权：不计分（不是 0 分）")
        return 0

    t0 = time.time()
    try:
        if a.dry_run:
            import generate
            ir = generate.mock_ir(ctx)
            ir["status"] = "generated"
            if a.mode == "steps":
                ir["messages"] = []
            emit("generate", "ok", "桩生成（dry-run，未调用模型）",
                 {"steps": len(ir.get("steps") or []), "calls": 0})
        elif a.mode == "steps":
            import gen_steps
            steps, meta = gen_steps.generate_steps(ctx, repairs=1)
            if meta.get("error"):
                emit("generate", "failed", "生成失败：%s" % meta["error"])
                emit("validate", "skipped", "上游失败")
                emit("score", "skipped", "上游失败")
                return 1
            ir = {"case_id": case, "tp": parse_tp(ctx.get("test_purpose", "")),
                  "steps": steps, "messages": [], "status": "steps_only", "reason": "",
                  "_stage2": {"candidates": cand, "calls": 1, "mode": "steps"}}
            emit("generate", "ok", "只生成步骤（未生成 IE 字段）",
                 {"steps": len(steps), "messages": 0, "calls": 1,
                  "repairs": meta.get("repairs", 0),
                  "seconds": round(time.time() - t0, 2)})
        else:
            import gen_steps
            steps, meta = gen_steps.generate_steps(ctx, repairs=1)
            if meta.get("error"):
                # 解析失败不能当成“生成完成 0 步”继续往下走
                emit("generate", "failed", "生成失败：%s" % meta["error"])
                emit("validate", "skipped", "上游失败")
                emit("score", "skipped", "上游失败")
                return 1
            ie = gen_ie.generate_all(ctx, steps, sym_path,
                                     repairs=0, messages=cand or None)
            ir = {"case_id": case, "tp": parse_tp(ctx.get("test_purpose", "")),
                  "steps": steps, "messages": ie["messages"],
                  "status": ie["status"], "reason": ie.get("reason", ""),
                  "_stage2": {"candidates": ie.get("candidates", []), "calls": ie.get("calls", 0),
                              "repairs": ie.get("repairs", 0), "mode": "full"}}
            emit("generate", "ok", "生成完成",
                 {"steps": len(steps), "messages": len(ie["messages"]),
                  "calls": ie.get("calls", 0), "repairs": ie.get("repairs", 0),
                  "seconds": round(time.time() - t0, 2)})
    except Exception as e:
        emit("generate", "failed", "生成失败：%s" % e)
        emit("validate", "skipped", "上游失败")
        emit("score", "skipped", "上游失败")
        return 1

    # 4.5) 自诊断修复闭环：读违规 → 定向重修 → 再校验，按 --repairs 限轮
    if a.repairs > 0 and not a.dry_run:
        import validate
        syms = load(sym_path) or {}
        for rnd in range(1, a.repairs + 1):
            viol = stage_tools.filter_violations(validate.validate(ir, syms), a.strictness)
            if not viol:
                emit("repair", "ok", "第 %d 轮前已无违规，停止修复" % rnd,
                     {"round": rnd, "before": 0, "after": 0})
                break
            r = stage_tools.repair_step(ir, a.strictness, skills=skill_names(a))
            ir = r["ir"]
            emit("repair", "ok" if r["after"] < r["before"] else "unchanged",
                 "第 %d 轮修复：违规 %d → %d" % (rnd, r["before"], r["after"]),
                 {"round": rnd, "before": r["before"], "after": r["after"],
                  "actions": r["actions"]})
            if r["before"] == 0 or (r["after"] >= r["before"] and not r["actions"]):
                break

    # 5) validate → 6) score
    return finish(case, ir, a, sym_path)


if __name__ == "__main__":
    sys.exit(main())
