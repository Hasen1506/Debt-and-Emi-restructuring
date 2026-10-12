"""Debt & EMI Restructuring Optimiser engine.

Pure-function library. All currency math uses Decimal — never float.
Formulas keyed to docs/planning/module-02-design-spec.md §4.1–§4.23.
"""
from decimal import getcontext
getcontext().prec = 28
