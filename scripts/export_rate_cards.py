"""Export engine rate cards to web/src/lib/rate-cards.json.

The frontend reads rate ranges to surface in Setup tooltips and Debts
breakdowns ("typical HDFC home-loan range: 7.75-8.15%"). Until live
scrapers exist, this script is the bridge from the hand-seeded
engine constants to the frontend.

Once live scrapers exist, they will write directly to the same JSON
file in the same shape, so this script becomes redundant.

Usage:
    python scripts/export_rate_cards.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.rate_cards import ALL_INSTITUTIONS, InstitutionRateCard  # noqa: E402


def _decimal(d: Decimal | None) -> str | None:
    return None if d is None else format(d, 'f')


def _card_to_dict(card: InstitutionRateCard) -> dict:
    cc = card.credit_card
    return {
        'institution_id': card.institution_id,
        'country': card.country.value if hasattr(card.country, 'value') else str(card.country),
        'name': card.name,
        'scrape_tier': card.scrape_tier,
        'home_loan': _range(card.home_loan),
        'personal_loan': _range(card.personal_loan),
        'auto_loan': _range(card.auto_loan),
        'education_loan': _range(card.education_loan),
        'credit_card': None if cc is None else {
            'apr_low': _decimal(cc.apr_low),
            'apr_high': _decimal(cc.apr_high),
            'cash_advance_low': _decimal(cc.cash_advance_low),
            'cash_advance_high': _decimal(cc.cash_advance_high),
            'bt_promo_rate': _decimal(cc.bt_promo_rate),
            'bt_promo_months': cc.bt_promo_months,
            'bt_fee_pct': _decimal(cc.bt_fee_pct),
        },
        'processing_fee_pct': _decimal(card.processing_fee_pct),
        'prepayment_penalty_floating': _decimal(card.prepayment_penalty_floating),
        'last_verified': card.last_verified,
        'is_indicative': card.is_indicative,
    }


def _range(r) -> dict | None:
    if r is None:
        return None
    return {'low': _decimal(r.low), 'high': _decimal(r.high)}


def main() -> int:
    out_path = ROOT / 'web' / 'src' / 'lib' / 'rate-cards.json'
    by_name = {name: _card_to_dict(card) for name, card in ALL_INSTITUTIONS.items()}
    last_verified_set = {c['last_verified'] for c in by_name.values()}
    last_verified = sorted(last_verified_set)[-1]  # most recent
    payload = {
        'as_of': last_verified,
        'source': 'engine/rate_cards.py · seeded May 2026 · indicative until scrapers land',
        'institutions': by_name,
    }
    out_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {out_path.relative_to(ROOT)} · {len(by_name)} institutions · as_of {last_verified}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
