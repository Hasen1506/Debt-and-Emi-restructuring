from decimal import Decimal
D = Decimal


def test_windfall_routes_to_card(client, india_user_payload):
    r = client.post("/api/windfall", json={
        "amount": "100000", "user": india_user_payload, "marginal_rate": "0.30",
        "strategy": "avalanche",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Highest effective rate is the card (42% nominal) → windfall goes there
    assert "credit_card" in body["loan_label"] or body["invest_instead"] is True


def test_windfall_names_the_loan_it_pays(client, india_user_payload):
    """The response carries the target loan's position, so the client logs
    the payment against the loan the engine chose. It used to log against
    the highest-rate loan whatever the strategy picked."""
    for strategy, expect in (("avalanche", 1), ("snowball", 1)):
        r = client.post("/api/windfall", json={
            "amount": "50000", "user": india_user_payload, "marginal_rate": "0.30",
            "strategy": strategy,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        if body["invest_instead"]:
            assert body["loan_index"] is None
        else:
            # Card: highest rate (avalanche) and smallest balance (snowball).
            assert body["loan_index"] == expect


def test_new_debt_no_cost_emi(client):
    """₹20k phone, ₹17k cash equivalent, 6×₹3333 = 'no-cost' EMI."""
    r = client.post("/api/new-debt", json={
        "list_price": "20000", "cash_price_elsewhere": "17000",
        "emi_offer_months": 6, "emi_offer_monthly_payment": "3333.33",
        "processing_fee": "0", "user_savings_after_efund": "50000",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Effective APR should be well above 10% → pay_cash verdict
    assert D(body["effective_apr"]) > D("0.10")
    assert body["verdict"] == "pay_cash"


def test_quick_recompute(client, india_user_payload):
    r = client.post("/api/quick-recompute", json={
        "user": india_user_payload, "extra_payment": "50000",
        "target_loan_index": 1, "strategy": "avalanche",
        "horizon_months": 60, "marginal_rate": "0.30",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["interest_saved"]) >= 0


def test_cash_yield_alert_fires(client):
    r = client.post("/api/cash-yield", json={
        "idle_balance": "500000", "current_yield": "0.025",
        "country": "IN",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["alert"] is True
    # 6.8% liquid fund vs 2.5% savings → uplift ≈ 21,500/yr
    assert D(body["annual_uplift"]) > 0


def test_cash_yield_skipped_below_threshold(client):
    r = client.post("/api/cash-yield", json={
        "idle_balance": "1000", "current_yield": "0.025", "country": "IN",
    })
    assert r.status_code == 200
    assert r.json() == {"alert": False, "idle_balance": None, "current_yield": None,
                        "best_alt_yield": None, "alt_name": None,
                        "annual_uplift": None, "beats_top_loan": None, "rationale": None}


def test_right_time_to_borrow_wait(client):
    """50bps cut expected in 3 months, user can wait → 'wait' verdict."""
    r = client.post("/api/right-time-to-borrow", json={
        "current_rate": "0.085", "six_month_avg": "0.090",
        "consensus_change_bps": -50, "months_to_decision": 3,
        "urgency": "3m_ok", "principal": "5000000", "tenure_months": 240,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "wait"


def test_right_time_to_borrow_urgent(client):
    r = client.post("/api/right-time-to-borrow", json={
        "current_rate": "0.085", "six_month_avg": "0.090",
        "consensus_change_bps": -50, "months_to_decision": 3,
        "urgency": "now", "principal": "5000000", "tenure_months": 240,
    })
    assert r.status_code == 200
    assert r.json()["verdict"] == "borrow_now"


def test_asset_liquidation_recommends_sell_for_high_rate_debt(client):
    """Pre-Finance-Act-2024 property, ₹15L credit-card debt at 36%, weak asset
    return → all three gates should pass."""
    r = client.post("/api/asset-liquidation", json={
        "asset": {
            "asset_type": "real_estate",
            "purchase_price": "6000000",
            "purchase_date": "2018-06-15",
            "current_market_value": "9000000",
            "state": "Maharashtra",
        },
        "sale_price": "9000000",
        "debt_balance": "1500000",
        "debt_effective_rate": "0.36",
        "taxable_income": "1800000",
        "asset_nominal_return": "0.04",
        "expected_hold_years_post_sale": "5",
        "purchase_fy": "2018-19",
        "current_fy": "2024-25",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recommend_liquidation"] is True
    assert body["gate_1_net_benefit"] is True
    assert body["gate_2_high_rate"] is True
    assert body["gate_3_spread"] is True


def test_asset_liquidation_pre_2024_indexed(client):
    r = client.post("/api/asset-liquidation", json={
        "asset": {
            "asset_type": "real_estate",
            "purchase_price": "6000000",
            "purchase_date": "2020-06-15",
            "current_market_value": "9000000",
            "state": "Maharashtra",
        },
        "sale_price": "9000000",
        "debt_balance": "1500000",
        "debt_effective_rate": "0.36",
        "taxable_income": "1800000",
        "asset_nominal_return": "0.04",
        "expected_hold_years_post_sale": "5",
        "purchase_fy": "2020-21",
        "current_fy": "2024-25",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recommend_liquidation"] is True
    assert body["gate_2_high_rate"] is True


def _us_sale(main_home: bool, **extra):
    return {
        "asset": {
            "asset_type": "real_estate",
            "purchase_price": "100000",
            "purchase_date": "2018-10-01",
            "current_market_value": "350000",
            "us_section_121_eligible": main_home,
        },
        "sale_price": "350000",
        "debt_balance": "100000",
        "debt_effective_rate": "0.12",
        "taxable_income": "108000",
        "surplus_reinvestment_yield": "0.045",
        "country": "US",
        "filing_status": "single",
        **extra,
    }


def test_asset_liquidation_us_uses_us_capital_gains(client):
    """A US sale isn't taxed as an Indian one: $350k less 8% selling costs
    less $100k basis is a $222k long-term gain at 15% federal = $33,300
    (India's rules gave $31,817.50 "LTCG" with Maharashtra costs)."""
    r = client.post("/api/asset-liquidation", json=_us_sale(False))
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["ltcg_tax"]) == Decimal("33300")
    assert Decimal(body["net_proceeds"]) == Decimal("288700")
    assert any("No state income tax" in n for n in body["tax_notes"])


def test_asset_liquidation_us_main_home_excludes_gain(client):
    """§121: a qualifying single filer's first $250k of gain is excluded."""
    r = client.post("/api/asset-liquidation", json=_us_sale(True, state_marginal_rate="0.093"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["ltcg_tax"]) == 0
    assert Decimal(body["net_proceeds"]) == Decimal("322000")
    assert any("§121" in n for n in body["tax_notes"])
    assert not any("No state income tax" in n for n in body["tax_notes"])


def test_asset_liquidation_india_has_no_us_notes(client):
    r = client.post("/api/asset-liquidation", json={
        **{k: v for k, v in _us_sale(False).items() if k not in ("country", "filing_status")},
    })
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["ltcg_tax"]) == Decimal("31817.5")
    assert r.json()["tax_notes"] == []


def test_asset_liquidation_post_2024_flat(client):
    """Post-23-Jul-2024 purchase: no CII inputs needed."""
    r = client.post("/api/asset-liquidation", json={
        "asset": {
            "asset_type": "real_estate",
            "purchase_price": "6000000",
            "purchase_date": "2024-09-01",
            "current_market_value": "9000000",
            "state": "Maharashtra",
        },
        "sale_price": "9000000",
        "debt_balance": "500000",
        "debt_effective_rate": "0.085",         # home loan rate — gate 2 fails
        "taxable_income": "1800000",
        "asset_nominal_return": "0.04",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gate_2_high_rate"] is False
    assert body["recommend_liquidation"] is False


# ─── Bad input comes back as a named 422; wording in the user's currency ────

def test_new_debt_bad_input_is_a_named_422(client):
    r = client.post("/api/new-debt", json={
        "list_price": "80000", "cash_price_elsewhere": "74000",
        "emi_offer_months": 0, "emi_offer_monthly_payment": "6667",
    })
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "emi_offer_months"


def test_new_debt_us_wording(client):
    r = client.post("/api/new-debt", json={
        "list_price": "1200", "cash_price_elsewhere": "1000", "emi_offer_months": 12,
        "emi_offer_monthly_payment": "100", "user_savings_after_efund": "5000", "country": "US",
    })
    assert r.status_code == 200 and "$200" in r.json()["detail"]


def test_windfall_zero_amount_is_a_named_422(client, india_user_payload):
    r = client.post("/api/windfall", json={"amount": "0", "user": india_user_payload})
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "amount"


def test_right_time_rejects_unknown_urgency(client):
    r = client.post("/api/right-time-to-borrow", json={
        "current_rate": "0.09", "six_month_avg": "0.09",
        "consensus_change_bps": -50, "months_to_decision": 3,
        "urgency": "whenever", "principal": "500000", "tenure_months": 36,
    })
    assert r.status_code == 422


def test_quick_recompute_rejects_a_loan_that_is_not_there(client, india_user_payload):
    """Index 7 of 2 loans used to answer 'saves nothing'."""
    r = client.post("/api/quick-recompute", json={
        "user": india_user_payload, "extra_payment": "100000", "target_loan_index": 7,
    })
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "target_loan_index"
