"""Plan insights (audit 80+ A1, A2, A4, A5, A6, "Don't sign that").

POST /api/insights/plan          where RightDue disagrees with a plain calculator (A1),
                                 whether the payoff order matters (A2), the monthly gap and
                                 three ways to close it (A5), and the "cheaper way to carry
                                 this" card (A6), on the same body as /simulate.
POST /api/insights/prepay-invest once only cheap debt is left: prepay, keep, or split (A4).
POST /api/insights/consolidation the A6 card at the user's own quote, tenure and fee.
POST /api/insights/offer-check   a top-up, loan or no-cost EMI offer against the plan.

Every run uses the plan's own settings (api/routes/simulation._plan_kwargs),
so the figures match Plan and Home. Published personal-loan rates come from
the committed rate-disclosure file (banks' own pages, RBI/2014-15/422 para
2(a)); a bank's floor is never used as the user's rate.
"""
from __future__ import annotations

import json
from copy import deepcopy
from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api.routes.simulation import ENGINE_STOP_MULTIPLE, _plan_kwargs
from api.schemas import Amount, SimulateRequest, _Base, _In
from engine.consolidation import (
    DEFAULT_TENURE_MONTHS, NEUTRALITY, ConsolidationInputError, PublishedRange, consolidate,
    consolidation_card, published_range, revolving_cards,
)
from engine.decisions import money as fmt_money
from engine.models import Country
from engine.offer_check import Offer, OfferCheckInputError, check_offer
from engine.ordering import Strategy
from engine.plan_insights import LoanCheckFindingIn, disagreements, gap_ways, order_spread
from engine.prepay_invest import (
    SPLIT_MARGIN, PrepayInvestInputError, assumed_return as user_assumed_return, compare, split_eligible,
    split_threshold,
)
from engine.simulation import _marginal_rate, simulate_plan

router = APIRouter()
D = Decimal
_DATA = Path(__file__).resolve().parents[1] / "data" / "rate_disclosures"
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@lru_cache(maxsize=1)
def _published() -> Optional[PublishedRange]:
    files = sorted(_DATA.glob("*.json"))
    if not files:
        return None
    return published_range(json.loads(files[-1].read_text()))


class LoanCheckFindingBody(_In):
    kind: Literal["old_benchmark", "missed_rate_cut"]
    amount_this_year: Amount
    overcharged_so_far: Amount = D("0")
    lender: Optional[str] = Field(default=None, max_length=120)
    loan_index: Optional[int] = Field(default=None, ge=0, le=99)


class InsightsRequest(SimulateRequest):
    # Calendar year of sim month 1, for dates in sentences ("May 2031").
    simulation_start_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    loan_check_findings: list[LoanCheckFindingBody] = Field(default_factory=list, max_length=10)
    # A6: the user's own quote; omitted, the banks' published typical/high rates.
    consolidation_rate: Optional[Decimal] = Field(default=None, ge=D("0.05"), le=D("0.40"))
    consolidation_tenure_months: int = Field(default=DEFAULT_TENURE_MONTHS, ge=6, le=84)
    consolidation_fee_pct: Decimal = Field(default=D("0"), ge=D("0"), le=D("0.05"))
    consolidation_foreclosure_pct: Decimal = Field(default=D("0"), ge=D("0"), le=D("0.05"))


class PrepayInvestRequest(InsightsRequest):
    # The yearly return after tax the user chooses; omitted, only dates and
    # the break-even return are given. Never suggested by RightDue.
    assumed_return: Optional[Decimal] = Field(default=None, ge=D("0"), le=D("0.30"))


class OfferBody(_In):
    kind: Literal["top_up", "personal_loan", "no_cost_emi"]
    purpose: Literal["repay", "spend"]
    amount: Amount
    tenure_months: int = Field(ge=1, le=360)
    rate: Optional[Decimal] = Field(default=None, gt=D("0"), le=D("0.6"))
    fee_pct: Decimal = Field(default=D("0"), ge=D("0"), le=D("0.05"))
    fee_flat: Amount = D("0")
    foreclosure_pct: Decimal = Field(default=D("0"), ge=D("0"), le=D("0.05"))
    floating: bool = False
    monthly_emi: Optional[Amount] = None
    cash_price: Optional[Amount] = None
    repay_indices: list[int] = Field(default_factory=list, max_length=20)


class OfferCheckRequest(InsightsRequest):
    offer: OfferBody


# ── responses ───────────────────────────────────────────────────────────────

class OrderRunOut(_Base):
    strategy: str
    net_cost: Decimal
    interest: Decimal
    debt_free_month: Optional[int]


