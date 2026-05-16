import { NewDebtTool } from './tool';

export default function NewDebtPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Should I take this EMI?</h1>
        <p className="muted">
          Pick the loan type and amount, see live EMIs across your existing
          banks, and check the verdict — including the hidden cost of a
          &ldquo;no-cost&rdquo; EMI when there&apos;s a cash discount on the
          table.
        </p>
      </section>
      <NewDebtTool />
    </div>
  );
}
