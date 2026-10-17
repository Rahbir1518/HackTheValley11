"""One-page briefing PDF to bring to a community meeting.

`render(facts, snapshot)` lays out what Ordis already knows about one proposal: the 3D
snapshot from the viewer, the plain-language summary, what the application states versus
what Ordis estimated, sunlight lost, meetings and the City planner. Everything is shrunk to
fit a single Letter page. Neutral by design: it explains, it never argues.
"""
import datetime as dt
import html
import io
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Frame, Image, KeepInFrame, Paragraph, Spacer, Table, TableStyle

INK = colors.HexColor("#202322")
MUTED = colors.HexColor("#727773")
LINE = colors.HexColor("#DDDFDB")
SOFT = colors.HexColor("#F2F2EF")
SELECT = colors.HexColor("#E6EDF3")
PROP_INK = colors.HexColor("#566F87")
RUST = colors.HexColor("#A0331C")

PAGE_W, PAGE_H = letter
MARGIN = 0.5 * inch
WIDTH = PAGE_W - 2 * MARGIN

# A TrueType font with real Unicode coverage (≈, →, ², accents); the built-in PDF fonts lack them.
FONT_CANDIDATES = [
    ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/segoeuib.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"),
]


def _fonts() -> tuple[str, str, bool]:
    """(regular, bold, unicode) font names, registering a TTF once if one is available."""
    if "Ordis" in pdfmetrics.getRegisteredFontNames():
        return "Ordis", "Ordis-Bold", True
    for regular, bold in FONT_CANDIDATES:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("Ordis", regular))
            pdfmetrics.registerFont(TTFont("Ordis-Bold", bold))
            return "Ordis", "Ordis-Bold", True
    return "Helvetica", "Helvetica-Bold", False


ASCII = {"≈": "~", "→": "->", "−": "-", "≥": ">=", "≤": "<=", "“": '"', "”": '"'}


class _Styles:
    def __init__(self):
        self.regular, self.bold, self.unicode = _fonts()
        s = lambda name, **kw: ParagraphStyle(name, **({"fontName": self.regular, "textColor": INK} | kw))  # noqa: E731
        self.kicker = s("kicker", fontSize=7, leading=9, textColor=MUTED)
        self.title = s("title", fontName=self.bold, fontSize=19, leading=23)
        self.sub = s("sub", fontSize=8.5, leading=11, textColor=MUTED)
        self.h = s("h", fontName=self.bold, fontSize=7.5, leading=10, textColor=MUTED, spaceAfter=3)
        self.lead = s("lead", fontName=self.bold, fontSize=10.5, leading=13.5, spaceAfter=4)
        self.body = s("body", fontSize=8.5, leading=11.6)
        self.small = s("small", fontSize=7.5, leading=10, textColor=MUTED)
        self.quote = s("quote", fontSize=7.8, leading=10.4, leftIndent=6, textColor=INK)
        self.cell = s("cell", fontSize=8.3, leading=10.8)
        self.cell_r = s("cell_r", fontName=self.bold, fontSize=8.3, leading=10.8, alignment=TA_RIGHT)
        self.foot = s("foot", fontSize=6.6, leading=8.6, textColor=MUTED)

    def text(self, value) -> str:
        """Escaped text, with symbols the fallback font can't draw replaced."""
        t = html.escape(str(value), quote=False)
        if not self.unicode:
            for a, b in ASCII.items():
                t = t.replace(a, b)
            t = t.encode("latin-1", "replace").decode("latin-1")
        return t

    def markdown(self, value: str) -> str:
        """The Narrator writes light markdown: keep bold/italic and paragraphs, drop the rest."""
        t = self.text(value.strip())
        t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        t = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", t)
        t = re.sub(r"^#+\s*", "", t, flags=re.M)
        t = re.sub(r"^\s*[-•]\s+", "• ", t, flags=re.M)
        return re.sub(r"\n\s*\n", "<br/><br/>", t).replace("\n", " ")