class OrderSpreadOut(_Base):
    runs: list[OrderRunOut]
    cheapest: str
    spread: Decimal
    threshold: Decimal
    months_apart: int
    material: bool
    line: str


class DisagreementOut(_Base):
    kind: str
    worth: Decimal
    basis: str
    headline: str
    detail: str
    reasons: list[str]
    loan_index: Optional[int]


class DisagreementsOut(_Base):
    items: list[DisagreementOut]
    total_over_plan: Decimal
    plain_order: list[int]
    rightdue_order: list[int]
    zero_line: Optional[str]


class GapWayOut(_Base):
    kind: str
    monthly: Decimal
    closes: Decimal
    closes_all: bool
    headline: str
    detail: str
    extra_cost: Optional[Decimal]
    loan_index: Optional[int]


class GapHeadlineOut(_Base):
    gap: Decimal
    ways: list[GapWayOut]
    closed_debt_free_month: Optional[int]


class ScenarioOut(_Base):
    rate: Decimal
    rate_basis: str
    tenure_months: int
    card_indices: list[int]
    card_total: Decimal
    principal: Decimal
    fee: Decimal
    fee_gst: Decimal
    emi: Decimal
    card_minimum_now: Decimal
    cash_freed: Decimal
    gap_before: Decimal
    gap_after: Decimal
    debt_free_before: Optional[int]
    debt_free_after: Optional[int]
    cost_before: Decimal
    cost_after: Decimal
    saving: Decimal
    payments_share_after: Optional[Decimal]
    verdict: str
    break_even_fee_pct: Optional[Decimal]
    cost_window_months: Optional[int]


class PublishedOut(_Base):
    typical: Decimal
    high: Optional[Decimal]
    banks: int
    period: str
    as_of: str
    sources: list[tuple[str, str]]


class ConsolidationOut(_Base):
    cards: list[int]
    card_cost: dict[int, Decimal]
    scenarios: list[ScenarioOut]
    published: Optional[PublishedOut]
    neutrality: str
    # UX walkthrough fix 1: when the plan clears the cards (month), and why
    # the move isn't advice here ("plan_clears" | "not_approvable" | "costs_more" | None).
    plan_clears_month: Optional[int] = None
    not_worth_it: Optional[str] = None


class PlanInsightsResponse(_Base):
    order: Optional[OrderSpreadOut]
    disagreements: DisagreementsOut
    gap: Optional[GapHeadlineOut]
    consolidation: Optional[ConsolidationOut]
    # A4: the month only cheap debt is left (prompt for prepay/keep/split), or None.
    low_rate_phase_month: Optional[int]
    low_rate_threshold: Decimal
    # Round 2 (item 3): threshold = assumed return after tax + margin; the
    # assumption is labelled when it is the default.
    low_rate_assumed_return: Optional[Decimal] = None
    low_rate_assumption_is_default: bool = True
    low_rate_margin: Decimal = SPLIT_MARGIN
    low_rate_eligible: dict[int, bool] = Field(default_factory=dict)


class OptionOut(_Base):
    share_kept: Decimal
    debt_free_month: Optional[int]
    interest_paid: Decimal
    kept_by_debt_free: Decimal
    money_on_common_date: Optional[Decimal]


class PrepayInvestResponse(_Base):
    available: bool
    phase_month: Optional[int] = None
    phase_loans: list[int] = Field(default_factory=list)
    extra_then: Optional[Decimal] = None
    loan_costs: dict[int, Decimal] = Field(default_factory=dict)
    threshold: Decimal
    assumption_is_default: bool = True
    assumed_return_for_trigger: Optional[Decimal] = None
    eligible: dict[int, bool] = Field(default_factory=dict)
    common_month: Optional[int] = None
    assumed_return: Optional[Decimal] = None
    options: list[OptionOut] = Field(default_factory=list)
    break_even_return: Optional[Decimal] = None
    statement: str


class ComparisonOut(_Base):
    against: str
    label: str
    cost_difference: Optional[Decimal]
    detail: str


class OfferCheckResponse(_Base):
    apr: Decimal
    monthly_emi: Decimal
    fee_total: Decimal
    total_cost: Decimal
    comparisons: list[ComparisonOut]
    debt_free_before: Optional[int]
    debt_free_after: Optional[int]
    gap_before: Decimal
    gap_after: Decimal
    payments_share: Optional[Decimal]
    verdict: str
    headline: str
    notes: list[str]
    neutrality: str = NEUTRALITY


# ── helpers ─────────────────────────────────────────────────────────────────

