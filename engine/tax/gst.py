"""India's GST rate on financial services: the one place it is set.

18% applies to credit-card interest, processing fees, prepayment/penal
charges and balance-transfer fees. It used to be typed out in four engine
files and two web files; now every engine caller imports it from here and
the web reads it from tax-tables.json (scripts/export_tax_tables.py), so a
GST Council change is one edit.
"""
from decimal import Decimal

GST_RATE_IN = Decimal("0.18")
