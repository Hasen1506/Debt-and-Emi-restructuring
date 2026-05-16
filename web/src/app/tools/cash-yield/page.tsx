import { CashYieldTool } from './tool';

export default function CashYieldPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Is your cash earning its keep?</h1>
        <p className="muted">
          Compares your savings yield against the country&apos;s best liquid
          alternative and against prepaying your top loan.
        </p>
      </section>
      <CashYieldTool />
    </div>
  );
}