def _runner(req: SimulateRequest, user):
    """run(user, strategy=None, low_rate_invest=None) on the plan's own
    settings; goals are copied per run (the engine fills them in)."""
    kw = _plan_kwargs(req)
    goals = kw.pop("goals")
    chosen = kw.pop("low_rate_invest", None)        # the user's saved split (A4)
    _unset = object()

    def run(u, strategy=None, low_rate_invest=_unset):
        return simulate_plan(
            u, strategy=strategy or req.strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate, stop_owed_multiple=ENGINE_STOP_MULTIPLE,
            goals=deepcopy(goals) if goals is not None else None,
            low_rate_invest=chosen if low_rate_invest is _unset else low_rate_invest, **kw,
        )
    return run


def _labels(req: InsightsRequest, country: Country):
    def money(x: Decimal) -> str:
        return fmt_money(x, country)

    def month(m: int) -> str:
        if req.simulation_start_year is None:
            y, mo = divmod(m - 1, 12)
            return f"in {y} yr {mo} mo" if y else f"in {mo} mo"
        idx = (req.simulation_start_year * 12 + req.simulation_start_month - 1) + (m - 1)
        return f"{_MON[idx % 12]} {idx // 12}"
    return money, month


def _consolidation(req: InsightsRequest, user, run, marg, base):
    try:
        return consolidation_card(
            user, lambda u: run(u), marg, _published(), user_rate=req.consolidation_rate,
            tenure_months=req.consolidation_tenure_months, fee_pct=req.consolidation_fee_pct,
            foreclosure_pct=req.consolidation_foreclosure_pct, base=base,
        )
    except ConsolidationInputError as e:
        raise HTTPException(status_code=422, detail={"field": e.field, "message": str(e)})


def _cons_out(c) -> Optional[ConsolidationOut]:
    if c is None:
        return None
    p = c.published
    return ConsolidationOut(
        cards=c.cards, card_cost={k: v.quantize(D("0.0001")) for k, v in c.card_cost.items()},
        scenarios=[ScenarioOut(**s.__dict__) for s in c.scenarios],
        published=PublishedOut(**p.__dict__) if p else None, neutrality=c.neutrality,
        plan_clears_month=c.plan_clears_month, not_worth_it=c.not_worth_it,
    )


# ── routes ──────────────────────────────────────────────────────────────────

@router.post("/insights/plan", response_model=PlanInsightsResponse)
def plan_insights(req: InsightsRequest) -> PlanInsightsResponse:
    user = req.user.to_engine()
    marg = _marginal_rate(user, req.marginal_rate)
    run = _runner(req, user)
    money, month = _labels(req, user.country)
    base = run(user)
    avalanche = base if req.strategy == Strategy.AVALANCHE else run(user, Strategy.AVALANCHE)

    order = None
    open_loans = [l for l in user.loans if l.outstanding > 0]
    if len(open_loans) >= 2:
        sp = order_spread(user, lambda u, s: avalanche if s == Strategy.AVALANCHE and u is user else run(u, s), marg)
        line = (
            # UX2B-14: under the threshold but not zero, the smallest-first row
            # above showed "₹523 less" under "all orders give the same result".
            ("All orders give the same result for your loans." if sp.spread < 1 else
             f"Other orders cost only a little more for your loans (under {money(sp.threshold)})."
             ) if not sp.material else
            f"The orders differ by {money(sp.spread)}" + (f" and {sp.months_apart} months" if sp.months_apart > 0 else "")
            + ": your call."
        )
        order = OrderSpreadOut(runs=[OrderRunOut(**r.__dict__) for r in sp.runs], cheapest=sp.cheapest,
                               spread=sp.spread, threshold=sp.threshold, months_apart=sp.months_apart,
                               material=sp.material, line=line)

    cons = _consolidation(req, user, run, marg, avalanche)
    dis = disagreements(
        user, avalanche, lambda u: run(u, Strategy.RULES), marg, money, consolidation=cons,
        loan_check=[LoanCheckFindingIn(**f.model_dump()) for f in req.loan_check_findings],
    )
    gap = gap_ways(user, base, lambda u: run(u), money, consolidation=cons)
    phase = None
    if gap is None:
        from engine.prepay_invest import low_rate_phase
        ph = low_rate_phase(user, base, marg)
        phase = ph.month if ph else None
    return PlanInsightsResponse(
        order=order,
        disagreements=DisagreementsOut(
            items=[DisagreementOut(**i.__dict__) for i in dis.items], total_over_plan=dis.total_over_plan,
            plain_order=dis.plain_order, rightdue_order=dis.rightdue_order, zero_line=dis.zero_line,
        ),
        gap=GapHeadlineOut(gap=gap.gap, ways=[GapWayOut(**w.__dict__) for w in gap.ways],
                           closed_debt_free_month=gap.closed_debt_free_month) if gap else None,
        consolidation=_cons_out(cons),
        low_rate_phase_month=phase,
        low_rate_threshold=split_threshold(user),
        low_rate_assumed_return=user_assumed_return(user)[0],
        low_rate_assumption_is_default=user_assumed_return(user)[1],
        low_rate_eligible=split_eligible(user, marg),
    )


