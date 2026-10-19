"""The landing page's example plans, worked out by the engine (sprint G10).

Grill #44 / live-test #29: the old landing claimed "26 YRS 6 MO saved vs
paying only minimums", a straw-man baseline nobody could reproduce. Every
figure on web/public/welcome.html now comes from this script:

    python scripts/landing_example.py           # print the figures
    python scripts/landing_example.py --write   # rewrite web/src/lib/landing-example.json

engine/tests/test_landing_example.py fails when the JSON and the engine
disagree; web/tests/g10-product-surface.cjs fails when welcome.html and the
JSON disagree. Change a loan here, re-run with --write, then update the page.

Baselines, honest first:
  - headline: the same monthly budget, paid smallest balance first (Snowball).
    That's what the order alone is worth with no new money.
  - shown as a ceiling, never the headline: paying only what's due (EMIs and
    the card's minimum), the most a plan could save.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.models import Country, FilingStatusUS, IncomeType, Loan, LoanType, TaxRegimeIN, User  # noqa: E402
from engine.ordering import Strategy  # noqa: E402
from engine.simulation import baseline_minimums_only, simulate_plan  # noqa: E402

D = Decimal
OUT = ROOT / "web" / "src" / "lib" / "landing-example.json"
# The example's month 1 (the landing's "now"). Fixed so the figures don't
# drift with the calendar; the page labels them "an example".
START = date(2026, 10, 1)


def _india() -> tuple[User, list[str]]:
    loans = [
        Loan(LoanType.CREDIT_CARD, "Credit card", D("250000"), D("0.42"), "fixed", 0, D("0")),
        Loan(LoanType.PERSONAL, "Personal loan", D("150000"), D("0.14"), "fixed", 18, D("9500")),
        Loan(LoanType.AUTO, "HDFC car loan", D("600000"), D("0.095"), "fixed", 47, D("15100")),
        Loan(LoanType.HOME, "SBI home loan", D("3730000"), D("0.085"), "floating", 167, D("39400"),
             property_use="self_occupied"),
    ]
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1560000"), monthly_income=D("130000"), fixed_expenses=D("40000"),
        savings_balance=D("0"), primary_bank="SBI", tax_regime=TaxRegimeIN.NEW, loans=loans,
    )
    return user, [l.bank for l in loans]


def _usa() -> tuple[User, list[str]]:
    loans = [
        Loan(LoanType.CREDIT_CARD, "Credit card", D("12000"), D("0.24"), "fixed", 0, D("0")),
        Loan(LoanType.PERSONAL, "Personal loan", D("5000"), D("0.11"), "fixed", 22, D("250")),
        Loan(LoanType.AUTO, "Auto loan", D("22000"), D("0.075"), "fixed", 52, D("500")),
        Loan(LoanType.HOME, "Mortgage", D("240000"), D("0.065"), "fixed", 301, D("1650")),
    ]
    user = User(
        country=Country.US, income_type=IncomeType.SALARIED,
        annual_income=D("90000"), monthly_income=D("6200"), fixed_expenses=D("2800"),
        savings_balance=D("0"), primary_bank="Chase", filing_status=FilingStatusUS.SINGLE, loans=loans,
    )
    return user, [l.bank for l in loans]


def _month_label(m: int | None) -> str | None:
    if m is None:
        return None
    y, mo = divmod(START.month - 1 + m - 1, 12)
    return date(START.year + y, mo + 1, 1).strftime("%b %Y")


def _payoffs(res, names: list[str]) -> list[dict]:
    seen: dict[int, int] = {}
    for row in res.months:
        for i, bal in row.balances_by_loan_index.items():
            if i not in seen and bal <= D("0.5"):
                seen[i] = row.month_index
    return [{"loan": names[i], "month": seen.get(i), "label": _month_label(seen.get(i))} for i in range(len(names))]


def _first_payments(res, names: list[str]) -> list[dict]:
    first = res.months[0]
    return [{"loan": names[i], "payment": str(first.payments_by_loan_index.get(i, D("0")).quantize(D("1")))}
            for i in range(len(names))]


def _chart(user: User, plan, names: list[str]) -> dict:
    """The landing chart's data (UX50 A-02): the plan's total owed, month by
    month. gen_chart draws it twice (desktop and phone). "Paying only
    what's due" is no longer on the chart: it's a different comparison
    from the KPI strip (A-06), kept as a labelled ceiling in the note."""
    owed = float(sum(l.outstanding for l in user.loans))
    end = plan.debt_free_month or 480
    series = [[0, round(owed)]] + [
        [r.month_index, round(float(sum(r.balances_by_loan_index.values())))]
        for r in plan.months if r.month_index <= end
    ]
    return {"end_month": end, "owed": round(owed), "series": series}


def work_out(user: User, names: list[str], marginal: str) -> dict:
    kw = dict(horizon_months=480, marginal_rate=D(marginal), simulation_start_month=START.month)
    plan = simulate_plan(user, Strategy.AVALANCHE, **kw)
    snow = simulate_plan(user, Strategy.SNOWBALL, **kw)
    mins = baseline_minimums_only(user, horizon_months=480)
    budget = user.monthly_income - user.fixed_expenses
    return {
        "budget": str(budget),
        "outstanding": str(sum(l.outstanding for l in user.loans)),
        "loans": len(user.loans),
        "plan": {
            "debt_free_month": plan.debt_free_month,
            "debt_free": _month_label(plan.debt_free_month),
            "interest": str(plan.total_interest_paid.quantize(D("1"))),
            "payoffs": _payoffs(plan, names),
            "first_month": _first_payments(plan, names),
            # What's due in month 1 on each loan (EMIs, the card's minimum).
            "first_month_due": _first_payments(mins, names),
        },
        "chart": _chart(user, plan, names),
        "vs_smallest_first": {
            "debt_free": _month_label(snow.debt_free_month),
            "months_sooner": (snow.debt_free_month or 0) - (plan.debt_free_month or 0),
            "interest_saved": str((snow.total_interest_paid - plan.total_interest_paid).quantize(D("1"))),
        },
        # A ceiling, not the headline: the card's minimum alone may never
        # clear it (debt_free None = not within 40 years).
        "vs_only_whats_due": {
            "debt_free": _month_label(mins.debt_free_month),
            "debt_free_month": mins.debt_free_month,
        },
    }


def figures() -> dict:
    inu, inn = _india()
    usu, usn = _usa()
    return {
        "_note": "Worked out by scripts/landing_example.py from engine/; do not edit by hand.",
        "start": START.isoformat(),
        "IN": work_out(inu, inn, "0.312"),
        "US": work_out(usu, usn, "0.22"),
    }


if __name__ == "__main__":
    f = figures()
    text = json.dumps(f, indent=2) + "\n"
    if "--write" in sys.argv:
        OUT.write_text(text)
        print(f"wrote {OUT.relative_to(ROOT)}")
    print(text)


# ─── The page's generated parts (python scripts/landing_example.py --html) ──
WELCOME = ROOT / "web" / "public" / "welcome.html"


def inr(v) -> str:
    s = str(int(round(float(v))))
    last, rest = s[-3:], s[:-3]
    out = ""
    while len(rest) > 2:
        out = "," + rest[-2:] + out
        rest = rest[:-2]
    return "₹" + (rest + out + "," if rest else out.lstrip(",") + ("," if out else "")) + last if rest or out else "₹" + last


def usd(v) -> str:
    return "${:,.0f}".format(float(v))


def money(c: str, v) -> str:
    return inr(v) if c == "IN" else usd(v)


def short_owed(c: str, v) -> str:
    v = float(v)
    return f"₹{v / 1e5:.1f}L" if c == "IN" else f"${v / 1e3:.0f}k"


def mon(label: str | None) -> str:
    """Short month, unchanged: 'May 2032'. Never 'MAY ’32'."""
    return label if label else "—"


def gen_register(c: str, f: dict) -> str:
    x = f[c]
    due = {r["loan"]: r["payment"] for r in x["plan"]["first_month_due"]}
    rows = []
    for i, r in enumerate(x["plan"]["first_month"]):
        extra = float(r["payment"]) - float(due[r["loan"]])
        card = r["loan"] == "Credit card"
        sub = (f"{money(c, due[r['loan']])} MINIMUM + {money(c, extra)} EXTRA" if card and extra >= 1
               else ("MINIMUM" if card else ("EMI" if c == "IN" else "PAYMENT")))
        # UX50 A-08: "first", not "top" (the masthead's .top gave this row a
        # 6px black slab and a notch). The stamp is a decoration (A-24).
        first = ' first' if extra >= 1 else ''
        rows.append(
            f'        <div class="row{first}">\n'
            f'          <span class="n">{i + 1:02d}</span>\n'
            f'          <span><b>{r["loan"]}</b><span class="sub">{sub}</span></span>\n'
            f'          <span class="amt">{money(c, r["payment"])}</span>\n'
            f'          <span class="stamp" data-stamp aria-hidden="true">MARK PAID</span>\n'
            f'        </div>'
        )
    month = date(START.year, START.month, 1).strftime("%b %Y")
    total = sum(float(r["payment"]) for r in x["plan"]["first_month"])
    return (f'        <h3>PAY THIS MONTH · {month} <small>EXAMPLE</small></h3>\n' + "\n".join(rows) +
            f'\n        <div class="tot"><span>TOTAL THIS MONTH</span><b>{money(c, total)}</b></div>')


def gen_kpis(c: str, f: dict) -> str:
    """UX50 A-06: one baseline in the strip (smallest first, same budget).
    The old 4th KPI ("DEBT-FREE DATE · SAME MONTH", in the accent colour)
    read like a warning and repeated KPI 2; it now says where this month's
    extra goes."""
    x = f[c]
    v = x["vs_smallest_first"]
    due = {r["loan"]: float(r["payment"]) for r in x["plan"]["first_month_due"]}
    extra = sorted(((float(r["payment"]) - due[r["loan"]], r["loan"]) for r in x["plan"]["first_month"]), reverse=True)[0]
    sooner = v["months_sooner"]
    when = f", {sooner} MO SOONER" if sooner > 0 else ""
    return (
        f'      <div class="kpi"><div class="l">OUTSTANDING</div><div class="v">{money(c, x["outstanding"])}</div><div class="s">{x["loans"]} LOANS</div></div>\n'
        f'      <div class="kpi"><div class="l">DEBT-FREE BY</div><div class="v">{x["plan"]["debt_free"]}</div><div class="s">AT {money(c, x["budget"])}/MO</div></div>\n'
        f'      <div class="kpi"><div class="l">INTEREST SAVED</div><div class="v" style="color:var(--pos)">{money(c, v["interest_saved"])}</div><div class="s">VS SMALLEST FIRST, SAME {money(c, x["budget"])}{when}</div></div>\n'
        f'      <div class="kpi"><div class="l">EXTRA THIS MONTH</div><div class="v">{money(c, extra[0])}</div><div class="s">ALL OF IT TO THE {extra[1].upper()}</div></div>'
    )


# ─── Landing chart (UX50 A-02) ────────────────────────────────────────────
# The old chart put leader labels inside the plot and an automatic placer
# kept them from colliding, but not from pointing at the wrong label (A-01).
# Now: one line (the plan), round y ticks with gridlines, a y-axis line, a
# direct "₹0 · May 2032" label at the line's end, and the payoffs on a strip
# under the x-axis. Each payoff is one square on the line (payoffs within
# MERGE_MONTHS share one square and one label, A-05), a faint guide drops
# from the square to the strip, and the label hangs off that guide like a
# flag: the guide runs down the label's own edge, so a label can only
# belong to one square. The strip is 1-D, so the solver is a brute-force
# pick of side (right/left of the guide) and row for each label.
#
# Below 520px the page shows a second, phone-sized SVG drawn at 1:1 (12px
# text) and the payoffs as a list (A-02 item 6, A-03).
#
# Units are the SVG's viewBox units. Labels are IBM Plex Mono 12 with .5
# letter-spacing: 0.6em + .5 a character, padded 4% for a fallback mono.
import math

LABEL_FS = 12
LINE_H = 14
MERGE_MONTHS = 3
DESK = {"w": 800, "x0": 84, "x1": 680, "y0": 30, "y1": 226, "year_y": 244, "strip_y": 258, "sq": 9}
PHONE = {"w": 330, "h": 168, "x0": 50, "x1": 318, "y0": 14, "y1": 132, "year_y": 152, "sq": 10}
FLAG_GAP = 5      # guide → label text
ROW_GAP = 8       # between two strip rows
INK, RUST, MUTED, GRID, HL2 = "#0a0a0a", "#ab4f30", "#5e5e58", "#e6e4da", "#fff3c4"


def text_w(s: str, fs: float = LABEL_FS) -> float:
    return round(len(s) * (0.6 * fs + 0.5) * 1.04, 1)


def _overlap(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _grow(b, dx, dy=None):
    dy = dx if dy is None else dy
    return (b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy)


def _vhit(x, y0, y1, box) -> bool:
    """Does the vertical segment x, y0→y1 touch box?"""
    return box[0] <= x <= box[2] and min(y0, y1) <= box[3] and max(y0, y1) >= box[1]


def _seg_hit(p, q, box) -> bool:
    """Does segment p→q touch box (x0, y0, x1, y1)? Liang–Barsky."""
    (x0, y0), (x1, y1) = p, q
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for pp, qq in ((-dx, x0 - box[0]), (dx, box[2] - x0), (-dy, y0 - box[1]), (dy, box[3] - y0)):
        if pp == 0:
            if qq < 0:
                return False
            continue
        t = qq / pp
        if pp < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return False
    return True


def nice_max(v: float) -> float:
    k = 10 ** math.floor(math.log10(v))
    for m in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * k >= v:
            return m * k
    return 10 * k


def axis_money(c: str, v: float) -> str:
    if v == 0:
        return "₹0" if c == "IN" else "$0"
    return f"₹{v / 1e5:g}L" if c == "IN" else f"${v / 1e3:g}k"


def _short_name(loan: str) -> str:
    return loan.upper()


def _range(a: str, b: str, title: bool = False) -> str:
    """'Oct 2027', 'Nov 2027' → "Oct–Nov 2027"; across years "Nov 2027–Jan 2028"."""
    del title
    if a == b:
        return a
    if a[-4:] == b[-4:]:
        return f"{a[:3]}–{b[:3]} {b[-4:]}"
    return f"{a}–{b}"


def clusters(x: dict) -> list[dict]:
    """Payoffs in month order; ones within MERGE_MONTHS of the previous one
    in the same cluster share a square and a label."""
    ps = sorted(x["plan"]["payoffs"], key=lambda p: p["month"])
    out: list[dict] = []
    for p in ps:
        if out and p["month"] - out[-1]["months"][-1] <= MERGE_MONTHS:
            out[-1]["loans"].append(p["loan"])
            out[-1]["months"].append(p["month"])
            out[-1]["labels"].append(p["label"])
        else:
            out.append({"loans": [p["loan"]], "months": [p["month"]], "labels": [p["label"]]})
    end = x["plan"]["debt_free_month"]
    for cl in out:
        cl["month"] = cl["months"][-1]
        cl["final"] = cl["month"] == end
        when = _range(cl["labels"][0], cl["labels"][-1])
        names = [_short_name(n) for n in cl["loans"]]
        lines = [n + " +" for n in names[:-1]] + [names[-1]]
        cl["lines"] = lines + [f"{when} · DEBT-FREE" if cl["final"] else when]
        first, rest = cl["loans"][0], [_lower_first(n) for n in cl["loans"][1:]]
        cl["list_name"] = " + ".join([first] + rest)
        cl["list_when"] = _range(cl["labels"][0], cl["labels"][-1], title=True)
    return out


def _year_ticks(end: int, step: int) -> list[tuple[int, str]]:
    first = (13 - START.month) % 12 + 1  # month index of the first January
    out = []
    m = first
    while m <= end:
        lab = _month_label(m)
        if int(lab[-4:]) % step == 0 or step == 1:
            out.append((m, lab[-4:]))
        m += 12
    return out


def chart_geometry(c: str, f: dict, spec: dict, phone: bool = False) -> dict:
    """Every mark and text box of one drawing, for gen_chart and the tests."""
    x = f[c]
    ch = x["chart"]
    end, owed = ch["end_month"], ch["owed"]
    top = nice_max(owed)
    x0, x1, y0, y1 = spec["x0"], spec["x1"], spec["y0"], spec["y1"]
    px = lambda m: round(x0 + (x1 - x0) * m / end, 1)  # noqa: E731
    py = lambda b: round(y1 - (y1 - y0) * b / top, 1)  # noqa: E731
    bal = {m: b for m, b in ch["series"]}
    pts = [(px(m), py(b)) for m, b in ch["series"]]
    cls = clusters(x)
    markers = [{"x": px(cl["month"]), "y": py(bal[cl["month"]]), "cluster": cl} for cl in cls]
    texts: list[dict] = []  # every text box: {"kind", "text", "box"}

    def add(kind, text, tx, ty, anchor="start", fs=LABEL_FS, **kw):
        w = text_w(text, fs)
        bx0 = tx if anchor == "start" else (tx - w if anchor == "end" else tx - w / 2)
        t = {"kind": kind, "text": text, "x": round(tx, 1), "y": round(ty, 1), "anchor": anchor, "fs": fs,
             "box": (round(bx0, 1), round(ty - 0.9 * fs, 1), round(bx0 + w, 1), round(ty + 0.25 * fs, 1)), **kw}
        texts.append(t)
        return t

    yticks = [top, top / 2, 0]
    for v in yticks:
        add("ytick", axis_money(c, v), x0 - 8, py(v) + 4, "end")

    labels: list[dict] = []
    H = spec.get("h", 0)
    if not phone:
        labels = _place_strip(markers, spec)
        for lab in labels:
            texts.extend(lab["texts"])
        H = max(t["box"][3] for t in texts) + 6
        # The direct label at the end of the line.
        df = add("direct", f'{axis_money(c, 0)} · {mon(x["plan"]["debt_free"])}', x1 + 12, y1 - 8, "start")
        df["bold"] = True
    # x axis: the start month, then Januaries.
    add("xtick", mon(_month_label(1)), x0, spec["year_y"], "start")
    span_years = end / 12
    step = (1 if span_years <= 8 else 2) if not phone else (2 if span_years <= 8 else 3)
    guides = [(m["x"], m["y"], lab["pole_bottom"]) for m, lab in zip(markers, labels)] if labels else []
    for m, yr in _year_ticks(end, step):
        t = {"box": None}
        tx = px(m)
        w = text_w(yr)
        box = (tx - w / 2, spec["year_y"] - 0.9 * LABEL_FS, tx + w / 2, spec["year_y"] + 3)
        if box[2] > spec["w"] - 2 or any(_overlap(_grow(box, 6, 0), o["box"]) for o in texts):
            continue
        if any(_vhit(gx, gy, gb, _grow(box, 3)) for gx, gy, gb in guides):
            continue
        t = add("xtick", yr, tx, spec["year_y"], "middle")
    return {"spec": spec, "w": spec["w"], "h": round(H, 1), "top": top, "yticks": [(v, py(v)) for v in yticks],
            "pts": pts, "markers": markers, "labels": labels, "texts": texts, "guides": guides,
            "x0": x0, "x1": x1, "y0": y0, "y1": y1}


def _place_strip(markers: list[dict], spec: dict) -> list[dict]:
    """Pick a side (label right or left of its guide) and a row for every
    payoff label, cheapest first; raises if nothing fits."""
    W, sy = spec["w"], spec["strip_y"]
    max_lines = max(len(m["cluster"]["lines"]) for m in markers)
    row_top = [sy + 8, sy + 8 + max_lines * LINE_H + ROW_GAP]

    def option(m, side, row):
        lines = m["cluster"]["lines"]
        w = max(text_w(t) for t in lines)
        top = row_top[row]
        bot = top + len(lines) * LINE_H
        bx0 = m["x"] + FLAG_GAP if side == "start" else m["x"] - FLAG_GAP - w
        box = (round(bx0, 1), top, round(bx0 + w, 1), bot)
        if box[0] < 4 or box[2] > W - 4:
            return None
        return {"marker": m, "side": side, "row": row, "box": box, "pole_bottom": bot,
                "cost": row * 100 + (0 if side == "start" else 1)}

    opts = [[o for s in ("start", "end") for r in (0, 1) if (o := option(m, s, r))] for m in markers]

    def ok(a, b) -> bool:
        if _overlap(_grow(a["box"], 10, 3), b["box"]):
            return False
        # A guide never crosses another label.
        for p, q in ((a, b), (b, a)):
            if _vhit(p["marker"]["x"], p["marker"]["y"], p["pole_bottom"], _grow(q["box"], 8, 2)):
                return False
        return True

    best = {"cost": math.inf, "set": None}

    def search(i, chosen, cost):
        if cost >= best["cost"]:
            return
        if i == len(opts):
            best.update(cost=cost, set=list(chosen))
            return
        for o in opts[i]:
            if all(ok(o, p) for p in chosen):
                search(i + 1, chosen + [o], cost + o["cost"])

    search(0, [], 0)
    if best["set"] is None:
        raise SystemExit("landing chart: no room on the strip for every payoff label")
    out = []
    for o in best["set"]:
        tx = o["marker"]["x"] + FLAG_GAP if o["side"] == "start" else o["marker"]["x"] - FLAG_GAP
        o["texts"] = []
        for i, line in enumerate(o["marker"]["cluster"]["lines"]):
            ty = o["box"][1] + LINE_H * (i + 1) - 3.5
            w = text_w(line)
            bx0 = tx if o["side"] == "start" else tx - w
            o["texts"].append({"kind": "strip", "text": line, "x": round(tx, 1), "y": round(ty, 1),
                               "anchor": o["side"], "fs": LABEL_FS, "date": i == len(o["marker"]["cluster"]["lines"]) - 1,
                               "box": (round(bx0, 1), round(ty - 0.9 * LABEL_FS, 1), round(bx0 + w, 1), round(ty + 0.25 * LABEL_FS, 1))})
        out.append(o)
    return out


def _svg_text(t: dict, fill: str = MUTED, bold: bool = False) -> str:
    anchor = {"start": "start", "end": "end", "middle": "middle"}[t["anchor"]]
    w = ' font-weight="700"' if bold else ""
    return f'<text x="{t["x"]}" y="{t["y"]}" text-anchor="{anchor}" fill="{fill}"{w}>{t["text"]}</text>'


def _svg(c: str, g: dict, phone: bool) -> str:
    x0, x1, y0, y1, sq = g["x0"], g["x1"], g["y0"], g["y1"], g["spec"]["sq"]
    line = "M" + " L".join(f"{a},{b}" for a, b in g["pts"])
    area = line + f" L{x1},{y1} L{x0},{y1} Z"
    out = []
    for v, yy in g["yticks"]:
        if v:
            out.append(f'<line x1="{x0}" y1="{yy}" x2="{x1}" y2="{yy}" stroke="{GRID}" stroke-width="1"/>')
    out.append(f'<path class="fill" d="{area}" fill="{HL2}"/>')
    out.append(f'<line x1="{x0}" y1="{y0 - 8}" x2="{x0}" y2="{y1}" stroke="{INK}" stroke-width="1"/>')
    out.append(f'<line x1="{x0}" y1="{y1}" x2="{x1}" y2="{y1}" stroke="{INK}" stroke-width="1"/>')
    if not phone:
        sy = g["spec"]["strip_y"]
        out.append(f'<line x1="{x0}" y1="{sy}" x2="{x1}" y2="{sy}" stroke="{GRID}" stroke-width="1"/>')
    out.append(f'<path class="draw" d="{line}" fill="none" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>')
    txt = [_svg_text(t) for t in g["texts"] if t["kind"] in ("ytick", "xtick")]
    out.append(f'<g font-family="IBM Plex Mono, monospace" font-size="{LABEL_FS}">' + "".join(txt) + "</g>")
    cls = "abcd"
    for i, m in enumerate(g["markers"]):
        k = cls[min(i, 3)] if i < len(g["markers"]) - 1 else "d"
        parts = []
        if not phone:
            lab = g["labels"][i]
            sy = g["spec"]["strip_y"]
            parts.append(f'<line x1="{m["x"]}" y1="{round(m["y"] + sq / 2 + 2, 1)}" x2="{m["x"]}" y2="{sy - 4}" stroke="{RUST}" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>')
            parts.append(f'<line x1="{m["x"]}" y1="{sy - 4}" x2="{m["x"]}" y2="{lab["pole_bottom"]}" stroke="{RUST}" stroke-width="1.5"/>')
            parts.append("".join(_svg_text(t, RUST if t["date"] else INK, True) for t in lab["texts"]))
        parts.append(f'<rect x="{round(m["x"] - sq / 2, 1)}" y="{round(m["y"] - sq / 2, 1)}" width="{sq}" height="{sq}" fill="{RUST}"/>')
        out.append(f'<g class="mk {k}" font-family="IBM Plex Mono, monospace" font-size="{LABEL_FS}" letter-spacing=".5">' + "".join(parts) + "</g>")
    for t in g["texts"]:
        if t["kind"] == "direct":
            out.append(f'<g class="mk d" font-family="IBM Plex Mono, monospace" font-size="{LABEL_FS}" letter-spacing=".5">{_svg_text(t, RUST, True)}</g>')
    return "\n            ".join(out)


def gen_chart(c: str, f: dict) -> str:
    x = f[c]
    desk = chart_geometry(c, f, DESK)
    ph = chart_geometry(c, f, PHONE, phone=True)
    cls = clusters(x)
    owed = float(x["outstanding"])
    paid = "; ".join(f'{cl["list_name"]} paid off {cl["list_when"]}' for cl in cls)
    aria = (f'Example: the total owed falls from {short_owed(c, owed)} in {_month_label(1)} to zero in '
            f'{x["plan"]["debt_free"]}. {paid}.')
    items = "".join(f'\n          <li><span>{cl["list_name"]}</span><b>paid off {cl["list_when"]}</b></li>' for cl in cls)
    return (
        f'        <p class="ctitle">Debt-free in <b>{x["plan"]["debt_free"]}</b>, paying {money(c, x["budget"])} a month.</p>\n'
        f'        <svg class="cdesk" viewBox="0 0 {desk["w"]} {desk["h"]}" role="img" aria-label="{aria}">\n'
        f'            {_svg(c, desk, False)}\n'
        f'        </svg>\n'
        f'        <svg class="cphone" viewBox="0 0 {ph["w"]} {ph["h"]}" aria-hidden="true">\n'
        f'            {_svg(c, ph, True)}\n'
        f'        </svg>\n'
        f'        <ol class="mlist" aria-label="When each loan is paid off">{items}\n'
        f'          <li class="df"><span>Debt-free</span><b>{x["plan"]["debt_free"]}</b></li>\n'
        f'        </ol>'
    )


def _lower_first(name: str) -> str:
    """Live re-test 2 R2-5: "Credit card" → "credit card", but "HDFC car
    loan" keeps the lender's capitals."""
    first, _, rest = name.partition(" ")
    if len(first) > 1 and first.isupper():
        return name
    return first[:1].lower() + first[1:] + (" " + rest if rest else "")


