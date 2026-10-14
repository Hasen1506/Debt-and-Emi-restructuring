"""Grill #61/#65: the data bots' workflows stay cheap and go through a PR.

Static checks on .github/: each data workflow runs only its data tests,
proposes changes through the shared data-pr action (never a bare
`git push` to main), and the policy-rate fetch is a weekly job, not a
thread in the API.
"""
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")  # comes with uvicorn[standard]

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows"
BOTS = {"market-data.yml": "market-data", "rate-disclosures.yml": "rate-disclosures",
        "policy-rates.yml": "policy-rates"}


def _load(name):
    data = yaml.safe_load((WF / name).read_text())
    # PyYAML reads the bare key `on` as True.
    return data, data.get("on", data.get(True))


def test_every_data_bot_proposes_a_pr_and_never_pushes_to_main():
    for name, bot in BOTS.items():
        data, _ = _load(name)
        assert data["permissions"].get("pull-requests") == "write", name
        steps = [s for job in data["jobs"].values() for s in job["steps"]]
        uses = [s for s in steps if s.get("uses") == "./.github/actions/data-pr"]
        assert len(uses) == 1 and uses[0]["with"]["bot"] == bot, name
        for s in steps:
            assert "git push" not in s.get("run", ""), f"{name}: bare git push in {s.get('name')}"


def test_data_bots_run_only_data_tests():
    for name in BOTS:
        text = (WF / name).read_text()
        assert "pytest -q engine api" not in text and "npm test" not in text, name
        assert "playwright test" not in text, name


def _schedule_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("policy_rate_schedule", ROOT / "scripts" / "policy_rate_schedule.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_policy_rates_run_weekly_not_in_the_app():
    _, on = _load("policy-rates.yml")
    crons = [c["cron"] for c in on["schedule"]]
    assert crons[0] == "0 3 * * 1" and "workflow_dispatch" in on
    src = (ROOT / "api" / "rates_feed.py").read_text()
    assert "threading.Thread" not in src and "REFRESH_EVERY" not in src


def test_data_pr_action_falls_back_and_can_wait_for_review():
    action = yaml.safe_load((ROOT / ".github" / "actions" / "data-pr" / "action.yml").read_text())
    run = action["runs"]["steps"][0]["run"]
    assert "gh pr create" in run and "gh pr merge" in run
    assert 'HEAD:$BASE' in run, "falls back to a direct push when Actions may not open PRs"
    assert '"$MODE" = "review"' in run


# Audit 80+ A19: the public RBI-decision page should show a decision the day it
# is made. The decision-day cron lines must match the published MPC calendar.
def test_policy_rates_also_run_on_every_scheduled_mpc_day():
    import json
    sched = _schedule_module()
    cal = json.loads((ROOT / "api" / "data" / "central_bank_calendar.json").read_text())
    _, on = _load("policy-rates.yml")
    crons = [c["cron"] for c in on["schedule"]]
    assert crons == [sched.WEEKLY] + sched.crons(cal), (
        "run `python scripts/policy_rate_schedule.py write` after editing the MPC calendar")
    days = sched.mpc_days(cal)
    assert days, "no scheduled MPC meeting in the calendar"
    # Few runs: weekly + one per meeting (the RBI meets six times a year).
    assert len(crons) <= 1 + 7


def test_policy_rates_gate_skips_a_cron_line_fired_in_a_later_year():
    import json
    from datetime import date, timedelta
    sched = _schedule_module()
    cal = json.loads((ROOT / "api" / "data" / "central_bank_calendar.json").read_text())
    for d in sched.mpc_days(cal):
        line = sched.cron_for(d)
        assert sched.should_run("schedule", line, d, cal)[0]
        assert not sched.should_run("schedule", line, d.replace(year=d.year + 1), cal)[0]
        assert not sched.should_run("schedule", line, d + timedelta(days=1), cal)[0]
    any_day = date(2031, 3, 3)
    assert sched.should_run("schedule", sched.WEEKLY, any_day, cal)[0]
    assert sched.should_run("workflow_dispatch", "", any_day, cal)[0]


def test_policy_rates_fetch_job_waits_for_the_gate():
    data, _ = _load("policy-rates.yml")
    fetch = data["jobs"]["fetch"]
    assert fetch["needs"] == "gate" and "needs.gate.outputs.run == 'true'" in fetch["if"]
    gate_steps = data["jobs"]["gate"]["steps"]
    assert not any("setup-python" in s.get("uses", "") for s in gate_steps), "gate stays seconds-cheap"
