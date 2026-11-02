"""按官方模板生成方案 DOCX，并用 Word 导出 PDF。

用法：py -3 tools/build_proposal.py
输出：docs/proposal/Spec2Test-方案.docx / .pdf
"""
import os
import json
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "_scratch", "notice", "tpl.docx")
OUTDIR = os.path.join(ROOT, "docs", "proposal")
FIGDIR = os.path.join(OUTDIR, "figs")
DOCX = os.path.join(OUTDIR, "Spec2Test-方案.docx")
PDF = os.path.join(OUTDIR, "Spec2Test-方案.pdf")

BODY_FONT = "宋体"
HEAD_FONT = "宋体"
BODY_SIZE = Pt(12)      # 小四
H1_SIZE = Pt(16)        # 三号
H2_SIZE = Pt(14)        # 四号
H3_SIZE = Pt(12)        # 小四


def set_run(run, size=BODY_SIZE, bold=False, font=BODY_FONT, color=None):
    run.font.name = font
    run.font.size = size
    run.bold = bold
    if color:
        run.font.color.rgb = color
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), font)
    rFonts.set(qn("w:ascii"), font)
    rFonts.set(qn("w:hAnsi"), font)


def move_before_sectpr(doc, el):
    body = doc.element.body
    sectPr = body.find(qn("w:sectPr"))
    if sectPr is not None:
        sectPr.addprevious(el)


def body_par(doc, text="", style=None, size=BODY_SIZE, bold=False, align=None,
             indent=True, space_after=Pt(4)):
    p = doc.add_paragraph(style=style)
    move_before_sectpr(doc, p._p)
    p.paragraph_format.space_after = space_after
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    if indent:
        p.paragraph_format.first_line_indent = Pt(24)
    if align is not None:
        p.alignment = align
    for i, seg in enumerate((text or "").split("**")):
        if not seg:
            continue
        run = p.add_run(seg)
        set_run(run, size=size, bold=(bold or i % 2 == 1))
    return p


def heading(doc, text, level):
    style = "Heading %d" % level
    p = doc.add_paragraph(style=style)
    move_before_sectpr(doc, p._p)
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    run = p.add_run(text)
    set_run(run, size={1: H1_SIZE, 2: H2_SIZE, 3: H3_SIZE}[level],
            bold=True, font=HEAD_FONT)
    return p


def bullet(doc, text):
    p = doc.add_paragraph()
    move_before_sectpr(doc, p._p)
    p.paragraph_format.left_indent = Pt(18)
    p.paragraph_format.first_line_indent = Pt(-18)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    r0 = p.add_run("• ")
    set_run(r0)
    for i, seg in enumerate((text or "").split("**")):
        if seg:
            run = p.add_run(seg)
            set_run(run, bold=(i % 2 == 1))
    return p


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def table(doc, header, rows, widths=None, font=Pt(8.5), header_fill="D9E2F3"):
    t = doc.add_table(rows=1, cols=len(header))
    move_before_sectpr(doc, t._tbl)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tblPr = t._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    tblW = OxmlElement("w:tblW")
    tblW.set(qn("w:w"), str(int(15.0 / 2.54 * 1440)))
    tblW.set(qn("w:type"), "dxa")
    tblPr.append(tblW)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement("w:" + edge)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "808080")
        borders.append(el)
    tblPr.append(borders)
    hdr = t.rows[0].cells
    for i, h in enumerate(header):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(str(h))
        set_run(run, size=font, bold=True)
        shade(hdr[i], header_fill)
    # repeat header
    trPr = t.rows[0]._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
            for j, seg in enumerate(str(val).split("**")):
                if seg:
                    run = p.add_run(seg)
                    set_run(run, size=font, bold=(j % 2 == 1))
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    for row in t.rows:
        for cell in row.cells:
            cell.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    return t


def picture(doc, path, width_cm=15.0, caption=None):
    p = doc.add_paragraph()
    move_before_sectpr(doc, p._p)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run()
    run.add_picture(path, width=Cm(width_cm))
    if caption:
        c = doc.add_paragraph()
        move_before_sectpr(doc, c._p)
        c.alignment = WD_ALIGN_PARAGRAPH.CENTER
        c.paragraph_format.space_after = Pt(8)
        r = c.add_run(caption)
        set_run(r, size=Pt(9), color=RGBColor(0x59, 0x59, 0x59))


