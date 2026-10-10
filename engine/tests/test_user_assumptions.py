"""User-programmable values (roadmap PR D): the prepay margin, expected
asset returns and selling costs were hard-coded; each now takes the user's
own figure, with the old constant as the default."""
from datetime import date
from decimal import Decimal as D

from engine.asset_liquidation import compute_liquidation_proceeds, rank_liquidations
from engine.country_data import lookup_asset_return
from engine.decisions import allocate_windfall
from engine.formulas import PREPAY_RISK_PREMIUM, prepay_recommended
from engine.models import (
    Asset, Country, IncomeType, InvestmentOption, LiquidityClass, Loan, LoanType, TaxRegimeIN, User,
)
from engine.simulation import simulate_plan

FUND = [InvestmentOption(name="Liquid", expected_return=D("0.075"), liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]


def _user(loans, assets=(), **kw):
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"), fixed_expenses=D("60000"),
        savings_balance=D("0"), primary_bank="x", loans=list(loans), assets=list(assets),
        investment_options=FUND, tax_regime=TaxRegimeIN.NEW, **kw,
    )


def test_prepay_margin_default_and_override():
    # 7.9% loan vs a 7.5% fund (untaxed here): inside the default +0.5pp margin.
    assert PREPAY_RISK_PREMIUM == D("0.005")
    assert prepay_recommended(D("0.079"), D("0.075"), D("0.05")) is False
    assert prepay_recommended(D("0.079"), D("0.075"), D("0.05"), hurdle=D("0")) is True
    assert prepay_recommended(D("0.10"), D("0.075"), D("0.05"), hurdle=D("0.03")) is False


def test_simulation_uses_the_users_prepay_margin():
    """Before PR D the +0.5pp margin was fixed: a 7.7% loan (7.98% a year,
    compounded) against a 7.5% fund always had its extra invested, whatever
    the user wanted."""
    car = Loan(LoanType.AUTO, "x", D("400000"), D("0.077"), "fixed", 60, D("8100"))
    default = simulate_plan(_user([car]), horizon_months=12)
    assert default.months[0].invested_this_month > 0
    own = simulate_plan(_user([car], prepay_hurdle=D("0")), horizon_months=12)
    assert own.months[0].invested_this_month == 0
    assert own.months[0].payments_by_loan_index[0] > default.months[0].payments_by_loan_index[0]


def test_windfall_uses_the_users_prepay_margin():
    car = Loan(LoanType.AUTO, "x", D("400000"), D("0.079"), "fixed", 60, D("8100"))
    rates = {id(car): D("0.079")}
    assert allocate_windfall(D("50000"), [car], rates, FUND, D("0.05")).invest_instead is True
    assert allocate_windfall(D("50000"), [car], rates, FUND, D("0.05"), prepay_hurdle=D("0")).invest_instead is False


def test_asset_return_override():
    assert lookup_asset_return("equity_mf", Country.IN) == D("0.11")
    assert lookup_asset_return("equity_mf", Country.IN, {"equity_mf": D("0.08")}) == D("0.08")
    assert lookup_asset_return("gold_physical", Country.IN, {"equity_mf": D("0.08")}) == D("0.08")


def _equity():
    return Asset(asset_type="equity_mf", purchase_price=D("500000"), purchase_date=date(2023, 1, 1),
                 current_market_value=D("800000"))


def _card():
    return Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("200000"), D("0.42"), "fixed", 0, D("0"))


def test_selling_cost_default_asset_and_user_override():
    today = date(2026, 10, 7)
    base = compute_liquidation_proceeds(_equity(), today, D("0.3"))
    assert base.transaction_costs == D("800000") * D("0.002")
    own = Asset(**{**_equity().__dict__, "selling_cost_pct": D("0.01")})
    assert compute_liquidation_proceeds(own, today, D("0.3")).transaction_costs == D("8000")
    # The ranker applies the user's per-type cost and return; an asset's own cost wins.
    u = _user([_card()], [_equity()], liquidation_costs={"equity_mf": D("0.02")}, asset_returns={"equity_mf": D("0.09")})
    rec = rank_liquidations(u, {0: D("0.4956")}, today=today)["recommendations"][0]
    assert rec.proceeds.transaction_costs == D("16000")
    assert rec.asset_return_pct == D("0.09")
    u2 = _user([_card()], [own], liquidation_costs={"equity_mf": D("0.02")})
    assert rank_liquidations(u2, {0: D("0.4956")}, today=today)["recommendations"][0].proceeds.transaction_costs == D("8000")
