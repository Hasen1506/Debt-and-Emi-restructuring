"""Golden check: 300 random lender quotes against closed-form formulas.

The offer comparison works month by month, the way a bank statement does
(rounding rule in engine/offer_compare.py). Each figure is checked here
against formulas written separately from the engine:

1. Every option's interest, full term and to the horizon, matches the
   closed form for the same whole-rupee EMI within ₹2. The only gap is
   the monthly interest rounded to the paisa (largest seen: about ₹1 over
   360 months). "Keep" is held to the same bound.
2. Against the textbook formula (unrounded EMI × months − principal) the
   gap is the saving from rounding the EMI up: δ × (s_n − n), where δ is
   the rounding (under ₹1) and s_n = ((1+r)^n − 1)/r. It can reach
   ₹1,500+ on a 30-year loan, so it is checked against that bound, not a
   flat figure. (The lost suite used "within ₹51"; that figure could not
   be reconstructed, so the bounds are now derived and stated.)
3. Up-front costs match exactly: fee or % of the outstanding rounded to
   the rupee, plus 18% GST rounded to the rupee when quoted "plus GST",
   plus stamp duty, legal and valuation, and any charge to close.
4. Savings, break-even months and the verdict follow from those figures.
"""
import random
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext

from engine.formulas import emi as formula_emi
from engine.offer_compare import (
    REFINANCE_MARGIN, Mode, OfferInput, RefinanceOffer, ResetOffer, compare_offers,
)

D = Decimal
TODAY = date(2026, 9, 26)
LEFTOVERS = re.compile(r"\bNone\b|\bnan\b|[{}]|₹-|-₹| \.| ,|\.\.")


