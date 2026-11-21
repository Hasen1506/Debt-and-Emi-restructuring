# RightDue — Borrower Rights & Debt Recovery Platform

**Independent borrower software. Zero lender commissions. 100% local-first privacy.**

RightDue is a deterministic debt payoff, statutory rate-overcharge audit, and on-device bank SMS spend-leak workbench for India (₹) and US ($) borrowers.

## Core Capabilities

1. **Command Center**: Month-by-month debt execution plan ordered by **True All-In APR** (exposing India's 42% card = **60.31%** effective APR after monthly compounding + 18% GST, and New vs Old tax regime home loan effective cost), interactive Pay-This-Month ledger, live Recharts payoff trajectory, and "Where RightDue Disagrees with Plain Calculators" receipts.
2. **Loan Shield & Rights Audit**: Deterministic audit of RBI EBLR reset transmission (using verified RBI repo history through Oct 2026 at 5.50% and Fed funds at 4.00%), month-by-month floored refund annexure, MCLR-to-EBLR switch savings, "Ask Your Own Bank First" conversion vs balance transfer math, statutory third-person letter generator (Bank Grievance → Internal Ombudsman → RBI Integrated Ombudsman / US RESPA & FCBA), and escalation countdown tracker.
3. **On-Device SMS & Spend Pulse**: 100% browser-local parsing of bank SMS alerts and `.txt`/`.csv` exports (zero server upload, Play Store / App Store compliant without `READ_SMS`), automatic OTP & loan-promo stripping, 1-click EMI & card statement sync, and **Spend-Leak to Debt-Freedom Converter**.
4. **Check Before Signing**: Deterministic Bank RM & AI advice verifier, "Don't Sign That" No-Cost EMI / Loan Offer true-IRR auditor, and tax-aware Invest vs Prepay break-even calculator.
5. **Can't Pay Shield & Data Vault**: Zero-shame collateral protection triage, proactive hardship notice generator, live loan CRUD editor, and local JSON vault export/wipe.

## Quick Start

```bash
npm install
npm run test       # Run deterministic financial & regulatory engine unit tests
npm run dev        # Start Next.js 15 dev server on http://0.0.0.0:3000
npm run build      # Production standalone build
```
