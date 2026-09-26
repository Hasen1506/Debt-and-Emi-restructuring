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
    assert D(first["balance"]) == D(bucket["INR"]) * D("0.012") + D(bucket["USD"])
    assert D(first["balance"]) < D("100000")


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
