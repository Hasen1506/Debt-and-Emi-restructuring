"""Export the engine's income-tax tables to web/src/lib/tax-tables.json.

The browser works out the marginal rate at onboarding and shows bracket
alerts on /plan. It used to keep its own copies of the tables, and two of
them were out of date (India's 2024 slabs, US 2024 and 2025 figures), so
an ₹18L salaried user was planned at 30% instead of about 21%. The engine
is the one source now; `engine/tests/test_tax_tables_export.py` fails if
the JSON falls behind.

Usage:
    python scripts/export_tax_tables.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.models import FilingStatusUS  # noqa: E402
from engine.tax import india, usa  # noqa: E402
from engine.tax.gst import GST_RATE_IN  # noqa: E402

OUT_PATH = ROOT / "web" / "src" / "lib" / "tax-tables.json"


def _num(d: Decimal) -> float | int | None:
    if d.is_infinite():
        return None
    return int(d) if d == d.to_integral_value() and abs(d) >= 1 else float(d)


def _slabs(rows) -> list[list]:
    return [[_num(limit), _num(rate)] for limit, rate in rows]


def build() -> dict:
    return {
        "as_of": "FY 2026-27 (IN) · TY 2026 (US)",
        "source": "engine/tax/india.py and engine/tax/usa.py · python scripts/export_tax_tables.py",
        "in": {
            "new": {
                "slabs": _slabs(india.NEW_REGIME_SLABS),
                "standard_deduction": _num(india.STANDARD_DEDUCTION_NEW_SALARIED),
                "rebate_87a": {
                    "threshold": _num(india.REBATE_87A_NEW_THRESHOLD),
                    "max": _num(india.REBATE_87A_NEW),
                },
            },
            "old": {
                "slabs": _slabs(india.OLD_REGIME_SLABS),
                "standard_deduction": _num(india.STANDARD_DEDUCTION_OLD_SALARIED),
                "rebate_87a": {
                    "threshold": _num(india.REBATE_87A_OLD_THRESHOLD),
                    "max": _num(india.REBATE_87A_OLD),
                },
            },
            # Old regime for residents aged 60-79 and 80+ (Finance Act 2026,
            # First Schedule Part I-B, Paragraph A (II), (III)).
            "old_60_79": {"slabs": _slabs(india.OLD_REGIME_SLABS_60_79)},
            "old_80_plus": {"slabs": _slabs(india.OLD_REGIME_SLABS_80_PLUS)},
            # Loan-related deductions (engine/tax/india.py, sprint G2).
            "deductions": {
                "sec24b_self_occupied_cap": _num(india.SEC24B_SELF_OCCUPIED_CAP),
                "sec24b_other_cap": _num(india.SEC24B_OTHER_CAP),
                "let_out_standard_deduction": _num(india.LET_OUT_STANDARD_DEDUCTION),
                "hp_loss_set_off_cap": _num(india.HP_LOSS_SET_OFF_CAP),
                "sec80c_cap": _num(india.SEC80C_CAP),
                "sec80ccd1b_cap": _num(india.SEC80CCD1B_CAP),
                "sec80e_tax_years": india.SEC80E_TAX_YEARS,
                "pre_construction_instalments": india.PRE_CONSTRUCTION_INSTALMENTS,
            },
            # 1961 section → Income-tax Act 2025 section.
            "section_map": dict(india.SECTION_MAP),
            "law_as_of": india.TAX_LAW_AS_OF,
            "law_source": india.TAX_LAW_SOURCE,
            "rates_source": india.TAX_RATES_SOURCE,
            "surcharge": _slabs(india.SURCHARGE_BANDS),
            "surcharge_cap_new_regime": _num(india.SURCHARGE_CAP_NEW_REGIME),
            "cess": _num(india.CESS_RATE),
            # GST on card interest, fees and charges (engine/tax/gst.py).
            "gst": _num(GST_RATE_IN),
        },
        "us": {
            status.value: {
                "slabs": _slabs(usa.BRACKETS_2026[status]),
                "standard_deduction": _num(usa.STANDARD_DEDUCTION_2026[status]),
            }
            for status in FilingStatusUS
        },
    }


def render() -> str:
    return json.dumps(build(), indent=2) + "\n"


def main() -> int:
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