@router.post("/insights/prepay-invest", response_model=PrepayInvestResponse)
def prepay_invest(req: PrepayInvestRequest) -> PrepayInvestResponse:
    user = req.user.to_engine()
    marg = _marginal_rate(user, req.marginal_rate)
    run = _runner(req, user)
    money, month = _labels(req, user.country)
    try:
        # Money in hand uses the return the user chose here, else their own
        # saved assumption; never the default (that one only decides when
        # the question is asked).
        chosen = req.assumed_return if req.assumed_return is not None else user.assumed_post_tax_return
        r = compare(user, lambda u, lri: run(u, None, lri), marg, chosen, money=money, month_label=month)
    except PrepayInvestInputError as e:
        raise HTTPException(status_code=422, detail={"field": e.field, "message": str(e)})
    trig, is_default = user_assumed_return(user)
    common = dict(threshold=split_threshold(user), assumption_is_default=is_default,
                  assumed_return_for_trigger=trig, eligible=split_eligible(user, marg))
    if r is None:
        label = "assumed" if is_default else "your"
        return PrepayInvestResponse(
            available=False, **common,
            statement=(f"Not yet: the question comes once every loan left costs less after tax than the "
                       f"{label} {trig * 100:.1f}% return plus {SPLIT_MARGIN * 100:.0f} point, and the emergency "
                       f"fund is full. Until then the plan pays the loans."),
        )
    common.pop("threshold")
    return PrepayInvestResponse(
        available=True, **common, phase_month=r.phase.month, phase_loans=r.phase.loans, extra_then=r.phase.extra_then,
        loan_costs={k: v.quantize(D("0.0001")) for k, v in r.phase.loan_costs.items()},
        threshold=r.threshold, common_month=r.common_month, assumed_return=r.assumed_return,
        options=[OptionOut(share_kept=o.share_kept, debt_free_month=o.debt_free_month, interest_paid=o.interest_paid,
                           kept_by_debt_free=o.kept_by_debt_free, money_on_common_date=o.money_on_common_date)
                 for o in r.options],
        break_even_return=r.break_even_return, statement=r.statement,
    )


@router.post("/insights/consolidation", response_model=Optional[ConsolidationOut])
def consolidation(req: InsightsRequest) -> Optional[ConsolidationOut]:
    user = req.user.to_engine()
    marg = _marginal_rate(user, req.marginal_rate)
    run = _runner(req, user)
    return _cons_out(_consolidation(req, user, run, marg, run(user)))


@router.post("/insights/offer-check", response_model=OfferCheckResponse)
def offer_check(req: OfferCheckRequest) -> OfferCheckResponse:
    user = req.user.to_engine()
    marg = _marginal_rate(user, req.marginal_rate)
    run = _runner(req, user)
    money, month = _labels(req, user.country)
    o = req.offer
    try:
        r = check_offer(
            user,
            Offer(kind=o.kind, purpose=o.purpose, amount=o.amount, tenure_months=o.tenure_months, rate=o.rate,
                  fee_pct=o.fee_pct, fee_flat=o.fee_flat, foreclosure_pct=o.foreclosure_pct, floating=o.floating,
                  monthly_emi=o.monthly_emi, cash_price=o.cash_price, repay_indices=tuple(o.repay_indices)),
            lambda u: run(u), marg, money, _published(), month_label=month,
        )
    except (OfferCheckInputError, ConsolidationInputError) as e:
        raise HTTPException(status_code=422, detail={"field": e.field, "message": str(e)})
    return OfferCheckResponse(
        apr=r.apr, monthly_emi=r.monthly_emi, fee_total=r.fee_total, total_cost=r.total_cost,
        comparisons=[ComparisonOut(**c.__dict__) for c in r.comparisons],
        debt_free_before=r.debt_free_before, debt_free_after=r.debt_free_after, gap_before=r.gap_before,
        gap_after=r.gap_after, payments_share=r.payments_share, verdict=r.verdict, headline=r.headline, notes=r.notes,
    )
