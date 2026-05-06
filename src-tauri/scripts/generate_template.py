#!/usr/bin/env python3
"""生成自定义学术论文参考模板 (reference.docx) for Pandoc.
需要: pip install python-docx
用法: python3 generate_template.py <output_path> [config_json]
如果未提供 config_json, 使用内置默认值。
"""

import json, sys, os, shutil, subprocess, tempfile

DEFAULTS = {
    "body_font": "SimSun",
    "body_font_latin": "Times New Roman",
    "heading_font": "SimHei",
    "code_font": "JetBrains Mono",
    "body_size": 12,           # pt
    "heading1_size": 18,
    "heading2_size": 15,
    "heading3_size": 13,
    "line_spacing": 1.5,
    "page_margin_cm": 2.5,
    "table_style": "three_line",  # three_line | full_grid
    "page_numbers": True,
    "indent_chars": 2,          # 首行缩进字符数，0=无缩进
    "paragraph_spacing": 0,     # 段间距 (pt)
    "heading_numbering": True,  # 标题自动编号
    "page_size": "A4",          # A4 or Letter
    "code_size": 10,            # 代码块字号
}

def main():
    if len(sys.argv) < 2:
        print("用法: python3 generate_template.py <output_path> [config_json]", file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]
    config = DEFAULTS.copy()
    if len(sys.argv) >= 3:
        config.update(json.loads(sys.argv[2]))

    # Step 1: Get base template from Pandoc
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        base_path = tmp.name
    try:
        result = subprocess.run(
            ["pandoc", "--print-default-data-file", "reference.docx"],
            check=True, capture_output=True
        )
        with open(base_path, 'wb') as f:
            f.write(result.stdout)
    except FileNotFoundError:
        print("错误: 未找到 pandoc，请先安装 pandoc", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError:
        print("错误: pandoc 生成基础模板失败", file=sys.stderr)
        os.unlink(base_path)
        sys.exit(1)

    # Step 2: Customize with python-docx
    try:
        from docx import Document
        from docx.shared import Pt, Cm, Inches
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.oxml.ns import qn, nsdecls
        from docx.oxml import parse_xml
    except ImportError:
        shutil.copy2(base_path, output_path)
        os.unlink(base_path)
        print("警告: 未安装 python-docx，已生成基础模板。运行 pip install python-docx 启用高级功能。")
        sys.exit(0)

    doc = Document(base_path)

    # ── Page margins ──
    margin = Cm(config["page_margin_cm"])
    for section in doc.sections:
        section.top_margin = margin
        section.bottom_margin = margin
        section.left_margin = margin
        section.right_margin = margin

    # ── Style definitions ──
    # Helper to set font on a run/paragraph
    def set_font(run, font_name, font_name_east, size_pt, bold=False):
        run.font.size = Pt(size_pt)
        run.font.bold = bold
        r = run._element
        rPr = r.find(qn('w:rPr'))
        if rPr is None:
            rPr = parse_xml(f'<w:rPr {nsdecls("w")}></w:rPr>')
            r.insert(0, rPr)
        # Latin font
        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is None:
            rFonts = parse_xml(f'<w:rFonts {nsdecls("w")}></w:rFonts>')
            rPr.append(rFonts)
        rFonts.set(qn('w:ascii'), font_name_east)
        rFonts.set(qn('w:hAnsi'), font_name_east)
        rFonts.set(qn('w:eastAsia'), font_name)

    # ── Modify Normal style ──
    style = doc.styles['Normal']
    style.paragraph_format.line_spacing = config["line_spacing"]
    pf = style.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(6)
    try:
        font = style.font
        font.size = Pt(config["body_size"])
        font.name = config["body_font_latin"]
        r = style.element.find(qn('w:rPr'))
        if r is not None:
            rFonts = r.find(qn('w:rFonts'))
            if rFonts is not None:
                rFonts.set(qn('w:eastAsia'), config["body_font"])
    except Exception:
        pass

    # ── Heading styles ──
    for level, size in [
        ("Heading 1", config["heading1_size"]),
        ("Heading 2", config["heading2_size"]),
        ("Heading 3", config["heading3_size"]),
    ]:
        try:
            style = doc.styles[level]
            style.font.size = Pt(size)
            style.font.bold = True
            style.font.name = config["heading_font"]
            style.paragraph_format.space_before = Pt(size * 0.8)
            style.paragraph_format.space_after = Pt(size * 0.4)
            r = style.element.find(qn('w:rPr'))
            if r is not None:
                rFonts = r.find(qn('w:rFonts'))
                if rFonts is not None:
                    rFonts.set(qn('w:eastAsia'), config["heading_font"])
        except Exception:
            pass

    # ── Table style: three-line table ──
    if config["table_style"] == "three_line":
        try:
            table_style = doc.styles['Table']
            t = table_style.element
            tblPr = t.find(qn('w:tblPr'))
            if tblPr is None:
                tblPr = parse_xml(f'<w:tblPr {nsdecls("w")}></w:tblPr>')
                t.append(tblPr)
            # Top border (thick)
            borders = tblPr.find(qn('w:tblBorders'))
            if borders is None:
                borders = parse_xml(f'<w:tblBorders {nsdecls("w")}></w:tblBorders>')
                tblPr.append(borders)
            top = borders.find(qn('w:top'))
            if top is None:
                top = parse_xml(f'<w:top {nsdecls("w")}></w:top>')
                borders.append(top)
            top.set(qn('w:val'), 'single')
            top.set(qn('w:sz'), '12')  # 1.5pt
            # Bottom border (thick)
            bottom = borders.find(qn('w:bottom'))
            if bottom is None:
                bottom = parse_xml(f'<w:bottom {nsdecls("w")}></w:bottom>')
                borders.append(bottom)
            bottom.set(qn('w:val'), 'single')
            bottom.set(qn('w:sz'), '12')
            # Remove left/right/inside borders
            for tag in ['left', 'right', 'insideH', 'insideV']:
                elem = borders.find(qn(f'w:{tag}'))
                if elem is not None:
                    elem.set(qn('w:val'), 'none')
        except Exception:
            pass

    # ── First line indent ──
    indent = config.get("indent_chars", 2)
    if indent > 0:
        style = doc.styles['Normal']
        pf = style.paragraph_format
        pf.first_line_indent = Cm(indent * 0.37)  # ~1 char ≈ 0.37cm at 12pt

    # ── Paragraph spacing ──
    para_spacing = config.get("paragraph_spacing", 0)
    if para_spacing > 0:
        style = doc.styles['Normal']
        pf = style.paragraph_format
        pf.space_after = Pt(para_spacing)

    # ── Page size ──
    page_size = config.get("page_size", "A4")
    for section in doc.sections:
        if page_size == "Letter":
            section.page_width = Cm(21.59)
            section.page_height = Cm(27.94)
        # A4 is default from Pandoc

    # ── Code block style ──
    code_size = config.get("code_size", 10)
    # Note: python-docx doesn't expose "Code" style easily via styles API.
    # We set it via XML manipulation on the style element.
    try:
        for style_name in ["Code", "Source Code"]:
            try:
                style = doc.styles[style_name]
                style.font.size = Pt(code_size)
                style.font.name = config.get("code_font", "JetBrains Mono")
                r = style.element.find(qn('w:rPr'))
                if r is not None:
                    rFonts = r.find(qn('w:rFonts'))
                    if rFonts is not None:
                        rFonts.set(qn('w:eastAsia'), config.get("body_font", "SimSun"))
            except KeyError:
                pass
    except Exception:
        pass

    # ── Heading numbering ──
    if config.get("heading_numbering", True):
        # Add numbering definition via XML (list-based numbering for headings)
        try:
            numbering_part = doc.part.numbering_part
            numbering = numbering_part.element
            # Check if numbering already exists
            numId = 1
            abstractNumId = 0
            # Add abstract numbering definition
            abstractNum = parse_xml(
                f'<w:abstractNum {nsdecls("w")} w:abstractNumId="{abstractNumId}">'
                f'  <w:multiLevelType w:val="hybridMultilevel"/>'
                f'  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>'
                f'  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'
                f'  <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2.%3"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>'
                f'</w:abstractNum>'
            )
            numbering.append(abstractNum)
            # Add num instance
            num = parse_xml(
                f'<w:num {nsdecls("w")} w:numId="{numId}"><w:abstractNumId w:val="{abstractNumId}"/></w:num>'
            )
            numbering.append(num)
            # Link heading styles to numbering
            for lvl, style_name in enumerate(["Heading 1", "Heading 2", "Heading 3"]):
                try:
                    style = doc.styles[style_name]
                    pPr = style.element.find(qn('w:pPr'))
                    if pPr is None:
                        pPr = parse_xml(f'<w:pPr {nsdecls("w")}></w:pPr>')
                        style.element.append(pPr)
                    numPr = pPr.find(qn('w:numPr'))
                    if numPr is None:
                        numPr = parse_xml(f'<w:numPr {nsdecls("w")}></w:numPr>')
                        pPr.append(numPr)
                    ilvl = numPr.find(qn('w:ilvl'))
                    if ilvl is None:
                        ilvl = parse_xml(f'<w:ilvl {nsdecls("w")}></w:ilvl>')
                        numPr.append(ilvl)
                    ilvl.set(qn('w:val'), str(lvl))
                    numId_el = numPr.find(qn('w:numId'))
                    if numId_el is None:
                        numId_el = parse_xml(f'<w:numId {nsdecls("w")}></w:numId>')
                        numPr.append(numId_el)
                    numId_el.set(qn('w:val'), str(numId))
                except Exception:
                    pass
        except Exception:
            pass

    # ── Page numbers ──
    if config["page_numbers"]:
        for section in doc.sections:
            footer = section.footer
            if footer.is_linked_to_previous:
                footer.is_linked_to_previous = False
            p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            # Add page number field
            run = p.add_run()
            fldChar1 = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="begin"/>')
            run._element.append(fldChar1)
            run2 = p.add_run()
            instrText = parse_xml(f'<w:instrText {nsdecls("w")} xml:space="preserve"> PAGE </w:instrText>')
            run2._element.append(instrText)
            run3 = p.add_run()
            fldChar2 = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="end"/>')
            run3._element.append(fldChar2)

    doc.save(output_path)
    os.unlink(base_path)
    print(f"已生成模板: {output_path}")

if __name__ == "__main__":
    main()
