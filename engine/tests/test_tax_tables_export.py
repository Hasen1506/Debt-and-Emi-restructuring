"""The browser's tax tables are exported from the engine. If this fails,
run `python scripts/export_tax_tables.py` and commit the JSON."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _exporter():
    spec = importlib.util.spec_from_file_location(
        "export_tax_tables", ROOT / "scripts" / "export_tax_tables.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_web_tax_tables_match_the_engine():
    mod = _exporter()
    committed = mod.OUT_PATH.read_text(encoding="utf-8")
    assert committed == mod.render(), (
        "web/src/lib/tax-tables.json is out of date: "
        "run python scripts/export_tax_tables.py"
    )


def test_export_has_current_figures():
    data = _exporter().build()
    assert data["in"]["new"]["slabs"][0] == [400000, 0]
    assert data["in"]["new"]["slabs"][-1] == [None, 0.3]
    assert data["in"]["new"]["rebate_87a"] == {"threshold": 1200000, "max": 60000}
    assert data["us"]["single"]["standard_deduction"] == 16100
    assert set(data["us"]) == {"single", "mfj", "hoh"}
