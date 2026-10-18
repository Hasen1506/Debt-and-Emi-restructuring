"""Audit 80 W10 — Sell to repay is a calculator, never a verdict.

Founder's cut-list answer 4: keep Sell to repay as "what selling this costs
me, tax included". Ranking the user's holdings by what to sell is advice
under SEBI's Investment Advisers Regulations 2013 (reg. 2(1)(l): investment
advice "shall include financial planning"; reg. 3(1): registration needed;
https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1740726382475.pdf),
so the ranker route is frozen behind LIQUIDATION_RANKER (off by default).

Guards the class of defect, not one repro:
* no response of /api/asset-liquidation, for any asset/country/price,
  carries a verdict field or "sell it"/"keep it" wording;
* the ranker is 404 unless the flag is on, and with the flag on it still
  never 500s on hostile input (the fuzz suite skips it by default);
* the arithmetic identity net = sale − tax − costs and
  debt_cleared = min(max(net, 0), debt).
"""
import copy
import random
import re
from decimal import Decimal

import pytest

D = Decimal
VERDICT_FIELDS = {"recommend_liquidation", "gate_0_wealth_edge", "gate_1_net_benefit",
                  "gate_2_high_rate", "gate_3_spread", "wealth_edge_needed"}
VERDICT_WORDS = re.compile(r"\b(sell it|keep it|you should sell|we recommend|recommend selling|"
                           r"worse off|better off|sell the asset)\b", re.I)


def _sale(asset_type="real_estate", purchase_date="2015-06-01", price="5000000",
          sale="9000000", country="IN", debt="1500000", rate="0.36", **extra):
    body = {
        "asset": {"asset_type": asset_type, "label": "Test asset", "purchase_price": price,
                  "purchase_date": purchase_date, "current_market_value": sale,
                  "state": "Tamil Nadu"},
        "sale_price": sale, "debt_balance": debt, "debt_effective_rate": rate,
        "taxable_income": "1800000", "country": country,
    }
    body.update(extra)
    return body


RANKER_BODY_KEYS = {"debt_effective_rates": {"0": "0.085", "1": "0.42"}}


# ── the ranker is frozen behind a flag ──────────────────────────────────────

def test_ranker_is_off_by_default(client, india_user_payload, monkeypatch):
    monkeypatch.delenv("LIQUIDATION_RANKER", raising=False)
    r = client.post("/api/portfolio/liquidation-rankings",
                    json={"user": india_user_payload, **RANKER_BODY_KEYS})
    assert r.status_code == 404


@pytest.mark.parametrize("value", ["", "0", "false", "OFF", "yes", "1"])
def test_ranker_only_opens_on_exact_on(client, india_user_payload, monkeypatch, value):
    monkeypatch.setenv("LIQUIDATION_RANKER", value)
    r = client.post("/api/portfolio/liquidation-rankings",
                    json={"user": india_user_payload, **RANKER_BODY_KEYS})
    assert r.status_code == 404


def test_ranker_flag_on_still_works(client, india_user_payload, monkeypatch):
    monkeypatch.setenv("LIQUIDATION_RANKER", "on")
    r = client.post("/api/portfolio/liquidation-rankings",
                    json={"user": india_user_payload, **RANKER_BODY_KEYS})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "recommendations" in body and "considered_but_skipped" in body


HOSTILE = ["-1", "1e30", "1E+999999", "NaN", "Infinity", "", None, "abc", 10**18, [], {}, True]


def test_ranker_flag_on_hostile_values_never_crash(client, india_user_payload, monkeypatch):
    """The fuzz suite drops this route while it's off; fuzz it here with the flag on."""
    monkeypatch.setenv("LIQUIDATION_RANKER", "On")   # case-insensitive "on"
    rng = random.Random(10)
    base = {"user": india_user_payload, **RANKER_BODY_KEYS}
    paths = [("debt_effective_rates", "0"), ("debt_effective_rates", "1"),
             ("user", "monthly_income"), ("user", "savings_balance"),
             ("user", "loans", 0, "outstanding"), ("user", "loans", 1, "nominal_rate")]
    tried = 0
    for path in paths:
        for v in rng.sample(HOSTILE, 5):
            b = copy.deepcopy(base)
            node = b
            for k in path[:-1]:
                node = node[k]
            node[path[-1]] = v
            r = client.post("/api/portfolio/liquidation-rankings", json=b)
            tried += 1
            assert r.status_code in (200, 400, 422), f"{path}={v!r}: {r.status_code} {r.text[:200]}"
    assert tried == 30


# ── the calculator never gives a verdict ────────────────────────────────────

CASES = [
    _sale(),                                                         # resident, pre-2024 property
    _sale(purchase_date="2025-01-10", sale="5200000"),               # post-2024, short-term
    _sale(rate="0.08"),                                              # cheap debt
    _sale(sale="4000000"),                                           # a loss
    _sale(debt="0"),                                                 # no debt
    _sale(seller_resident=False),                                    # NRI seller
    _sale(debt="50000000"),                                          # debt bigger than proceeds
    _sale(debt_monthly_payment="40000", expected_hold_years_post_sale="5"),
]


@pytest.mark.parametrize("body", CASES)
def test_asset_liquidation_is_figures_only(client, body):
    r = client.post("/api/asset-liquidation", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert not (VERDICT_FIELDS & set(out)), VERDICT_FIELDS & set(out)
    assert not VERDICT_WORDS.search(out["rationale"]), out["rationale"]
    assert "doesn't advise whether to sell" in out["rationale"]
    net, debt = D(out["net_proceeds"]), D(body["debt_balance"])
    assert D(out["debt_cleared"]) == min(max(net, D(0)), debt)
    assert D(out["yearly_interest_on_cleared_debt"]) == (
        D(out["debt_cleared"]) * D(body["debt_effective_rate"])).quantize(D("0.01"))
    assert D(out["ltcg_tax"]) >= 0


def test_nri_seller_gets_no_indexation_choice(client):
    """Bought before 23 Jul 2024: a resident sees both computations, an NRI
    only 12.5% without indexation (Income Tax Dept, LTCG page:
    https://www.incometaxindia.gov.in/w/tax-on-long-term-capital-gains%E2%80%8B)."""
    res = client.post("/api/asset-liquidation", json=_sale()).json()
    nri = client.post("/api/asset-liquidation", json=_sale(seller_resident=False)).json()
    assert len(res["tax_options"]) == 2
    assert nri["tax_options"] == []
    flat = next(D(o["tax"]) for o in res["tax_options"] if o["label"].startswith("12.5%"))
    assert D(nri["ltcg_tax"]).quantize(D("1")) == flat.quantize(D("1"))
    assert D(res["ltcg_tax"]) <= D(nri["ltcg_tax"])
