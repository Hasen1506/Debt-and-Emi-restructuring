/**
 * Tools index — the canonical list of every single-decision tool. Each home
 * surfaces 2-3 quick links to the most common ones, but the full catalog
 * with proper explainers lives here. If you find yourself duplicating a
 * tool list elsewhere, link here instead.
 */

const TOOLS = [
  {
    label: 'Windfall handler',
    sub: 'Bonus, refund, or gift just arrived',
    explainer:
      "Decides where a one-time inflow goes. Compares prepaying the loudest debt against topping up the emergency fund or parking in liquid until you allocate. Returns one number per option so you can pick without spreadsheets.",
    href: '/tools/windfall',
  },
  {
    label: 'Quick recompute',
    sub: 'I paid extra this month',
    explainer:
      "After an off-cycle prepayment, re-runs the schedule from your new outstanding balance so the remaining months reflect reality — not the original loan terms.",
    href: '/tools/recompute',
  },
  {
    label: 'New debt check',
    sub: 'Pre-borrow guard rail',
    explainer:
      "Should I take this EMI? Models the impact on surplus, total interest, and debt-free date before you sign anything. Flags if the new line pushes surplus negative.",
    href: '/tools/new-debt',
  },
  {
    label: 'Asset liquidation',
    sub: 'Sell to clear a loud debt',
    explainer:
      "Compares the after-tax proceeds of selling an asset against the interest you'd save by clearing the debt. Bakes in capital-gains tax and any reinvestment yield on the same cash.",
    href: '/tools/liquidate',
  },
  {
    label: 'Cash yield check',
    sub: 'Audit where idle cash sits',
    explainer:
      "Money in a 3% savings account is losing to inflation. Surfaces sweep, liquid-fund, and HYSA options for your bank so the buffer earns its keep without locking it up.",
    href: '/tools/cash-yield',
  },
  {
    label: 'Right time to borrow',
    sub: 'Wait or borrow now?',
    explainer:
      "Reads market rate trends and your effective APR to flag whether borrowing today or waiting a quarter saves money. Useful before a planned home/auto loan.",
    href: '/tools/right-time',
  },
  {
    label: 'NRI prepay vs invest',
    sub: 'FX-adjusted prepay decision',
    explainer:
      "Loan abroad, savings here? The prepay-vs-invest call has to account for currency drift, not just rate-vs-yield. Bakes in FX risk and remittance friction.",
    href: '/tools/nri-prepay',
  },
] as const;

export default function ToolsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section>
        <h1 className="h1">Tools</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Single-decision modules — each answers one question with one number
          and one chart. Use them when a specific situation comes up; the
          Plan page stays the persistent backdrop.
        </p>
      </section>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        {TOOLS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            style={{
              display: 'block',
              padding: 16,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              color: 'var(--ink)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>{t.label}</div>
            <div
              className="muted"
              style={{ fontSize: 12, marginTop: 2, marginBottom: 8 }}
            >
              {t.sub}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
              {t.explainer}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