def toc_field(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = ' TOC \\o "1-3" \\h \\z \\u '
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = "目录将在打开时更新"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)
    run._r.append(t)
    run._r.append(fld_end)
    return p


def remove(p):
    p._element.getparent().remove(p._element)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    doc = Document(TPL)
    paras = list(doc.paragraphs)

    # --- 封面 ---
    cover = {
        12: "团队名称：Myun（个人参赛）",
        13: "参赛编号：AIC-2026-____________",
        14: "作品名称：Spec2Test：自证式测试意图编译器",
        19: "日期：2026 年 11 月",
    }
    for idx, text in cover.items():
        p = paras[idx]
        p.text = ""
        run = p.add_run(text)
        set_run(run, size=Pt(14) if idx in (12, 13, 14) else Pt(12), bold=False)

    # --- 目录：保留标题与分节符，移除示例条目 ---
    for p in paras[21:36]:
        remove(p)
    toc = toc_field(doc)
    paras[36]._element.addprevious(toc._p)

    # --- 作品简介 ---
    for p in paras[38:42]:
        remove(p)
    brief = (
        "3GPP 一致性测试用例依赖工程师从规范中手抄条款、拼装步骤、填写 ASN.1 字段；"
        "规范每次改版都要重核，字段漏填、消息不存在、测试目的未覆盖往往到联调才暴露。"
        "大模型能生成，但无法被机器判错。Spec2Test 把规范条款编译成结构化测试意图："
        "测试步骤、消息序列与 IE 字段，再用确定性校验器逐条判定——消息是否存在（R1）、"
        "字段是否属于该消息（R2）、每个测试目的是否被步骤覆盖（R3）。校验器只读符号表与规则，"
        "不调用模型；不合格拒收，信息不足弃权。当前在 TS 38.523-1 §6.7 的 8 个 NR NTN "
        "用例上完成闭环：结构合法 8/8，注入 31 条缺陷全部检出，官方答案零误报；"
        "另用真实模型输出标注 19 条错误，范围内 R1/R2/R3 16/16 检出。"
        "每条结论可回指条款与字段，可导出 Markdown/JSON，供归档、评审与 CI 回归。"
    )
    p = body_par(doc, brief, indent=True)
    paras[42]._element.addprevious(p._p)

    # --- 正文：移除模板骨架 ---
    for p in paras[43:71]:
        remove(p)

    # ================= 正文 =================
    heading(doc, "一、产品概述", 1)
    heading(doc, "（一）产品名称", 2)
    body_par(doc, "**Spec2Test：自证式测试意图编译器**。名称中的三个词各对应一项事实："
                  "**Spec**——输入是 3GPP 规范正文，不是需求文档；**编译器**——输出是结构化、"
                  "可被判定的中间表示（IR），不是散文；**自证式**——生成之后由确定性校验器检查并给出"
                  "违规位置，而不是让模型自评。")
    heading(doc, "（二）项目定位", 2)
    body_par(doc, "一句话：**把 3GPP 测试规范里的“条款”，编译成可执行的“测试意图”，并在交付前自证对错。**")
    body_par(doc, "必须先说清一个前提，因为它决定本产品的全部叙事：**6G 尚未标准化**。"
                  "截至 2026 年 10 月，3GPP Rel-20 仍处 Open 状态，首个 6G 规范的功能冻结按公开时间表"
                  "约在 2028 年 12 月；2026 年不存在 6G 一致性测试规范。本作品**不宣称“为 6G 生成用例”**，"
                  "而是在唯一成熟的规范体系（NR Rel-17/18/19）上做可复现验证，并论证方法对规范代际变化的"
                  "结构性鲁棒性。当前切片为 TS 38.523-1 §6.7 NR NTN 空闲态小区选择/重选的 8 个用例。")
    body_par(doc, "**6G 冻结后迁移什么**：不是现在的 8 个用例，而是“规范条款 → 可执行测试意图 → "
                  "确定性校验 → 字段级证据”这条流水线。具体接三个方向：NTN 测试、AI 空口测试、"
                  "网络自动化测试；AI 模型性能与射频指标不归本工具判。详见第五节。")
    heading(doc, "（三）目标用户与场景", 2)
    table(doc,
          ["用户", "当前痛点", "本产品的位置"],
          [["卫星终端/模组测试工程师", "用例编写与维护是长期人力成本", "生成初稿，人工只核对字段级差异"],
           ["认证实验室/运营商测试团队", "规范每版更新，回归用例要跟着改", "条款更新 → 受影响用例的影响分析"],
           ["测试工具链团队", "需要可追溯、可复现的判定依据", "导出 JSON 接 CI，做条款更新回归"]],
          widths=[4.6, 5.8, 4.6])
    body_par(doc, "注：以上为行业角色的结构性描述，未指向任何具体厂商；尚未获得客户名称、价格或试点证明。", indent=False, size=Pt(9))

    heading(doc, "（四）和“把条款贴给大模型”的区别", 2)
    body_par(doc, "通用大模型可以写出一段看起来合理的测试步骤，但产物无法被机器判错。Spec2Test 的输出先过"
                  "确定性校验器：不合格就**拒收**，不写入结果；信息不足就**弃权**，不生成 IE 字段内容。"
                  "每条结论可回指条款与字段；违规时给出 R1/R2/R3 路径。这不是“更像人写的”，而是"
                  "“更敢签字”。")

    heading(doc, "二、技术方案与实现质量", 1)
    heading(doc, "（一）总体架构", 2)
    picture(doc, os.path.join(FIGDIR, "fig1-pipeline.png"), 15.0,
            "图 1  Spec2Test 链路：单向、无环；校验器只读 IR 与符号表，不调用模型")
    body_par(doc, "链路单向、无环，每一段都可单独替换。三条设计约束写在代码结构里，不是口头承诺：")
    bullet(doc, "**校验器只读 IR，不读自然语言、不调模型**（ADR-0002）。若允许模型参与校验，“自证”就退化为模型自评。")
    bullet(doc, "**输入侧与答案侧物理隔离**：评测时只把 inputs 送进模型，answers 仅用于比对。")
    bullet(doc, "**规范原文不入库**：仓库只放抽取脚本与用例编号，复现者从 ETSI 自行下载后重放（ADR-0003）。")

    heading(doc, "（二）关键机制一：按版式坐标解析规范", 2)
    body_par(doc, "规范不是纯文本。用常规文本抽取时，测试步骤表的方向箭头会大量丢失——实测 8 个用例合计"
                  "只剩 16 个箭头，表格在文本层里是“塌”的。因此步骤表改用 **pdfplumber 按字符坐标重建列**，"
                  "把 St / Procedure / U-S / Message / TP / Verdict 六列还原后逐行结构化。")
    body_par(doc, "这一步还暴露了两类真实工程问题：**规范自身的笔误**——6.7.1.3 的行为表标题被写成"
                  " Table 6.1.7.3.3.2-1，解析器按标题归属用例时必须做归一化；**跨页标题分离**——6.7.1.6 的"
                  "行为表在次页开头、标题留在上一页，且步骤号为 0/0A 而非纯数字，归属规则改为"
                  "“标题 carry + 仅当相邻页只出现一个用例号时承接”。这意味着方法的输入不依赖人工整理，"
                  "换一份规范即可重放。")

    heading(doc, "（三）关键机制二：结构化中间表示（IR）", 2)
    body_par(doc, "生成的产物不是一段文字，而是 IR。IR 的关键设计是把“步骤”与“信令”分层：步骤层可被规则检查，"
                  "信令层可被符号表检查，两层都不需要模型参与判断。tp_ref 字段把每个步骤绑回测试目的条目，"
                  "这是“覆盖检查”能自动化的唯一依据。")
    table(doc,
          ["层", "内容", "谁来校验"],
          [["tp", "测试目的，with/ensure that/when/then 四元组", "确定性解析器（原文即准形式化）"],
           ["steps", "语义层步骤：执行主体、方向、消息", "覆盖检查（每条 then 是否被步骤覆盖）"],
           ["messages", "信令层：消息名、衍生路径、IE 字段与取值", "符号表（消息与字段是否存在）"]],
          widths=[3.2, 6.8, 5.0])

    heading(doc, "（四）关键机制三：确定性校验器（核心）", 2)
    body_par(doc, "校验器是产品的命门，也是“自证式”三个字的全部重量所在。它不调用任何模型，只做三件事：")
    table(doc,
          ["规则", "检查内容", "判错的后果"],
          [["R1 消息存在", "IR 中的消息名是否在符号表中；非空、非物理层/NAS 的写法一律判", "生成了不存在的消息 → 拒收"],
           ["R2 字段合法", "ies[].name 的叶子名是否属于该消息的 ASN.1 字段（含人工复核的嵌套/别名）", "张冠李戴的 IE → 拒收"],
           ["R3 覆盖完整", "每条测试目的是否被至少一个步骤引用", "测试目的没被验证 → 拒收"]],
          widths=[3.2, 7.8, 4.0])
    body_par(doc, "符号表来自 TS 38.331 的 ASN.1（半自动抽取字段路径 + 人工筛选），**明确禁止用模型生成符号表**——"
                  "否则校验器自身会错，“确定性”就成了空话。当前符号表覆盖 15 个消息；LTE 条目只保证 R1，"
                  "R2 跳过不完整字段集。")
    body_par(doc, "**校验器自身的质量用真实错误集度量，而不是自我感觉。** 从真实模型输出（产品链路与无辅助基线）"
                  "人工标注 19 条错误，标注在运行前固定；逐条对照 gold IR 与 TS 38.331。结果：")
    table(doc,
          ["口径", "检出", "漏检", "检出率", "范围内 R1/R2/R3", "范围外"],
          [["改动前校验器", "2", "17", "10%", "2/16", "0/3"],
           ["当前校验器", "16", "3", "84%", "**16/16**", "0/3"]],
          widths=[2.8, 2.0, 2.0, 2.0, 4.2, 2.0], font=Pt(8))
    body_par(doc, "3 条漏检全部是校验器未声明的范围：方向取值（N/A）、步骤顺序（Paging 晚于 SIB25）、"
                  "消息完整性（缺 SIB4）。不把范围外漏检混进检出率。改动前 R1 只检查 RRC/SIB/MIB/Paging 前缀，"
                  "漏掉“System Information (...)”“TN NR Cell 10 configured...”“E-UTRA SIB1”“NR SIB1”"
                  "等把说明文字/字段名当消息名的真实错误；改动前 R2 只要字段名在全局 ASN.1 集合里就放过，"
                  "无法发现“字段放错消息”。这两处已在当前版本修正。")
    body_par(doc, "本测试还在**产品自己的真实输出** 6.7.1.5 中查到一条错放字段（distanceThresh-r17 放进 SIB2）；"
                  "已用同一校验器反馈重生成并修正快照。这是“校验器真的会拒收自己”的证据，不是只测模板。")
    picture(doc, os.path.join(FIGDIR, "fig3-blindset.png"), 12.0,
            "图 2  真实错误集盲测：19 条真实模型错误，改动前 2/19，当前 16/19")
    body_par(doc, "已知漏检（边界，不计入核心 19 条）：（1）ue-Identity 作为 Paging 顶层 IE——符号表把嵌套字段拍平，"
                  "R2 目前不区分顶层/嵌套；（2）ntn-Config 放在 NR SIB1 下——消息名本身被 R1 拒收，整条输出不通过，"
                  "但字段错位未被单独指出。", size=Pt(10))

    heading(doc, "（五）评测方法：遮住答案，逐例公示", 2)
    body_par(doc, "首期基准取自 TS 38.523-1 §6.7，共 14 个用例，按过程类型异质取样 8 个。官方答案侧规模："
                  "**59 个步骤、25 张信令表、42 个叶子字段**。指标定义如下；**不报平均数**，因为 8 例无统计意义。")
    table(doc,
          ["指标", "定义", "分母"],
          [["L1 结构合法", "生成物能否解析为 IR，且每个步骤具备主体/方向/消息", "8 例"],
           ["L3 关键 IE 命中", "生成字段对官方叶子字段的 recall（字段名归一后比对）", "7 例（6.7.1.1 原文 None）"],
           ["L2 序列一致性", "与官方“方向+消息”序列的并排对照", "不计分（全库仅 16 个交换）"]],
          widths=[3.0, 8.4, 3.6])
    body_par(doc, "**为什么不报平均分**：n=8（L3 为 7），均值会把 14 个字段的用例与 2 个字段的用例等权，"
                  "制造一个不存在的“总体水平”，并掩盖 0 分样例。故一律呈现逐例矩阵，同时标注该例的答案规模。")
    body_par(doc, "对照实验：系统链路与“裸 prompt”基线使用**同一模型、同一温度、同一输入**，只差流程"
                  "（检索裁剪 / 结构化 IR / 校验器）。基线精确 L3 全 0，不是“什么都没写”，而是字段名不带 -rNN "
                  "版本后缀、或带路径前缀，与 gold 的精确名不同；relaxed 口径去掉路径前缀与 -rNN 后，基线并不弱。"
                  "因此产品优势表述为“ASN.1 精确 + 确定性可校验 + 允许弃权”，而不是“语义猜得更准”。")
    picture(doc, os.path.join(FIGDIR, "fig2-l3.png"), 14.0,
            "图 3  逐例 L3：不报平均数（n=6；6.7.1.1 原文 None，6.7.1.4 弃权）")
    table(doc,
          ["用例", "产品 L3（精确）", "基线 L3（精确）", "基线 L3（relaxed）"],
          [["6.7.1.10", "1.000", "0.000", "0.500"],
           ["6.7.1.12", "0.385", "0.000", "0.417"],
           ["6.7.1.2", "0.333", "0.000", "0.333"],
           ["6.7.1.3", "1.000", "0.000", "1.000"],
           ["6.7.1.4", "弃权", "0.000", "0.000"],
           ["6.7.1.5", "0.667", "0.000", "0.833"],
           ["6.7.1.6", "0.625", "0.000", "0.250"]],
          widths=[2.6, 4.0, 4.0, 4.4], font=Pt(8))

    heading(doc, "（六）实现质量", 2)
    bullet(doc, "**可复现**：提供复现脚本（scripts/），完整流程见附录；评测脚本开源，任何人可用自己的模型跑出可比结果。")
    bullet(doc, "**可替换**：模型调用收敛到单一入口，支持本地代理 / OpenAI 兼容 / Anthropic 官方三种通道，换厂商不改业务代码。")
    bullet(doc, "**可审计**：每次生成记录实际模型名、温度、输入摘要；分数默认标注“遮答案”。")
    bullet(doc, "**失败可见**：失败案例逐条公示，不隐藏低分样例；拒收产物只进 out_rejected/，不覆盖正式结果。")
    body_par(doc, "干净机器验收：克隆后双击 start.bat 即可浏览结果；一条命令 verify_clean.sh 完成 clone → 起服务 → "
                  "页面检查 → gold 0 违规 / 缺陷 31/31 / 真实错误盲测快照断言。前端为 React 构建产物，断网可用。")

    heading(doc, "三、创新点与差异化", 1)
    body_par(doc, "**创新点一：规范即标准答案。** 不从需求文档或模板出发，而是把 3GPP 条款本身作为 oracle；"
                  "评测时遮住答案，输入侧与答案侧物理隔离。**创新点二：确定性闸门。** 生成之后由 R1/R2/R3 逐条判定，"
                  "不合格拒收、信息不足弃权；校验器不调用模型，避免“模型自评”。**创新点三：真实错误集盲测。** "
                  "不只报自建注入模板的 31/31，还用真实模型输出标注 19 条错误，公开范围内 16/16、范围外 0/3 的边界。")
    table(doc,
          ["竞品类别", "能否生成测试意图", "能否自动判错", "能否复现分数", "证据来源"],
          [["① 通用大模型直接 prompt", "是（本作品实测基线）", "否：无校验环节", "部分：本作品可复跑该基线", "本作品实测"],
           ["② RAG 规范问答", "无公开可验证证据", "无公开可验证证据", "无公开可验证证据", "未获取"],
           ["③ 模板/脚本工具", "部分：依赖人工模板填参", "无公开可验证证据", "无公开可验证证据", "未获取"],
           ["④ TTCN-3 测试套件厂商", "否：面向已有套件执行与仿真", "无公开可验证证据", "否：商业套件不开放评测", "未获取"]],
          widths=[3.4, 3.0, 3.0, 3.0, 2.6], font=Pt(8))
    body_par(doc, "注：第 ②–④ 行为基于公开产品定位的推断，未获厂商证实；除第 ① 行外，本作品不掌握可验证的对照数据。",
             indent=False, size=Pt(9))
    body_par(doc, "**知识产权如实披露**：本作品暂无专利或软件著作权。16 天全部投入校验器与评测基建，未赶制软著登记；"
                  "真实性由可复现性担保——脚本、基准构建流程、逐例失败记录公开可跑。")

    heading(doc, "四、落地路径与应用前景", 1)
    body_par(doc, "以下为基于规范规模的间接推理，缺乏公开市场数据；涉及“谁在购买、能节省多少”的判断均标 [推断]，"
                  "不作为既定事实引用。")
    heading(doc, "（一）买单的人 [推断]", 2)
    table(doc,
          ["客户类型", "痛点", "本产品的位置"],
          [["测试仪表厂商（TTCN-3 套件供应方）", "用例编写与维护是长期人力成本", "缩短新特性用例的开发周期"],
           ["终端厂商协议测试团队", "规范每版更新，回归用例要跟着改", "规范变更 → 受影响用例的影响分析"],
           ["运营商测试中心/标准研究机构", "需要快速判断新用例覆盖了什么", "用例可读化、覆盖度报告"]],
          widths=[4.6, 5.8, 4.6])
    heading(doc, "（二）实施路径（先做窄的）", 2)
    bullet(doc, "**内部提效工具 [推断]**：面向单一 release、单一过程族，按“节省人天”计价；不给出单条用例人天数字，无公开来源。")
    bullet(doc, "**规范变更影响分析**：每次 release 更新跑一遍，输出“哪些用例受影响、影响在哪一层（消息/字段/步骤）”。这是订阅制形态。")
    bullet(doc, "**测试用例辅助开发平台**：与厂商自有 TTCN-3 工具链对接，成为 IDE/IaaS 插件。")
    heading(doc, "（三）规模推理（不给市场数字）", 2)
    body_par(doc, "公开市场数据未获取，因此只做间接推理：单份测试规范部件 TS 38.523-1 在 v19.6.0 上实测 1181 个用例；"
                  "Rel-15 至 Rel-19 每个 Release 均有新增，Rel-16 变更记录条目达 1355 条（条目数，非用例数）。"
                  "可确定的是，规范每轮 release 均有成批用例新增与修订，凡参与该环节的组织都承担这部分工作量；"
                  "市场空间取决于参与该环节的组织数，该数未获取。")

    heading(doc, "五、6G 相关性：冻结后迁移什么", 1)
    body_par(doc, "口径：6G 尚未标准化。项目基线采用“首个 6G 规范冻结约 2028-12”的公开时间表；本作品当前只在 "
                  "NR Rel-19 上验证，不宣称 6G 已实现。迁移的不是现在的 8 个用例，而是“规范条款 → 可执行测试意图 → "
                  "确定性校验 → 字段级证据”这条方法与流水线。")
    table(doc,
          ["6G 方向", "3GPP 里的当前对应物", "本作品已有的同构物", "6G 冻结后要补的"],
          [["NTN 测试", "TS 38.523-1 §6.7 NR NTN 空闲态小区选择/重选（当前 8 例）",
            "条款解析 → IR → 步骤/消息/IE → R1/R2/R3 → 逐例证据",
            "新 release 的 38.523/38.331 符号表；6G NTN 新流程用例切片"],
           ["AI 空口测试", "Rel-18 AI/ML for NR 研究、Rel-19 CSI/波束/定位的 AI/ML 规范化推进",
            "“测试目的 → 测试意图”的表达层；IE/字段/步骤覆盖的确定性校验",
            "AI/ML 生命周期模板；模型性能本身不在本工具范围"],
           ["网络自动化测试", "NWDAF（TS 23.288）、节能/移动性优化等网络自动化用例",
            "条款 → 意图 → 校验 → 证据的通用骨架；R3 可直接复用",
            "非 ASN.1 符号表适配器（HTTP/JSON schema、策略模型）"]],
          widths=[2.2, 4.2, 4.4, 4.2], font=Pt(8))
    body_par(doc, "为什么不是“蹭赛道”：当前验证的是 5G-Advanced，不是 6G；迁移的是可复用的工程物，不是口号；"
                  "边界写清楚——AI 空口的模型性能、6G 新空口的射频指标，不由本工具判定；本工具只判定“测试意图的结构、"
                  "字段、步骤覆盖是否与规范一致”。")
    body_par(doc, "6G 冻结后的 90 天迁移路线：第 1–2 周从首个 6G 测试规范抽取条款与 ASN.1/IDL 符号表；"
                  "第 3–6 周选 1 个 6G NTN 或 AI 空口用例做穿；第 7–10 周加非 ASN.1 适配器（网络自动化 JSON schema）；"
                  "第 11–13 周与测试团队做小规模评审。判据是“至少 1 个端到端用例 + 至少 1 名测试工程师确认字段级证据可用”。")

    heading(doc, "六、局限与风险", 1)
    table(doc,
          ["局限", "现状", "影响"],
          [["切片窄", "8 个用例、一个过程族", "不能宣称“覆盖 5G 测试”"],
           ["样本量小", "L3 共 42 个叶子字段，单例最低 2 个", "不报均值，只报逐例"],
           ["L2 不可用", "全库仅 16 个消息交换", "序列一致性只作定性展示"],
           ["符号表覆盖有限", "15 个消息；LTE 只做 R1", "未覆盖消息的 R2 跳过，可能漏检"],
           ["真实错误集仍非第三方", "19 条由作者标注，范围内 16/16", "不是独立盲测；范围外 3 条漏检已公示"],
           ["无知识产权", "无专利/软著", "靠可复现性担保"],
           ["未覆盖全链路", "未对接真实 TTCN-3 工具链、未输出 TTCN-3 代码", "距商用产品有明确差距"],
           ["团队规模小", "1 人；兼职投入；外部评审未完成", "迭代速度与背书受限"]],
          widths=[3.6, 6.6, 4.8], font=Pt(8.5))
    body_par(doc, "**风险与应对**：模型能力波动 → 固定记录模型名与温度，按“模型+版本”归档；规范格式变化 → "
                  "解析层与生成层解耦，换语料不改架构；被质疑“只是套壳” → 用校验器的误报数与真实错误集回答，"
                  "而不是用生成的流畅度。")

    heading(doc, "七、附录", 1)
    heading(doc, "（一）复现步骤", 2)
    body_par(doc, "仓库：`scripts/repro.sh` 一键跑通“规范 → 基准 → 生成 → 校验 → 评分”；`scripts/verify_clean.sh` "
                  "完成干净克隆、起服务、页面检查与快照断言。规范 PDF 需从 ETSI 自行下载（ADR-0003，仓库不附带）。", indent=False)
    table(doc,
          ["命令", "作用"],
          [["py -3 tools/validate.py data/gold_ir data/symbols/rrc_symbols.json data/validate/gold.json", "官方答案误报检查（应为 0）"],
           ["py -3 tools/inject.py data/gold_ir data/defects && py -3 tools/validate.py data/defects ...", "缺陷注入与检出（31/31）"],
           ["py -3 tools/blindset.py", "真实错误集盲测（写 results/blindset/）"],
           ["bash scripts/verify_clean.sh", "干净克隆自检（页面 + gold + 缺陷 + 盲测快照）"]],
          widths=[10.5, 4.5], font=Pt(8.5))
    heading(doc, "（二）指标口径与证据清单", 2)
    bullet(doc, "L1 = 8/8；逐例允许空 message；弃权例也计结构合法。")
    bullet(doc, "L3 分母 7 例（6.7.1.1 原文为 None）；只衡量字段召回，不衡量取值正确；relaxed 仅作诊断。")
    bullet(doc, "缺陷注入 31/31：自建 4 类模板（改名/清 TP/删 TP 步骤/塞假消息）；修正 4 条无效注入后重跑。")
    bullet(doc, "官方答案误报 0/8；真实错误集 16/19，范围内 16/16，范围外 0/3。")
    bullet(doc, "可复现边界：页面与快照可复现；模型生成需同模型同温度，L3 会波动。")
    heading(doc, "（三）文件索引", 2)
    table(doc,
          ["路径", "内容"],
          [["docs/ARCH.md", "架构与模块边界、接口契约"],
           ["docs/BASELINE.md", "项目基线（范围/交付/不可谈判项）"],
           ["docs/EVAL.md", "指标定义、分母、真实错误集盲测口径"],
           ["docs/6G-RELEVANCE.md", "6G 冻结后迁移对象一页"],
           ["docs/adr/", "决策记录：6G 定位、遮答案评测、规范不重分发、L3 主指标"],
           ["tools/", "解析器、IR 解析、生成、基线、校验、评分、盲测"],
           ["scripts/", "一键复现、干净克隆验收"]],
          widths=[5.5, 9.5], font=Pt(8.5))
    heading(doc, "（四）真实错误集 19 条（摘要）", 2)
    body_par(doc, "完整逐条见 results/blindset/report.md；下表列出 12 条范围内的代表性样本。", indent=False, size=Pt(9))
    ann_path = os.path.join(ROOT, "data", "blindset", "annotations.json")
    if not os.path.exists(ann_path):
        ann_path = os.path.join(ROOT, "results", "blindset", "annotations.json")
    ann = json.load(open(ann_path, encoding="utf-8"))
    rows = []
    for item in ann["core"]:
        if not item.get("in_scope"):
            continue
        rows.append([item["id"], item["case"], item["location"],
                     item["error"][:42] + ("…" if len(item["error"]) > 42 else ""),
                     item["expect_rule"]])
        if len(rows) >= 12:
            break
    table(doc, ["ID", "用例", "位置", "错误", "规则"], rows,
          widths=[1.0, 2.0, 3.8, 7.0, 1.2], font=Pt(7.5))
    body_par(doc, "注：标注在运行前固定；3 条范围外漏检（方向 N/A、Paging 顺序、缺 SIB4）不在上表。", indent=False, size=Pt(9))
    heading(doc, "（五）团队与协作", 2)
    body_par(doc, "当前 1 人完成产品、评测与文档，按兼职工时投入；工程协作者在招募中，尚未确认。"
                  "计划邀请 1 名测试工程师做 20 分钟评审并给出三句评价，用于补“落地/团队”两项；"
                  "截至提交日未完成，故不作为已获得的外部背书。")

    # --- 元数据 ---
    doc.core_properties.title = "Spec2Test：自证式测试意图编译器"
    doc.core_properties.subject = "人工智能+6G 青年创新创业大赛·创新产品赛道·技术方案"
    doc.core_properties.author = "Myun"
    doc.save(DOCX)
    print("wrote", DOCX)

    # --- Word 导出 PDF ---
    try:
        import win32com.client as win32
        word = win32.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        wdoc = word.Documents.Open(DOCX)
        wdoc.Fields.Update()
        for toc in wdoc.TablesOfContents:
            toc.Update()
        wdoc.Repaginate()
        wdoc.SaveAs(PDF, FileFormat=17)  # wdFormatPDF
        pages = wdoc.ComputeStatistics(2)  # wdStatisticPages
        wdoc.Close(False)
        word.Quit()
        print("wrote", PDF, "pages=", pages)
    except Exception as e:
        print("[warn] Word 导出失败：", type(e).__name__, e)
        print("可手动打开 DOCX 另存为 PDF；DOCX 已生成。")


if __name__ == "__main__":
    main()
