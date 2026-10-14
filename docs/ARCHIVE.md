# Archive: what left the working tree, and how to get it back

Audit 80 E22 / E14 (W9, 14 Oct 2026). These files were planning notes, round-by-round audit records,
one-off audit scripts and design mock-ups. None is imported, built, deployed or run by CI; none is a
product feature. They are removed from `main`'s working tree so every reader (the founder, a reviewer,
an agent's context window) stops paying for them. **Nothing is lost**: every file is in git history at
commit `4bc3dc8` (origin/main on 14 Oct 2026).

Restore one file: `git show 4bc3dc8:"<path>" > "<path>"`  
Restore all of them: `git checkout 4bc3dc8 -- design docs/history docs/planning scripts/audit-browser.cjs` (and so on).

Founder option: push a tag so the snapshot has a name: `git tag archive/pre-a80-cleanup 4bc3dc8 && git push origin archive/pre-a80-cleanup`.

Kept on purpose: `docs/planning/module-02-design-spec.md` (the engine's formula reference, cited by `engine/README.md` and `engine/__init__.py`).

Total removed: 36 files, 13,054 lines, 900 KB.

| Path | Lines | KB | What it was |
|---|---:|---:|---|
| `design/ledger-v2/App Insides - Ledger.html` | 87 | 7 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/HANDOFF.md` | 380 | 21 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/app-content.js` | 250 | 9 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/design-canvas.jsx` | 966 | 48 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/ledger-skin-home.jsx` | 353 | 19 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/ledger-skin-rest.jsx` | 437 | 27 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/ledger-skin-v2-screens.jsx` | 1146 | 76 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/ledger-v2/ledger-skin-v2.jsx` | 1088 | 70 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/refresh/README.md` | 467 | 25 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/refresh/references/INDEX.md` | 42 | 2 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/refresh/references/design-canvas.jsx` | 31 | 1 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/refresh/references/direction-a.jsx` | 237 | 12 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/refresh/references/direction-d.jsx` | 173 | 8 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/render/h.html` | 7 | 1 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/render/tx.js` | 8 | 1 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/strategy-personas/Strategy Personas.html` | 923 | 48 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/strategy-personas/strategy-personas.css` | 503 | 17 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/wireframes/wireframe-screens.jsx` | 380 | 14 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/wireframes/wireframes-home.html` | 630 | 23 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `design/wireframes/wireframes.md` | 474 | 35 | design mock-up / handoff (not shipped; the app is the source of truth now) |
| `docs/audit-rounds-6-8-fixes.md` | 95 | 12 | round 6-8 fix log |
| `docs/history/AUDIT.md` | 541 | 73 | record of past audits and the five-tab redesign |
| `docs/history/REDESIGN.md` | 398 | 47 | record of past audits and the five-tab redesign |
| `docs/planning/LEDGER_MISSING.md` | 376 | 24 | original brainstorm, research notes, transcription, scraper plan |
| `docs/planning/Researching Debt App Improvement Questions.md` | 237 | 33 | original brainstorm, research notes, transcription, scraper plan |
| `docs/planning/module-02-debt-emi-brainstorm.md` | 1131 | 76 | original brainstorm, research notes, transcription, scraper plan |
| `docs/planning/module-02-rate-scraper-plan.md` | 379 | 16 | original brainstorm, research notes, transcription, scraper plan |
| `docs/planning/notes_transcription.md` | 324 | 10 | original brainstorm, research notes, transcription, scraper plan |
| `docs/planning/research-philosophy.md` | 42 | 6 | original brainstorm, research notes, transcription, scraper plan |
| `docs/pr10-12-audit-fixes.md` | 58 | 6 | PR 10-12 fix log |
| `scripts/audit-browser.cjs` | 165 | 20 | one-off live-site audit script from a past round |
| `scripts/audit-latest.cjs` | 147 | 26 | one-off live-site audit script from a past round |
| `scripts/audit-plan.cjs` | 128 | 29 | one-off live-site audit script from a past round |
| `scripts/audit-post-merge.cjs` | 113 | 15 | one-off live-site audit script from a past round |
| `scripts/pr21-regressions.cjs` | 156 | 10 | one-off regression script for PR 21/23 (superseded by web/tests) |
| `scripts/pr23-regressions.cjs` | 182 | 16 | one-off regression script for PR 21/23 (superseded by web/tests) |
