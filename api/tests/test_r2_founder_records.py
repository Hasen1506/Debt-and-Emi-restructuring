"""Round 2: docs/FOUNDER-RECORDS.md section (c) lists every workflow
(scripts/check_founder_records.py, also run in CI job `health`)."""
import importlib.util
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("check_founder_records", ROOT / "scripts" / "check_founder_records.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def test_every_workflow_in_this_repo_has_an_entry():
    assert check.problems(ROOT) == []
    assert check.main(["--root", str(ROOT)]) == 0


def _copy(tmp_path: Path) -> Path:
    (tmp_path / "docs").mkdir()
    shutil.copy(ROOT / "docs" / "FOUNDER-RECORDS.md", tmp_path / "docs" / "FOUNDER-RECORDS.md")
    shutil.copytree(ROOT / ".github" / "workflows", tmp_path / ".github" / "workflows")
    return tmp_path


def test_a_new_workflow_without_an_entry_fails(tmp_path):
    root = _copy(tmp_path)
    (root / ".github" / "workflows" / "nightly-cleanup.yml").write_text("name: x\non: {schedule: [{cron: '0 0 * * *'}]}\n")
    bad = check.problems(root)
    assert len(bad) == 1 and "nightly-cleanup.yml" in bad[0]
    assert check.main(["--root", str(root)]) == 1


def test_an_entry_outside_section_c_or_without_if_it_stops_does_not_count(tmp_path):
    root = _copy(tmp_path)
    rec = root / "docs" / "FOUNDER-RECORDS.md"
    text = rec.read_text()
    # Move notify.yml's entry out of (c): name only in section (a).
    start = text.index("### `.github/workflows/notify.yml`")
    end = text.index("### `.github/workflows/db-backup.yml`")
    rec.write_text(text[:start] + text[end:] + "\n## (d) elsewhere\n`.github/workflows/notify.yml`\n")
    assert any("notify.yml" in b for b in check.problems(root))
    rec.write_text(text.replace("- **If it stops:** a crash on unusual input is caught later, if at all.", ""))
    assert any("fuzz.yml" in b and "If it stops" in b for b in check.problems(root))