def gen_due_note(c: str, f: dict) -> str:
    """UX50 A-21: one line; the minimums-only ceiling sits behind "How we
    compare" instead of a 60-word paragraph."""
    d = f[c]["vs_only_whats_due"]
    when = (f"until {d['debt_free']}" if d["debt_free"] else "more than 40 years (the card&#39;s minimum shrinks with the balance, so it never quite clears)")
    b = money(c, f[c]["budget"])
    return (f'      <details class="note cmp"><summary>Compared with paying the same {b} a month, smallest balance first. '
            f'<span class="how">How we compare</span></summary>\n'
            f'      <p>Paying only what&#39;s due (each EMI and the card&#39;s minimum, nothing extra) would take {when}: '
            f'that is the most a plan can save, not what it saves most people, so it isn&#39;t the headline. '
            f'Worked out by RightDue&#39;s engine from the loans shown; <a href="/glossary">what the terms mean</a>.</p></details>')


GENERATORS = {"register": gen_register, "kpis": gen_kpis, "chart": gen_chart, "due-note": gen_due_note}


def render_html(html: str, f: dict) -> str:
    import re
    for c in ("IN", "US"):
        for key, gen in GENERATORS.items():
            start, end = f"<!-- gen:{key}-{c} -->", f"<!-- /gen:{key}-{c} -->"
            rx = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
            if not rx.search(html):
                raise SystemExit(f"welcome.html is missing {start}")
            html = rx.sub(lambda _m: f"{start}\n{gen(c, f)}\n{end}", html)
    return html


if __name__ == "__main__" and "--html" in sys.argv:
    f = json.loads(OUT.read_text())
    WELCOME.write_text(render_html(WELCOME.read_text(), f))
    print(f"wrote {WELCOME.relative_to(ROOT)}")
