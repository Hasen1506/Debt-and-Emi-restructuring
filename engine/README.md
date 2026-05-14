# Engine

Pure-function Python library implementing the math from [module-02-design-spec.md](../module-02-design-spec.md) §4.1–§4.23. All currency math uses `Decimal` — never `float`.

## Layout
- `models.py` — User, Loan, Asset, PFBalance, InvestmentOption dataclasses
- `formulas.py` — EMI, effective_rate, real_emi, pretax_equiv, prepay_recommended
- `tax/india.py` — FY2026-27 slabs, 87A rebate, surcharge bands, cess
- `tax/usa.py` — Tax Year 2026 brackets, standard deduction, itemisation
- `tests/` — pytest suite verifying spec worked examples

## Run tests
```bash
cd /workspaces/Debt-and-Emi-restructuring
python -m pytest engine/tests/ -v
```

## Data verified May 2026
- India FY2026-27 slabs unchanged from FY2025-26 (Budget 2026-27)
- EPF 8.25% (FY2025-26 retained Mar 2 2026)
- PPF 7.1% (Q1 FY2026-27)
- US Tax Year 2026 brackets and standard deductions (IRS Rev Proc 2025-32)

See [§7.9 in the design spec](../module-02-design-spec.md) for source URLs and refresh cadence.

## Status
Scaffold only. Remaining: Layer 0/1/2 (employer match, restructuring, ordering), decision sub-modules §8a–§8f, asset liquidation §4.18, country data store.
