from decimal import Decimal

D = Decimal


def test_simulate_returns_trajectory(client, india_user_payload):
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 60, "marginal_rate": "0.30",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert "trajectory" in body
    assert body["months_in_horizon"] > 0
    assert D(body["total_interest_paid"]) > 0
    # First trajectory point should have a positive total balance
    assert D(body["trajectory"][0]["balance"]) > 0


def test_simulate_emits_per_currency_balance_bucket_single_currency(
    client, india_user_payload
):
    """Single-currency users get a 1-element balances_by_currency dict that
    matches the scalar `balance` field exactly. Used by the FE to drive the
    per-ccy trajectory chart for hybrid users without a special-case for
    the single-currency path."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 24, "marginal_rate": "0.30",
    })
    body = r.json()
    first = body["trajectory"][0]
    assert "balances_by_currency" in first
    bucket = first["balances_by_currency"]
    assert set(bucket.keys()) == {"INR"}
    assert D(bucket["INR"]) == D(first["balance"])


def test_simulate_emits_per_currency_balance_bucket_hybrid(client):
    """NRI-US user with one INR loan + one USD loan gets two buckets, each
    summing to the per-currency outstanding (no cross-currency conversion at
    the API layer — the chart layer needs each ccy separately)."""
    payload = {
        "country": "US",
        "income_type": "salaried",
        "annual_income": "120000",
        "monthly_income": "10000",
        "fixed_expenses": "4000",
        "savings_balance": "50000",
        "primary_bank": "JPMorgan Chase",
        "efund_balance": "20000",
        "efund_target": "40000",
        "is_nri_us": True,
        "fx_to_user_currency": {"INR": "0.012"},
        "loans": [
            {
                "loan_type": "home_loan", "bank": "HDFC Bank",
                "outstanding": "4000000", "nominal_rate": "0.085",
                "rate_type": "floating", "tenure_months_remaining": 240,
                "scheduled_emi": "34713", "currency": "INR",
            },
            {
                "loan_type": "credit_card", "bank": "Chase",
                "outstanding": "25000", "nominal_rate": "0.249",
                "rate_type": "fixed", "tenure_months_remaining": 0,
                "scheduled_emi": "800", "currency": "USD",
            },
        ],
        "investment_options": [
            {"name": "HYSA", "expected_return": "0.045",
             "liquidity_class": "liquid", "is_in_pool": True},
        ],
    }
    r = client.post("/api/simulate", json={
        "user": payload, "strategy": "avalanche",
        "horizon_months": 12, "marginal_rate": "0.24",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    first = body["trajectory"][0]
    bucket = first["balances_by_currency"]
    assert set(bucket.keys()) == {"INR", "USD"}
    # Each bucket is in its own currency, no FX conversion at the API edge.
    assert D(bucket["INR"]) > D("3_900_000")  # home loan slightly amortised
    assert D(bucket["USD"]) > D("0")          # card not cleared in month 1


def test_baseline_minimums_only(client, india_user_payload):
    r = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 60,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Baseline pays only minimums → no investment
    assert D(body["total_invested"]) == 0


def test_baseline_pays_more_interest_than_avalanche(client, india_user_payload):
    """Avalanche with surplus should pay less interest over the same horizon."""
    baseline = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 60,
    }).json()
    sim = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 60, "marginal_rate": "0.30",
    }).json()
    assert D(baseline["total_interest_paid"]) >= D(sim["total_interest_paid"])


def test_sensitivity_surplus_delta(client, india_user_payload):
    r = client.post("/api/sensitivity/compare", json={
        "user": india_user_payload, "horizon_months": 60,
        "marginal_rate": "0.30", "strategy": "avalanche",
        "surplus_delta": "10000",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Extra ₹10k/mo of surplus → either more interest saved, or no change if
    # the loan already clears within horizon. interest_saved must be ≥ 0.
    assert D(body["interest_saved"]) >= 0
    # Both totals come back for What if's before/after bars, and agree with
    # the saving.
    assert D(body["baseline_total_interest"]) - D(body["scenario_total_interest"]) == D(body["interest_saved"])


def test_sensitivity_rate_shock(client, india_user_payload):
    """A 50bps rate cut on the floating home loan saves interest."""
    r = client.post("/api/sensitivity/compare", json={
        "user": india_user_payload, "horizon_months": 60,
        "marginal_rate": "0.30", "strategy": "avalanche",
        "rate_shock_delta": "-0.005",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["interest_saved"]) > 0


def test_simulate_emits_engine_truth_surplus_series(client, india_user_payload):
    """Per-month surplus + per-goal contribution arrays power
    client-side achievability (replaces the flat `monthlySurplus ×
    months` approximation). Validates the engine-truth shape:
    available_surplus is positive across the goal's funding window,
    and goal_contributions[goal_id] sums to the engine's
    `saved_at_target` for that goal."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 24, "marginal_rate": "0.30",
        "goals": [
            {
                "id": "wedding",
                "target_month_index": 12,
                "required_amount": "120000",
                "saved_so_far": "0",
                "priority_bump": False,
            }
        ],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Every trajectory point carries the new fields (default values
    # when no goal was funded that month).
    first = body["trajectory"][0]
    assert "available_surplus" in first
    assert "goal_contributions" in first
    assert D(first["available_surplus"]) > 0
    # The wedding goal should be on track — sum of contributions
    # over the funding window equals the engine's saved_at_target.
    sum_contrib = sum(
        D(p["goal_contributions"].get("wedding", "0"))
        for p in body["trajectory"]
    )
    finals = {f["goal_id"]: f for f in body["goal_finals"]}
    assert "wedding" in finals
    assert sum_contrib == D(finals["wedding"]["saved_at_target"])
    # And the new `funded` flag should be present.
    assert "funded" in finals["wedding"]


def test_simulate_rejects_funding_start_at_or_after_target(
    client, india_user_payload,
):
    """A stale-cookie or bad-client payload with
    funding_start_month_index >= target_month_index should 422 at the
    API edge rather than silently funding the goal at 0 forever. The
    Pydantic model_validator on GoalIn enforces this."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 24, "marginal_rate": "0.30",
        "goals": [
            {
                "id": "broken",
                "target_month_index": 6,
                "required_amount": "60000",
                "saved_so_far": "0",
                "priority_bump": False,
                # Start month equals target month — engine would never
                # fund this goal; reject upstream instead.
                "funding_start_month_index": 6,
            }
        ],
    })
    assert r.status_code == 422, r.text
    assert "funding_start_month_index" in r.text


def test_simulate_marks_goal_past_horizon_when_target_after_debt_free(
    client, india_user_payload,
):
    """When the sim breaks out at debt_free_month, a goal whose target
    sits beyond that point should surface `target_past_horizon=True`
    so the UI can render an honest "deadline is past your debt-free
    month" message instead of a misleading "not reached" tone."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        # Long horizon so debt-free lands before the goal target.
        "horizon_months": 600, "marginal_rate": "0.30",
        "goals": [
            {
                # Place the goal far in the future (50 years out) so
                # the sim definitely breaks out at debt-free before
                # reaching it.
                "id": "long_horizon",
                "target_month_index": 599,
                "required_amount": "100000",
                "saved_so_far": "0",
                "priority_bump": False,
            }
        ],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["debt_free_month"] is not None
    finals = {f["goal_id"]: f for f in body["goal_finals"]}
    g = finals["long_horizon"]
    assert g["target_reached"] is False
    assert g["target_past_horizon"] is True


def test_simulate_snapshot_surfaces_funding_start_index_for_deferred_goal(
    client, india_user_payload,
):
    """When a goal is deferred (funding_start_month_index > 0), the
    snapshot's per-goal contribution row should carry that index so
    /plan can render 'starts month N' instead of just '₹0 — deferred'.
    Closes the snapshot honesty gap noted in the 3.4 critique."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 24, "marginal_rate": "0.30",
        "goals": [
            {
                "id": "wedding",
                "target_month_index": 12,
                "required_amount": "60000",
                "saved_so_far": "0",
                "priority_bump": False,
                # Defer funding until month 7 — engine should emit
                # `deferred` queued_reason for months < 7.
                "funding_start_month_index": 7,
            }
        ],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    contribs = body["surplus_allocation"]["goal_contributions"]
    wedding = next(c for c in contribs if c["goal_id"] == "wedding")
    assert wedding["queued_reason"] == "deferred"
    assert wedding["funding_start_month_index"] == 7
    assert D(wedding["amount"]) == D("0")


# ─── Audit fixes (AUDIT.md §2) ──────────────────────────────────────────

def _nri_payload():
    return {
        "country": "US", "income_type": "salaried",
        "annual_income": "120000", "monthly_income": "10000",
        "fixed_expenses": "4000", "savings_balance": "50000",
        "primary_bank": "JPMorgan Chase", "is_nri_us": True,
        "fx_to_user_currency": {"INR": "0.012"},
        "loans": [
            {"loan_type": "home_loan", "bank": "HDFC Bank", "outstanding": "4000000",
             "nominal_rate": "0.085", "rate_type": "floating",
             "tenure_months_remaining": 240, "scheduled_emi": "34713", "currency": "INR"},
            {"loan_type": "credit_card", "bank": "Chase", "outstanding": "25000",
             "nominal_rate": "0.249", "rate_type": "fixed",
             "tenure_months_remaining": 0, "scheduled_emi": "800", "currency": "USD"},
        ],
    }


def test_trajectory_balance_is_in_the_users_currency(client):
    """₹40L + $25k used to come back as a 'balance' of 4,025,000."""
    body = client.post("/api/simulate", json={
        "user": _nri_payload(), "horizon_months": 12, "marginal_rate": "0.24",
    }).json()
    first = body["trajectory"][0]
    bucket = first["balances_by_currency"]
    # Each figure is rounded to the cent, so allow a cent of drift.
    assert abs(D(first["balance"]) - (D(bucket["INR"]) * D("0.012") + D(bucket["USD"]))) <= D("0.01")
    assert D(first["balance"]) < D("100000")
    assert D(first["balance"]) == D(first["balance"]).quantize(D("0.01"))


def _us_home_payload(outstanding, deductions=None, filing="single"):
    payload = {
        "country": "US", "income_type": "salaried",
        "annual_income": "150000", "monthly_income": "9000",
        "fixed_expenses": "3000", "savings_balance": "20000",
        "primary_bank": "Chase", "filing_status": filing,
        "loans": [{
            "loan_type": "home_loan", "bank": "Chase", "outstanding": outstanding,
            "nominal_rate": "0.065", "rate_type": "fixed",
            "tenure_months_remaining": 300, "scheduled_emi": "2500",
        }],
    }
    if deductions is not None:
        payload["deductions"] = deductions
    return payload


def test_us_itemise_is_worked_out_from_deductions():
    from api.schemas import UserIn

    # $100k at 6.5% = $6.5k of interest: below the standard deduction.
    assert UserIn(**_us_home_payload("100000")).to_engine().itemises is False
    # $600k at 6.5% = $39k: above it.
    assert UserIn(**_us_home_payload("600000")).to_engine().itemises is True
    # Entered deductions win over the estimate.
    small = _us_home_payload("600000", {"mortgage_interest_annual": "2000"})
    assert UserIn(**small).to_engine().itemises is False
    extra = _us_home_payload("100000", {"itemized_deductions_other": "20000"})
    assert UserIn(**extra).to_engine().itemises is True
    # Stated explicitly: kept.
    stated = {**_us_home_payload("100000"), "itemises": True}
    assert UserIn(**stated).to_engine().itemises is True


def test_us_mortgage_shield_counts_only_interest_above_the_standard_deduction():
    """Audit case, 6.75% at a 30% rate: $230k was 6.75% effective and $240k
    jumped to 4.73% (the full shield). Only interest above the $16,100
    standard deduction saves tax, so the rate eases down smoothly; $350k is
    6.75% × (1 − 0.30 × 7,525/23,625) ≈ 6.105%."""
    from api.schemas import UserIn
    from engine.formulas import effective_rate

    def eff(outstanding):
        p = _us_home_payload(outstanding)
        p["loans"][0]["nominal_rate"] = "0.0675"
        u = UserIn(**p).to_engine()
        return effective_rate(u.loans[0], D("0.30"), u.country, None, u.itemises, u.itemised_share)

    assert eff("230000") == D("0.0675")
    assert D("0.0670") < eff("240000") < D("0.0675")
    assert abs(eff("350000") - D("0.06105")) < D("0.00005")


def test_india_user_never_itemises(india_user_payload):
    from api.schemas import UserIn

    assert UserIn(**india_user_payload).to_engine().itemises is False


def test_baseline_applies_planned_rate_resets(client, india_user_payload):
    events = [{"kind": "floating_rate_reset", "effective_month": 3,
               "loan_index": 0, "new_rate": "0.12"}]
    plain = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 120,
    }).json()
    with_reset = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 120, "lifecycle_events": events,
    })
    assert with_reset.status_code == 200, with_reset.text
    assert D(with_reset.json()["total_interest_paid"]) > D(plain["total_interest_paid"])


def test_restructuring_total_counts_each_loan_once():
    """A card can be balance-transferred or folded into a consolidation
    loan, not both; the total used to add both."""
    from api.routes.restructuring import _non_overlapping_total
    from engine.restructuring_scan import scan_all
    from engine.tests.test_restructuring import _mixed_book
    opps = scan_all(_mixed_book(), Decimal("0.3"))
    naive = sum(o.estimated_annual_saving for o in opps)
    total = _non_overlapping_total(opps)
    assert total < naive
    by_kind = {o.kind: o.estimated_annual_saving for o in opps}
    # Consolidation (loans 1-3, card included) + refinance (loan 0); the
    # card's own transfer overlaps the consolidation and is skipped.
    assert total == by_kind["consolidation"] + by_kind["refinance"]


def test_what_if_baseline_is_the_plan_the_user_sees(client, india_user_payload):
    """With goals, an emergency-fund split and a planned rate reset, the
    what-if's 'before' must be /plan's own date and interest. The compare
    endpoint used to drop all three."""
    u = dict(india_user_payload, efund_balance="0", efund_target="600000")
    plan = {
        "simulation_start_month": 9,
        "ef_top_up_rate": "0.5",
        "lifecycle_events": [
            {"kind": "floating_rate_reset", "effective_month": 4,
             "loan_index": 0, "new_rate": "0.095"},
        ],
        "goals": [
            {"id": "car", "target_month_index": 18, "required_amount": "400000"},
        ],
    }
    sim = client.post("/api/simulate", json={"user": u, **plan}).json()
    cmp_ = client.post("/api/sensitivity/compare",
                       json={"user": u, **plan, "surplus_delta": "10000"}).json()
    assert cmp_["baseline_debt_free_month"] == sim["debt_free_month"]
    bare = client.post("/api/simulate", json={"user": u}).json()
    assert bare["debt_free_month"] != sim["debt_free_month"]   # the settings matter
    assert cmp_["scenario_debt_free_month"] <= cmp_["baseline_debt_free_month"]


def test_simulate_reports_this_months_shortfall(client, india_user_payload):
    """Costs + card minimum above income: the response says by how much, so
    the pages can hold back a date built on payments that can't be made."""
    user = {
        **india_user_payload,
        "monthly_income": "30000", "annual_income": "360000",
        "fixed_expenses": "34000", "variable_expenses": "0",
        "efund_balance": "0", "efund_target": "0",
        "loans": [{
            "loan_type": "credit_card", "bank": "Axis Bank",
            "outstanding": "100000", "nominal_rate": "0.36",
            "rate_type": "fixed", "tenure_months_remaining": 0,
            "scheduled_emi": "0",
        }],
    }
    r = client.post("/api/simulate", json={
        "user": user, "strategy": "avalanche", "horizon_months": 12,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Costs − income = ₹4,000, plus Axis's MITC minimum (interest + GST in
    # full + 2% of ₹1,00,000; W2 C14, interest on the average daily balance
    # per W1 C13): ≈ ₹5,475 → ≈ ₹9,475 (was a flat 5% → ₹9,000).
    m1 = body["trajectory"][0]
    assert abs(D(body["shortfall"]) - D(m1["shortfall"])) < D("0.01")   # trajectory is rounded to paise
    assert abs(D(m1["shortfall"]) - (D("4000") + D(m1["total_paid"]))) < D("0.01")
    assert D("9400") < D(body["shortfall"]) < D("9540")


def test_simulate_shortfall_is_zero_when_covered(client, india_user_payload):
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche", "horizon_months": 12,
    })
    assert D(r.json()["shortfall"]) == 0


def test_debt_budget_is_what_the_plan_pays_each_month(client, india_user_payload):
    """The user's own monthly total for debts, not all their spare cash."""
    body = {"user": india_user_payload, "horizon_months": 360}
    free = client.post("/api/simulate", json=body).json()
    capped = client.post("/api/simulate", json={**body, "debt_budget": "60000"}).json()
    assert Decimal(capped["trajectory"][0]["total_paid"]) <= Decimal("60000.01")
    assert Decimal(free["trajectory"][0]["total_paid"]) > Decimal("60000")
    assert capped["debt_free_month"] > free["debt_free_month"]
    # The what-if runs against the same budget.
    cmp = client.post("/api/sensitivity/compare", json={**body, "debt_budget": "60000", "surplus_delta": "5000"}).json()
    assert Decimal(cmp["months_pulled_forward"]) > 0