# ------------------------------------------------------------------ wording helpers

def _hours(h: float) -> str:
    whole, minutes = int(h), round((h - int(h)) * 60)
    if minutes == 60:
        whole, minutes = whole + 1, 0
    if not whole:
        return f"{minutes} min"
    return f"{whole} h {minutes} min" if minutes else f"{whole} h"


def _day(iso: str) -> str:
    d = dt.date.fromisoformat(iso[:10])
    return f"{d.day} {d.strftime('%B %Y')}"


def _planner_name(raw: str | None) -> str | None:
    if not raw:
        return None
    last, _, first = raw.partition(",")
    return f"{first.strip()} {last.strip()}".strip() if first else raw.strip()


def _storeys_estimated(spec: dict) -> bool:
    return any(a["field"] == "total_storeys" for a in spec["assumptions"])


def stated_rows(spec: dict) -> list[tuple[str, str]]:
    rows = []
    towers = " & ".join(str(t["storeys"]) for t in spec["towers"]) or str(spec["total_storeys"])
    use = spec["use_type"].replace("-", " ").capitalize()
    rows.append(("Use", use))
    if not _storeys_estimated(spec):
        rows.append(("Storeys", towers))
    if spec["height_stated"]:
        rows.append(("Height", f"{spec['height_m']:g} m"))
    if spec.get("units") is not None:
        rows.append(("Homes", f"{spec['units']:,}"))
    if spec.get("gfa_m2") is not None:
        rows.append(("Floor area", f"{spec['gfa_m2']:,.0f} m²"))
    return rows


def estimated_lines(spec: dict) -> list[str]:
    """Same wording as the viewer's "Estimated · visible rules" box."""
    fields = {a["field"] for a in spec["assumptions"]}
    out = []
    if "total_storeys" in fields:
        out.append(f"About {spec['total_storeys']} storeys, from the stated height")
    if not spec["height_stated"]:
        if spec["towers"]:
            heights = " / ".join(f"≈{t['height_m']:.0f} m" for t in spec["towers"])
            out.append(f"Tower height{'s' if len(spec['towers']) > 1 else ''} {heights} ({spec['storey_height_m']:g} m floors)")
        else:
            out.append(f"Height ≈{spec['height_m']:.0f} m ({spec['storey_height_m']:g} m floors)")
    if "podium_storeys" in fields:
        out.append(f"Podium of {spec['podium_storeys']} storeys")
    if "tower_setback_m" in fields:
        out.append(f"Tower set back {spec['tower_setback_m']:g} m from the podium edge")
    out.append("Footprint from the property boundary (real setbacks unknown)")
    return out


# ------------------------------------------------------------------ layout

def _section(st: _Styles, title: str, body: list) -> list:
    return [Paragraph(st.text(title.upper()), st.h), *body]


