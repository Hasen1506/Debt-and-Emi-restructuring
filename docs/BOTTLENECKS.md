# Bottlenecks

Known limits we have chosen to live with for now, and what would remove them.

## Legal review (privacy notice, terms, data handling) — sprint G8

No lawyer has checked the privacy notice (`/privacy`), the terms (`/terms`)
or docs/privacy-and-retention.md. Both pages say so. The alternative in place:
every legal statement cites the DPDP Act 2023 or DPDP Rules 2025 section it
rests on, read from the primary text on meity.gov.in (12 Oct 2026), and a test
(web/tests/g8-security-privacy.cjs) checks the notice still covers the items
rules 3, 9 and 14 ask for. **The right option** is a privacy lawyer's review
before 14 May 2027, when most DPDP duties apply, or before any paid tier.

## Processor contracts — sprint G8

DPDP Act s.8(2) asks for a valid contract with each Data Processor (Neon,
Render, Cloudflare, Resend, Sentry if used). We rely on each provider's
standard terms and data processing addendum; nothing has been reviewed or
signed specifically.
