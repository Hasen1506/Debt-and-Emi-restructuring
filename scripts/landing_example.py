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


def _chart(user: User, plan, mins, names: list[str]) -> dict:
    """The landing chart, drawn from the two runs in the page's 800×300 box:
    x from NOW (x=70) to a quarter past the plan's last month (x=790), y from
    the total owed now (y=44) to zero (y=258). The "only what's due" line is
    cut at the right edge, where it is still far from zero."""
    owed = float(sum(l.outstanding for l in user.loans))
    end = plan.debt_free_month or 480
    span = int(end * 1.25)
    px = lambda m: round(70 + 720 * m / span, 1)  # noqa: E731
    py = lambda b: round(258 - 214 * b / owed, 1)  # noqa: E731

    def path(res) -> str:
        pts = [(0, owed)] + [
            (r.month_index, float(sum(r.balances_by_loan_index.values())))
            for r in res.months if r.month_index <= span and (r.month_index % 3 == 0 or r.month_index == end)
        ]
        return "M" + " L".join(f"{px(m)},{py(b)}" for m, b in pts)

    payoffs = _payoffs(plan, names)
    markers = []
    for p in payoffs:
        m = p["month"]
        if m is None:
            continue
        row = plan.months[m - 1]
        markers.append({"loan": p["loan"], "label": p["label"], "x": px(m), "y": py(float(sum(row.balances_by_loan_index.values())))})
    years = sorted({_month_label(m)[-4:] for m in (1, span // 2, span)})
    mins_left = mins.months[min(span, len(mins.months)) - 1]
    return {
        "plan_path": path(plan),
        "due_path": path(mins),
        "markers": markers,
        "axis": {"mid": {"x": px(span // 2), "label": _month_label(span // 2)[-4:]}, "end": {"x": px(span), "label": _month_label(span)[-4:]}},
        "top_label_lakh_or_k": owed,
        "due_left_at_edge": str(round(float(sum(mins_left.balances_by_loan_index.values())))),
    }


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
        "chart": _chart(user, plan, mins, names),
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
    """'May 2032' → "MAY ’32"."""
    return f"{label[:3].upper()} ’{label[-2:]}" if label else "—"


def gen_register(c: str, f: dict) -> str:
    x = f[c]
    due = {r["loan"]: r["payment"] for r in x["plan"]["first_month_due"]}
    rows = []
    for i, r in enumerate(x["plan"]["first_month"]):
        extra = float(r["payment"]) - float(due[r["loan"]])
        card = r["loan"] == "Credit card"
        sub = (f"{money(c, due[r['loan']])} MINIMUM + {money(c, extra)} EXTRA" if card and extra >= 1
               else ("MINIMUM" if card else ("EMI" if c == "IN" else "PAYMENT")))
        top = ' top' if extra >= 1 else ''
        rows.append(
            f'        <div class="row{top}">\n'
            f'          <span class="n">{i + 1:02d}</span>\n'
            f'          <span><b>{r["loan"]}</b><span class="sub">{sub}</span></span>\n'
            f'          <span class="amt">{money(c, r["payment"])}</span>\n'
            f'          <span class="stamp" data-stamp>MARK PAID</span>\n'
            f'        </div>'
        )
    month = date(START.year, START.month, 1).strftime("%B").upper()
    total = sum(float(r["payment"]) for r in x["plan"]["first_month"])
    return (f'        <h3>PAY THIS MONTH · {month} <small>EXAMPLE</small></h3>\n' + "\n".join(rows) +
            f'\n        <div class="tot"><span>TOTAL THIS MONTH</span><b>{money(c, total)}</b></div>')


def gen_kpis(c: str, f: dict) -> str:
    x = f[c]
    v = x["vs_smallest_first"]
    sooner = v["months_sooner"]
    when = (f"{sooner} MO SOONER" if sooner > 0 else "SAME MONTH")
    return (
        f'      <div class="kpi"><div class="l">OUTSTANDING</div><div class="v">{money(c, x["outstanding"])}</div><div class="s">{x["loans"]} LOANS</div></div>\n'
        f'      <div class="kpi"><div class="l">DEBT-FREE</div><div class="v">{x["plan"]["debt_free"].upper()}</div><div class="s">AT {money(c, x["budget"])}/MO</div></div>\n'
        f'      <div class="kpi"><div class="l">INTEREST SAVED</div><div class="v" style="color:var(--pos)">{money(c, v["interest_saved"])}</div><div class="s">VS SMALLEST FIRST, SAME {money(c, x["budget"])}</div></div>\n'
        f'      <div class="kpi"><div class="l">DEBT-FREE DATE</div><div class="v" style="color:var(--accent)">{when}</div><div class="s">VS SMALLEST FIRST</div></div>'
    )


def gen_chart(c: str, f: dict) -> str:
    x = f[c]
    ch = x["chart"]
    marks, mlist = [], []
    cls = "abcd"
    for i, m in enumerate(ch["markers"]):
        name = m["loan"].replace("HDFC ", "").replace("SBI ", "").upper()
        last = i == len(ch["markers"]) - 1
        lab = f'DEBT-FREE · {mon(m["label"])}' if last else f'{name} · {mon(m["label"])}'
        if last:
            marks.append(f'<g class="mk {cls[min(i, 3)]}"><rect x="{m["x"] - 4}" y="{m["y"] - 4}" width="8" height="8" fill="#ab4f30"/>'
                         f'<text class="ml" x="{m["x"]}" y="{m["y"] + 18}" text-anchor="middle">{lab}</text></g>')
        else:
            ly = 140 + 22 * i
            marks.append(f'<g class="mk {cls[min(i, 3)]}"><line class="dl" x1="{m["x"]}" y1="{m["y"] + 4}" x2="{m["x"]}" y2="{ly - 10}" stroke="#ab4f30" stroke-dasharray="2 3"/>'
                         f'<rect x="{m["x"] - 4}" y="{m["y"] - 4}" width="8" height="8" fill="#ab4f30"/>'
                         f'<text class="ml" x="{m["x"] + 4}" y="{ly}">{lab}</text></g>')
        mlist.append(f'{m["loan"].lower() if not last else "debt-free"} {mon(m["label"])}')
    owed = float(x["outstanding"])
    left = money(c, ch["due_left_at_edge"])
    aria = (f'Example: total debt falls from {short_owed(c, owed)} now to zero in {x["plan"]["debt_free"]} on the plan; '
            f'paying only what is due still leaves {left} owed in {ch["axis"]["end"]["label"]}.')
    return (
        f'        <svg viewBox="0 0 800 300" role="img" aria-label="{aria}">\n'
        f'          <g font-family="IBM Plex Mono, monospace" font-size="11" fill="#5e5e58">\n'
        f'            <text x="8" y="16" letter-spacing="1.5">OUTSTANDING</text>\n'
        f'            <text class="yl" x="8" y="48">{short_owed(c, owed)}</text>\n'
        f'            <text class="yl" x="8" y="150">{short_owed(c, owed / 2)}</text>\n'
        f'            <text class="yl" x="8" y="262">{"₹0" if c == "IN" else "$0"}</text>\n'
        f'            <text x="70" y="290">NOW</text>\n'
        f'            <text x="{ch["axis"]["mid"]["x"] - 16}" y="290">{ch["axis"]["mid"]["label"]}</text>\n'
        f'            <text x="{ch["axis"]["end"]["x"] - 40}" y="290">{ch["axis"]["end"]["label"]}</text>\n'
        f'          </g>\n'
        f'          <line x1="70" y1="258" x2="790" y2="258" stroke="#0a0a0a" stroke-width="1"/>\n'
        f'          <path class="fade-line" d="{ch["due_path"]}" fill="none" stroke="#5e5e58" stroke-width="2" stroke-dasharray="6 5"/>\n'
        f'          <path class="draw" d="{ch["plan_path"]}" fill="none" stroke="#0a0a0a" stroke-width="2.5"/>\n'
        f'          <g font-family="IBM Plex Mono, monospace" font-size="10" font-weight="700" fill="#ab4f30" letter-spacing=".5">\n'
        + "\n".join(f"            {m}" for m in marks) +
        f'\n          </g>\n'
        f'          <text class="ml" x="560" y="40" font-family="IBM Plex Mono, monospace" font-size="10" fill="#5e5e58" letter-spacing=".5">ONLY WHAT&#39;S DUE: {left} LEFT →</text>\n'
        f'        </svg>\n'
        f'        <p class="mlist">{"Paid off: " + " · ".join(mlist)}. Paying only what&#39;s due: {left} still owed in {ch["axis"]["end"]["label"]}.</p>'
    )


def gen_due_note(c: str, f: dict) -> str:
    d = f[c]["vs_only_whats_due"]
    when = (f"until {d['debt_free']}" if d["debt_free"] else "more than 40 years (the card&#39;s minimum shrinks with the balance, so it never quite clears)")
    return (f'      <p class="note" style="margin-top:10px">The savings above compare two ways of paying the same {money(c, f[c]["budget"])} a month. '
            f'Paying only what&#39;s due (each EMI and the card&#39;s minimum, nothing extra) would take {when}: that is the most a plan can save, '
            f'not what it saves most people, so it isn&#39;t the headline. Worked out by RightDue&#39;s engine from the loans shown; '
            f'<a href="/glossary">what the terms mean</a>.</p>')


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
