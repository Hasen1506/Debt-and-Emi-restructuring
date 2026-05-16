import { LiquidateTool } from './tool';

export default function LiquidatePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Should I sell this asset to clear debt?</h1>
        <p className="muted">
          Compares what you&apos;d net after tax + selling costs against the
          interest you&apos;d save by clearing debt — and checks whether the
          asset is actually out-earning the loan rate.
        </p>
      </section>
      <LiquidateTool />
    </div>
  );
}
