import { ActionTile } from '@/components/ActionTile';

export default function ToolsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 className="h1">Tools</h1>
      <p className="muted">
        Single-decision modules — each answers one question with one number
        and one chart.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <ActionTile
          label="Windfall handler"
          sub="§8a · Got a bonus?"
          href="/tools/windfall"
        />
        <ActionTile
          label="New debt check"
          sub="§8b · Should I take this EMI?"
          href="/tools/new-debt"
        />
        <ActionTile
          label="Asset liquidation"
          sub="§8c · Sell to clear debt?"
          href="/tools/liquidate"
        />
        <ActionTile
          label="Quick recompute"
          sub="§8d · I just paid extra"
          href="/tools/recompute"
        />
        <ActionTile
          label="Cash yield check"
          sub="§8e · Where is your cash sitting?"
          href="/tools/cash-yield"
        />
        <ActionTile
          label="Right time to borrow"
          sub="§8f · Wait or borrow now?"
          href="/tools/right-time"
        />
        <ActionTile
          label="NRI prepay vs invest"
          sub="§FX · Loan abroad, savings here?"
          href="/tools/nri-prepay"
        />
      </div>
    </div>
  );
}