def _rupee(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def closed_form(P: Decimal, rate: Decimal, E: Decimal):
    """Pay E a month until the loan is cleared, with exact interest.

    Balance after m payments: B_m = P·g^m − E·(g^m − 1)/r, g = 1 + r.
    The last payment is B_{k−1}·g, at the first k where that is ≤ E.
    Interest paid in the first m months is m·E − (P − B_m) before the end.
    Returns (months, interest_through(m) function).
    """
    with localcontext() as ctx:
        ctx.prec = 50
        r = rate / 12
        g = 1 + r

        def balance(m: int) -> Decimal:
            return P * g ** m - E * (g ** m - 1) / r

        lo, hi = 1, 2000
        while balance(hi - 1) * g > E:
            hi *= 2
        while lo < hi:                      # first k with B_{k-1}·g ≤ E
            mid = (lo + hi) // 2
            if balance(mid - 1) * g <= E:
                hi = mid
            else:
                lo = mid + 1
        k = lo
        total = E * (k - 1) + balance(k - 1) * g - P

        def interest_through(m: int) -> Decimal:
            if m >= k:
                return total
            return m * E - (P - balance(m))

    return k, interest_through


def _upfront(outstanding, amount, percent, plus_gst, extras=()):
    base = _rupee(outstanding * percent) if percent is not None else amount
    lines = []
    if base > 0:
        lines.append(base)
        if plus_gst:
            lines.append(_rupee(base * D("0.18")))
    lines += [x for x in extras if x > 0]
    return lines


def _quote(rng: random.Random) -> OfferInput:
    P = D(rng.randint(4, 800)) * D(25000)
    n = rng.randint(12, 360)
    current = D(rng.randint(700, 1150)) / D(10000)
    reset_rate = current - D(rng.randint(-10, 150)) / D(10000)
    use_pct = rng.random() < 0.4
    reset = ResetOffer(
        rate=reset_rate,
        fee=D(0) if use_pct else D(rng.choice([0, 5000, 10000, 25000, 50000, 90000])),
        fee_percent=D(rng.randint(10, 100)) / D(10000) if use_pct else None,
        fee_plus_gst=rng.random() < 0.6,
    ) if rng.random() < 0.85 else None
    use_pct = rng.random() < 0.4
    refinance = RefinanceOffer(
        rate=current - D(rng.randint(-20, 250)) / D(10000),
        lender=rng.choice([None, "SBI", "ICICI Bank", " "]),
        processing_fee=D(0) if use_pct else D(rng.choice([0, 3000, 10000, 25000])),
        processing_fee_percent=D(rng.randint(10, 100)) / D(10000) if use_pct else None,
        fee_plus_gst=rng.random() < 0.6,
        stamp_duty=D(rng.choice([0, 5000, 20000, 60000])),
        legal_and_valuation=D(rng.choice([0, 5000, 12000])),
        prepayment_charge=D(rng.choice([0, 0, 0, 20000])),
        months=rng.choice([None, None, None, min(360, n + 60), max(12, n - 24)]),
    ) if reset is None or rng.random() < 0.7 else None
    return OfferInput(
        outstanding=P, current_rate=current, months_left=n, as_of=TODAY,
        lender=rng.choice([None, "HDFC Bank", "Bank of Baroda"]),
        reset=reset, refinance=refinance,
        mode=Mode.SAME_EMI if rng.random() < 0.3 else Mode.LOWER_EMI,
        horizon_months=rng.choice([None, None, rng.randint(1, n)]),
        entitled_rate=current - D(rng.randint(10, 75)) / D(10000) if rng.random() < 0.3 else None,
    )


def test_stated_rules():
    """Constants the app's own wording depends on."""
    from engine.offer_compare import GST_RATE_IN
    assert GST_RATE_IN == D("0.18")
    assert REFINANCE_MARGIN == D("10000")


def test_300_quotes_against_the_formulas():
    rng = random.Random(20260926)
    verdicts = {"keep": 0, "reset": 0, "refinance": 0}
    worst_gap = D(0)
    for q in range(300):
        inp = _quote(rng)
        c = compare_offers(inp)
        verdicts[c.verdict] += 1
        h = c.horizon_months
        assert h == min(inp.horizon_months or inp.months_left, inp.months_left)
        P = inp.outstanding
        keep_E = c.option("keep").emi
        assert keep_E == formula_emi(P, inp.current_rate, inp.months_left).quantize(D("1"), rounding="ROUND_CEILING")

        base = c.option(c.baseline)
        for o in c.options:
            where = f"quote {q} {o.key}"
            # 1. Interest against the closed form for the same EMI.
            k, through = closed_form(P, o.rate, o.emi)
            assert k == o.months, where
            gap = abs(o.schedule.total_interest - through(k))
            worst_gap = max(worst_gap, gap)
            assert gap <= 2, f"{where}: {gap}"
            assert abs(o.schedule.interest_through(h) - through(h)) <= 2, where

            # 2. Against the textbook formula, when the EMI comes from the term.
            term = (inp.refinance.months if o.key == "refinance" and inp.refinance.months
                    else inp.months_left)
            if inp.mode is Mode.LOWER_EMI or o.key == "keep":
                exact = formula_emi(P, o.rate, term)
                assert o.emi == exact.quantize(D("1"), rounding="ROUND_CEILING"), where
                r = o.rate / 12
                s_n = ((1 + r) ** term - 1) / r
                bound = (o.emi - exact) * (s_n - term) + 2
                textbook = exact * term - P
                assert o.schedule.total_interest <= textbook + 2, where
                assert textbook - o.schedule.total_interest <= bound, where
            else:
                assert o.emi == keep_E, where

            # 3. Up-front costs, independently.
            if o.key == "reset":
                r_ = inp.reset
                want = _upfront(P, r_.fee, r_.fee_percent, r_.fee_plus_gst)
            elif o.key == "refinance":
                f = inp.refinance
                want = _upfront(P, f.processing_fee, f.processing_fee_percent, f.fee_plus_gst,
                                (f.stamp_duty, f.legal_and_valuation, f.prepayment_charge))
            else:
                want = []
            assert [x.amount for x in o.upfront] == want, where
            assert o.upfront_total == sum(want, D(0)), where

            # 4. Costs and savings.
            assert o.cost_to_horizon == _rupee(o.schedule.interest_through(h) + o.upfront_total), where
            assert o.interest_total == _rupee(o.schedule.total_interest), where
            assert abs(o.saving - (base.cost_to_horizon - o.cost_to_horizon)) <= 1, where
            if o.key in ("reset", "refinance"):
                be = o.break_even_month
                saved = [D(0)]
                for m in range(max(base.months, o.months)):
                    b = base.schedule.interest[m] if m < base.months else D(0)
                    x = o.schedule.interest[m] if m < o.months else D(0)
                    saved.append(saved[-1] + b - x)
                if o.upfront_total == 0:
                    assert be == 0, where
                elif be is None:
                    assert all(s < o.upfront_total for s in saved), where
                else:
                    assert saved[be] >= o.upfront_total > saved[be - 1], where
                    assert o.break_even_on.day == 1

        # The verdict follows the stated rules.
        reset, refi = c.option("reset"), c.option("refinance")
        reset_ok = reset is not None and reset.saving > 0
        refi_ok = refi is not None and refi.saving >= REFINANCE_MARGIN and (
            not reset_ok or refi.saving - reset.saving >= REFINANCE_MARGIN)
        assert c.verdict == ("refinance" if refi_ok else "reset" if reset_ok else "keep"), q

        for text in [c.headline, c.reason, c.next_step, *c.warnings, *c.notes]:
            m = LEFTOVERS.search(text)
            assert m is None, f"quote {q}: {m.group(0)!r} in {text!r}"
        assert c.reason, q

    # The generator must reach every verdict.
    assert min(verdicts.values()) >= 20, verdicts
    assert worst_gap <= 2
