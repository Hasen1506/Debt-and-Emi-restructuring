"""GST is set in one place (engine/tax/gst.py) and exported to the web.

Roadmap PR A (2026-10-07): the 18% rate was typed out in four engine files
and two web files, so a change would have to be made six times.
"""
import importlib.util
import re
from decimal import Decimal
from pathlib import Path

from engine.tax.gst import GST_RATE_IN

ROOT = Path(__file__).resolve().parents[2]


def test_one_gst_rate_in_engine_and_api():
    hits = []
    for base in ("engine", "api"):
        for f in (ROOT / base).rglob("*.py"):
            if "tests" in f.parts or f.name == "gst.py":
                continue
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r'D(ecimal)?\("0\.18"\)', line) and "apr" not in line.lower():
                    hits.append(f"{f.relative_to(ROOT)}:{n}")
    assert hits == [], f"GST typed outside engine/tax/gst.py: {hits}"


def test_callers_use_the_shared_rate():
    from engine import formulas, offer_compare, penalties

    assert formulas.GST_ON_CARD_INTEREST_IN is GST_RATE_IN
    assert offer_compare.GST_RATE_IN is GST_RATE_IN
    assert penalties._GST_RATE_IN is GST_RATE_IN
    assert GST_RATE_IN == Decimal("0.18")


def test_web_export_carries_gst():
    spec = importlib.util.spec_from_file_location("export_tax_tables", ROOT / "scripts" / "export_tax_tables.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.build()["in"]["gst"] == 0.18
