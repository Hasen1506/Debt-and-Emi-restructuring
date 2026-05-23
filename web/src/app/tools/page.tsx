'use client';

/**
 * Tools index — single-page inline-expand surface.
 *
 * Each tool advertises one decision; clicking [Open] expands the tool body
 * in place, with other tools collapsing to a one-liner. No route change, no
 * "where did I land" disorientation. The standalone `/tools/<name>` routes
 * still exist as deep-link fallbacks (and import the same body components).
 */

import { useState } from 'react';
import { WindfallTool } from './windfall/tool';
import { RecomputeTool } from './recompute/tool';
import { NewDebtTool } from './new-debt/tool';
import { LiquidateTool } from './liquidate/tool';
import { CashYieldTool } from './cash-yield/tool';
import { RightTimeTool } from './right-time/tool';
import { NriPrepayTool } from './nri-prepay/tool';
import { InvestVsPrepayDeepTool } from './invest-vs-prepay/tool';
import { PurchaseTool } from './purchase/tool';

type ToolKey =
  | 'windfall'
  | 'recompute'
  | 'new-debt'
  | 'liquidate'
  | 'cash-yield'
  | 'right-time'
  | 'nri-prepay'
  | 'invest-vs-prepay'
  | 'purchase';

interface ToolEntry {
  key: ToolKey;
  label: string;
  sub: string;
  explainer: string;
  Body: () => React.JSX.Element;
}

const TOOLS: ToolEntry[] = [
  {
    key: 'windfall',
    label: 'Windfall handler',
    sub: 'Bonus, refund, or gift just arrived',
    explainer:
      "Decides where a one-time inflow goes. Compares prepaying your highest-rate debt against topping up the emergency fund or parking in liquid until you allocate. Returns one number per option so you can pick without spreadsheets.",
    Body: WindfallTool,
  },
  {
    key: 'recompute',
    label: 'Quick recompute',
    sub: 'I paid extra this month',
    explainer:
      "After an off-cycle prepayment, re-runs the schedule from your new outstanding balance so the remaining months reflect reality — not the original loan terms.",
    Body: RecomputeTool,
  },
  {
    key: 'new-debt',
    label: 'New debt check',
    sub: 'Pre-borrow guard rail',
    explainer:
      "Should I take this EMI? Models the impact on surplus, total interest, and debt-free date before you sign anything. Flags if the new line pushes surplus negative.",
    Body: NewDebtTool,
  },
  {
    key: 'purchase',
    label: 'Purchase advisor',
    sub: 'Planning a house, car, or bike',
    explainer:
      "Models a planned big-ticket buy as a single decision: down-payment savings + loan EMI + tax benefit (regime-gated, no nudging) + depreciation caveats. Shows TCO and three levers — lower the price, push the date, or raise the down payment — when the current plan is tight.",
    Body: PurchaseTool,
  },
  {
    key: 'liquidate',
    label: 'Asset liquidation',
    sub: 'Sell to clear a loud debt',
    explainer:
      "Compares the after-tax proceeds of selling an asset against the interest you'd save by clearing the debt. Bakes in capital-gains tax and any reinvestment yield on the same cash.",
    Body: LiquidateTool,
  },
  {
    key: 'cash-yield',
    label: 'Cash yield check',
    sub: 'Audit where idle cash sits',
    explainer:
      "Money in a 3% savings account is losing to inflation. Surfaces sweep, liquid-fund, and HYSA options for your bank so the buffer earns its keep without locking it up.",
    Body: CashYieldTool,
  },
  {
    key: 'right-time',
    label: 'Right time to borrow',
    sub: 'Wait or borrow now?',
    explainer:
      "Reads market rate trends and your effective APR to flag whether borrowing today or waiting a quarter saves money. Useful before a planned home/auto loan.",
    Body: RightTimeTool,
  },
  {
    key: 'nri-prepay',
    label: 'NRI prepay vs invest',
    sub: 'FX-adjusted prepay decision',
    explainer:
      "Loan abroad, savings here? The prepay-vs-invest call has to account for currency drift, not just rate-vs-yield. Bakes in FX risk and remittance friction.",
    Body: NriPrepayTool,
  },
  {
    key: 'invest-vs-prepay',
    label: 'Invest vs prepay (deep-dive)',
    sub: 'Variable returns, downside check',
    explainer:
      "When the option you're weighing has a *range* of outcomes (equity, MF) instead of a single yield. Compares expected after-tax return against your loan rate, then checks what happens in the conservative (− 1σ) scenario. The /plan card handles the simple safe-vehicle case.",
    Body: InvestVsPrepayDeepTool,
  },
];

export default function ToolsPage() {
  const [open, setOpen] = useState<ToolKey | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h1 className="h1">Tools</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Single-decision modules — each answers one question with one number
          and one chart. Pick one to expand it here; the others collapse to
          one-liners so the page stays readable.
        </p>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TOOLS.map((t) => (
          <ToolRow
            key={t.key}
            entry={t}
            isOpen={open === t.key}
            onToggle={() => setOpen(open === t.key ? null : t.key)}
          />
        ))}
      </div>
    </div>
  );
}

function ToolRow({
  entry,
  isOpen,
  onToggle,
}: {
  entry: ToolEntry;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const Body = entry.Body;
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          width: '100%',
          padding: 16,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          alignItems: 'flex-start',
          gap: 12,
          color: 'var(--ink)',
        }}
        aria-expanded={isOpen}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15 }}>{entry.label}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {entry.sub}
            </span>
          </div>
          {!isOpen && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                marginTop: 6,
                color: 'var(--ink)',
              }}
            >
              {entry.explainer}
            </div>
          )}
        </div>
        <span
          aria-hidden
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {isOpen ? '[close]' : '[open]'}
        </span>
      </button>
      {isOpen && (
        <div
          style={{
            padding: '4px 16px 16px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <Body />
        </div>
      )}
    </div>
  );
}
