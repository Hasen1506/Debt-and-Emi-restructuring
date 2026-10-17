"""NEW-19 (live re-test 4): bounded LRU of /simulate, /baseline, /compare."""
from api.engine_cache import EngineCache, canonical_key, engine_cache
from pydantic import BaseModel


def _body(payload, **extra):
    return {"user": payload, "horizon_months": 120, **extra}


def test_identical_simulate_is_served_from_cache_and_equal(client, india_user_payload):
    body = _body(india_user_payload, strategy="avalanche")
    first = client.post("/api/simulate", json=body)
    assert first.status_code == 200
    misses = engine_cache.misses
    second = client.post("/api/simulate", json=body)
    assert second.status_code == 200
    assert second.json() == first.json()
    assert engine_cache.misses == misses and engine_cache.hits >= 1


def test_any_change_in_the_body_misses(client, india_user_payload):
    a = client.post("/api/simulate", json=_body(india_user_payload, strategy="avalanche")).json()
    b = client.post("/api/simulate", json=_body(india_user_payload, strategy="snowball")).json()
    assert engine_cache.misses == 2
    changed = dict(india_user_payload, monthly_income=str(float(india_user_payload["monthly_income"]) + 5000))
    c = client.post("/api/simulate", json=_body(changed, strategy="avalanche")).json()
    assert engine_cache.misses == 3
    assert a["total_interest_paid"] != c["total_interest_paid"] or a["debt_free_month"] != c["debt_free_month"] or a != b


def test_cached_answer_matches_an_uncached_run(client, india_user_payload):
    body = _body(india_user_payload)
    client.post("/api/baseline", json=body)
    cached = client.post("/api/baseline", json=body).json()
    engine_cache.clear()
    fresh = client.post("/api/baseline", json=body).json()
    assert cached == fresh


def test_compare_is_cached(client, india_user_payload):
    body = _body(india_user_payload, strategy="avalanche", surplus_delta="2000")
    r1 = client.post("/api/sensitivity/compare", json=body)
    assert r1.status_code == 200
    m = engine_cache.misses
    assert client.post("/api/sensitivity/compare", json=body).json() == r1.json()
    assert engine_cache.misses == m


class _Req(BaseModel):
    user: dict
    horizon_months: int = 120


class _V(BaseModel):
    items: list[int]


def _req(n=0, **kw):
    return _Req(user={"country": "IN", "monthly_income": str(50000 + n), "loans": []}, **kw)


def test_bounded_and_lru():
    cache = EngineCache(maxsize=3)
    calls = []
    for n in range(5):
        cache.get_or_run("baseline", _req(n), lambda n=n: (calls.append(n), _V(items=[n]))[1])
    assert len(cache) == 3
    # 0 and 1 were evicted; 4 is still there.
    assert cache.get_or_run("baseline", _req(4), lambda: (calls.append("again"), _V(items=[-1]))[1]).items == [4]
    assert "again" not in calls
    cache.get_or_run("baseline", _req(0), lambda: (calls.append("zero"), _V(items=[0]))[1])
    assert "zero" in calls and len(cache) == 3


def test_returned_value_cannot_change_the_cached_one():
    cache = EngineCache(maxsize=2)
    v = cache.get_or_run("baseline", _req(), lambda: _V(items=[1]))
    v.items.append(2)
    again = cache.get_or_run("baseline", _req(), lambda: _V(items=[9]))
    assert again.items == [1]
    again.items.append(3)
    assert cache.get_or_run("baseline", _req(), lambda: _V(items=[9])).items == [1]


def test_key_is_canonical_and_includes_operation():
    a = _Req(user={"country": "IN", "monthly_income": "50000", "loans": []}, horizon_months=120)
    b = _Req.model_validate({"horizon_months": 120, "user": {"loans": [], "monthly_income": "50000", "country": "IN"}})
    assert canonical_key("baseline", a) == canonical_key("baseline", b)
    assert canonical_key("baseline", a) != canonical_key("simulate", a)
    assert canonical_key("baseline", a) != canonical_key("baseline", _req(1))


def test_size_zero_disables():
    cache = EngineCache(maxsize=0)
    n = []
    cache.get_or_run("baseline", _req(), lambda: (n.append(1), _V(items=[1]))[1])
    cache.get_or_run("baseline", _req(), lambda: (n.append(1), _V(items=[1]))[1])
    assert len(n) == 2 and len(cache) == 0


def test_ux2_20_lump_sum_compare_returns_both_answers_and_the_mode_used(client, india_user_payload):
    """UX2 #20: the what-if carries the loan under "lower EMI" and "finish
    sooner", and says which one the plan ran (none chosen: EMI kept)."""
    loans = india_user_payload["loans"]
    idx = next(i for i, l in enumerate(loans) if l["loan_type"] != "credit_card" and float(l["scheduled_emi"]) > 0)
    amount = str(round(float(loans[idx]["outstanding"]) * 0.2))
    base = {"user": india_user_payload, "horizon_months": 360, "lump_sum_amount": amount, "lump_sum_target_loan_index": idx}
    none = client.post("/api/sensitivity/compare", json=base).json()
    assert none["prepay_mode_used"] == "reduce_tenure"
    modes = {o["mode"]: o for o in none["prepay_options"]}
    assert set(modes) == {"reduce_tenure", "reduce_emi"}
    assert float(modes["reduce_emi"]["new_emi"]) < float(modes["reduce_emi"]["old_emi"])
    assert modes["reduce_tenure"]["new_months"] < modes["reduce_tenure"]["old_months"]
    lower = client.post("/api/sensitivity/compare", json={**base, "lump_sum_mode": "reduce_emi"})
    assert lower.status_code == 200 and lower.json()["prepay_mode_used"] == "reduce_emi"
    assert client.post("/api/sensitivity/compare", json={**base, "lump_sum_mode": "both"}).status_code == 422
