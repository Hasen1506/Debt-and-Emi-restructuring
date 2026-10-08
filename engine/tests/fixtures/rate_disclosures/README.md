Saved copies of each bank's own rate-disclosure page, fetched on 2026-10-08
(scripts, styles, images and attributes stripped, then gzipped), so the
parser tests in `engine/tests/test_rate_disclosures.py` run offline.
`pages.json` maps each live URL to its saved file. These are real pages, not
made-up numbers; refresh them when a bank changes its page layout.
