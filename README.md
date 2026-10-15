# RightDue

A debt payoff and EMI planner for borrowers in India and the USA: enter your
loans, cards and income, and RightDue's engine works out where each spare
rupee or dollar should go, what each debt really costs (fees, GST, tax
shield), and what your lender's terms mean for you. Plans are automatic
estimates, not financial advice. Live at https://rightdue.app.

## Layout

| Path | What it is |
| --- | --- |
| `engine/` | The math: a pure-Python library (amortisation, payoff orders, tax, fees). Its own [README](engine/README.md). |
| `api/` | FastAPI gateway over the engine, plus email sign-in, saved state and account data rights (`api/auth/`). |
| `web/` | The Next.js app. `web/public/welcome.html` is the public landing page. |
| `e2e/`, `web/e2e/` | Playwright journeys and the local API they run against. |
| `scripts/` | Data refreshers, exporters for golden fixtures, audit helpers. |
| `docs/` | Working notes: rates, payoff order, hosting, privacy and retention. `docs/planning/module-02-design-spec.md` is the engine's formula reference. Old planning notes, audit records and design mock-ups were moved out of the tree: [docs/ARCHIVE.md](docs/ARCHIVE.md) lists them and how to restore any of them. |
| `docs/CODE-HEALTH.md` | Size budgets, what the repo's lines are, where app state lives, and how CI is kept cheap. |
| `ROADMAP.md` | What is done and what is next. |
| `DEPLOY.md` | How the single Render service is deployed, and every setting it reads. |
| [`docs/FOUNDER-RECORDS.md`](docs/FOUNDER-RECORDS.md) | What needs the founder's sign-off (legal reviews, facts to verify), the defaults he approved, and every scheduled job / workflow / env flag the app relies on ("Always running"; CI fails if a workflow is missing). |

## Run the checks

The exact commands CI runs are in [.github/workflows/ci.yml](.github/workflows/ci.yml):
`python -m pytest engine/tests api/tests` for the engine and API, and in
`web/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, then `npx playwright test` for the browser journeys.

## Privacy

What the app stores, where, for how long, and how a user downloads or
deletes it: [docs/privacy-and-retention.md](docs/privacy-and-retention.md)
and the in-app notice at `/privacy`.