def _rows_table(st: _Styles, rows: list[tuple[str, str]], width: float) -> Table:
    t = Table([[Paragraph(st.text(k), st.cell), Paragraph(st.text(v), st.cell_r)] for k, v in rows],
              colWidths=[width * 0.45, width * 0.55])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _box(content: list, width: float, background) -> Table:
    t = Table([[content]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def _columns(cols: list[list], widths: list[float], gap: float = 0.22 * inch) -> Table:
    cells, col_widths = [], []
    for i, (c, w) in enumerate(zip(cols, widths)):
        if i:
            cells.append("")
            col_widths.append(gap)
        cells.append(c)
        col_widths.append(w)
    t = Table([cells], colWidths=col_widths)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _snapshot(image: bytes, max_w: float, max_h: float) -> Image:
    reader = ImageReader(io.BytesIO(image))
    w, h = reader.getSize()
    scale = min(max_w / w, max_h / h)
    return Image(io.BytesIO(image), width=w * scale, height=h * scale)


def render(facts: dict, snapshot: bytes | None, today: dt.date | None = None) -> bytes:
    st = _Styles()
    app, spec, n = facts["application"], facts.get("spec"), facts.get("narration")
    inv, sun = facts["involved"], facts.get("sunlight")
    block, block_sun = facts.get("block"), facts.get("block_sunlight")
    today = today or dt.date.today()
    story: list = []

    # ---- header
    head = Table([[Paragraph(f"<font name='{st.bold}' color='#202322'>ORDIS</font> &nbsp; Community meeting briefing", st.kicker),
                   Paragraph(st.text(f"Prepared {_day(today.isoformat())} · open City of Toronto data"),
                             ParagraphStyle("r", parent=st.kicker, alignment=TA_RIGHT))]],
                 colWidths=[WIDTH * 0.5, WIDTH * 0.5])
    head.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [head, Spacer(1, 10), Paragraph(st.text(app["address"]), st.title),
              Paragraph(st.text(" · ".join(filter(None, [
                  app.get("type_name"), app.get("status"), app["app_number"],
                  f"submitted {app['date_submitted'][:10]}" if app.get("date_submitted") else None]))), st.sub),
              Spacer(1, 10)]

    # ---- snapshot + plain language
    left_w, right_w = WIDTH * 0.56, WIDTH * 0.44 - 0.22 * inch
    left = []
    if snapshot:
        left.append(_snapshot(snapshot, left_w, 2.75 * inch))
        caption = ("3D massing from the Ordis viewer: every active proposal nearby, as if built."
                   if block else "3D massing from the Ordis viewer.")
        left.append(Paragraph(st.text(caption + " An approximation, not an architectural rendering."), st.small))
    else:
        left.append(_box([Paragraph("No 3D snapshot was included.", st.small)], left_w - 16, SOFT))
    right = []
    if n:
        right.append(Paragraph(st.text(n["headline"]), st.lead))
        summary = n["summary"] if len(n["summary"]) < 1100 else n["summary"][:1100].rsplit(" ", 1)[0] + "…"
        right.append(Paragraph(st.markdown(summary), st.body))
        if n.get("template"):
            right.append(Paragraph("Summary written from a template (the AI narrator was unavailable).", st.small))
    elif spec:
        right.append(Paragraph(st.text(f"A {spec['use_type'].replace('-', ' ')} proposal."), st.lead))
    story += [_columns([left, _section(st, "In plain language", right)], [left_w, right_w]), Spacer(1, 12)]

    # ---- stated vs estimated
    if spec:
        col_w = (WIDTH - 0.22 * inch) / 2
        stated = [_rows_table(st, stated_rows(spec), col_w)]
        for q in spec.get("stated_facts", [])[:2]:
            stated += [Spacer(1, 4), Paragraph(st.text(f"“{q}”"), st.quote)]
        estimated = [Paragraph(st.text(f"• {line}"), st.cell) for line in estimated_lines(spec)]
        estimated += [Spacer(1, 4), Paragraph(st.text(
            f"{len(spec['assumptions'])} documented assumptions · Ordis is {round(spec['confidence'] * 100)}% sure "
            "the numbers describe the proposed building."), st.small)]
        story += [_columns([_section(st, "Stated in the application", stated),
                            _section(st, "Estimated by Ordis (visible rules)", [_box(estimated, col_w - 16, SELECT)])],
                           [col_w, col_w]), Spacer(1, 12)]

    # ---- sunlight
    if sun:
        col_w = (WIDTH - 0.22 * inch) / 2
        s = sun["stats"]
        mine = [Paragraph(st.text(f"{s['area_lost_1h_m2']:,} m² of ground loses at least an hour of direct sun "
                                  "because of this proposal."), st.body)]
        if s["max_hours_lost"] > 0:
            w = s["worst_point"]
            mine.append(Paragraph(st.text(f"Most affected spot: {_hours(w['sun_today_h'])} of sun today → "
                                          f"{_hours(max(0, w['sun_with_h']))} with the proposal."), st.body))
        for p in sun.get("affected_parcels", [])[:3]:
            mine.append(Paragraph(st.text(f"{p.get('address') or 'Neighbouring lot'}: "
                                          f"−{_hours(p['mean_hours_lost'])} on average"), st.cell))
        if block and block_sun:
            others = block["proposals"]
            b = block_sun["stats"]
            together = [Paragraph(st.text(
                f"With all {len(others) + 1} active proposals nearby built, {b['area_lost_1h_m2']:,} m² of ground "
                "loses at least an hour of direct sun."), st.body)]
            together += [Paragraph(st.text(
                f"{p['address']}: {'' if p['spec']['storeys_stated'] else '≈'}{p['spec']['total_storeys']} storeys "
                f"({'stated' if p['spec']['storeys_stated'] else 'estimated'}) · {p['status']}"), st.cell)
                for p in others[:5]]
            body = [_columns([mine, together], [col_w, col_w])]
        else:
            body = mine
        story += _section(st, f"Sunlight on {_day(sun['date'])} (clear sky, ground level)", body)
        story.append(Spacer(1, 12))

    # ---- take part
    col_w = (WIDTH - 2 * 0.22 * inch) / 3
    if inv["upcoming_meetings"]:
        meetings = [Paragraph(st.text(f"{_day(m['date'])} · {m.get('time') or 'time TBC'}"
                                      + (f" · {m['location']}" if m.get("location") else "")), st.cell)
                    for m in inv["upcoming_meetings"][:3]]
    else:
        last = inv["past_meetings"][-1]["date"] if inv["past_meetings"] else None
        meetings = [Paragraph(st.text("No upcoming meeting is listed in the City's data"
                                      + (f" (last: {_day(last)})." if last else ".")), st.cell)]
    name = _planner_name(inv["planner"].get("name"))
    planner = [Paragraph(st.text(name), st.cell)] if name else [Paragraph("No planner is listed.", st.cell)]
    for k in ("email", "phone"):
        if inv["planner"].get(k):
            planner.append(Paragraph(st.text(inv["planner"][k]), st.cell))
    record = [Paragraph(st.text(f"Quote application {app['app_number']} when you write or speak."), st.cell)]
    if inv.get("application_url"):
        record.append(Paragraph(f"<link href='{html.escape(inv['application_url'])}' color='#566F87'>"
                                "Application Information Centre</link>", st.cell))
    story += [_columns([_section(st, "Community meetings", meetings), _section(st, "City planner on this file", planner),
                        _section(st, "Official record", record)], [col_w] * 3), Spacer(1, 12)]

    # ---- footer
    sources = ", ".join(s["title"] for s in facts.get("sources", [])[:6])
    footer = [Paragraph(st.text(
        "Ordis explains; it does not take a position for or against this proposal. “Stated” means it appears in "
        "the City's application record; “estimated” means Ordis filled a gap with a documented rule."), st.foot),
        Paragraph(st.text("Limitations: " + " ".join(facts.get("limitations", [])[:4])
                          + " Shadows: clear sky, flat ground, not a daylight-compliance study."), st.foot)]
    if sources:
        footer.append(Paragraph(st.text(f"Sources: City of Toronto Open Data ({sources})."), st.foot))
    rule = Table([[""]], colWidths=[WIDTH], rowHeights=[1])
    rule.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.6, LINE)]))
    story += [rule, *footer]

    buf = io.BytesIO()
    from reportlab.pdfgen.canvas import Canvas

    c = Canvas(buf, pagesize=letter, pageCompression=1)
    c.setTitle(f"Ordis briefing: {app['address']}")
    c.setAuthor("Ordis")
    c.setSubject(f"Development application {app['app_number']}")
    frame = Frame(MARGIN, MARGIN, WIDTH, PAGE_H - 2 * MARGIN, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    frame.addFromList([KeepInFrame(WIDTH, PAGE_H - 2 * MARGIN, story, mode="shrink")], c)
    c.showPage()
    c.save()
    return buf.getvalue()
