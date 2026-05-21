import { InvestVsPrepayDeepTool } from './tool';

export default function InvestVsPrepayPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Invest the surplus, or prepay the loan?</h1>
        <p className="muted">
          The deep-dive version: when the option you&apos;re weighing has a
          range of outcomes (equity, mutual funds), not a single quoted yield.
          Compares expected after-tax return against your loan rate, then
          checks what happens in the conservative (− 1σ) scenario.
        </p>
      </section>
      <InvestVsPrepayDeepTool />
    </div>
  );
}
