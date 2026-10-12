"""Sprint G4 (grill #41): the TS-mirror golden fixture is current."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _exporter():
    spec = importlib.util.spec_from_file_location("export_mirror_cases", ROOT / "scripts" / "export_mirror_cases.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mirror_fixture_is_current():
    mod = _exporter()
    assert mod.OUT_PATH.read_text(encoding="utf-8") == mod.render(), (
        "engine/tests/fixtures/mirror_cases.json is stale: run python scripts/export_mirror_cases.py"
    )


def test_mirror_fixture_covers_every_bank():
    import json
    from engine.minimum_payments import INDIA_MIN_PAYMENT_FORMULAS, USA_MIN_PAYMENT_FORMULAS
    d = json.loads(_exporter().OUT_PATH.read_text(encoding="utf-8"))
    banks = {c["in"]["bank"] for c in d["min_payment"]}
    assert set(INDIA_MIN_PAYMENT_FORMULAS) | set(USA_MIN_PAYMENT_FORMULAS) <= banks
    assert "" in banks  # the country defaults
