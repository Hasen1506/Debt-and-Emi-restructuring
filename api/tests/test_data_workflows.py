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


def test_policy_rates_run_weekly_not_in_the_app():
    _, on = _load("policy-rates.yml")
    assert [c["cron"] for c in on["schedule"]] == ["0 3 * * 1"] and "workflow_dispatch" in on
    src = (ROOT / "api" / "rates_feed.py").read_text()
    assert "threading.Thread" not in src and "REFRESH_EVERY" not in src


def test_data_pr_action_waits_for_ci_and_can_wait_for_review():
    action = yaml.safe_load((ROOT / ".github" / "actions" / "data-pr" / "action.yml").read_text())
    run = action["runs"]["steps"][0]["run"]
    assert "gh pr create" in run and "gh pr merge" in run
    # audit80 D17: never a direct push to main; auto-merge after the CI checks.
    assert 'HEAD:$BASE' not in run, "no direct push to main when a PR can't be opened"
    assert "--auto" in run and "gh workflow run ci.yml" in run
    assert '"$MODE" = "review"' in run
