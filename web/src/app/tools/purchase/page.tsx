import { PurchaseTool } from './tool';

export default function PurchasePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Can I afford this purchase?</h1>
        <p className="muted">
          Models a planned big-ticket buy — house, vehicle, or other — against
          your current surplus, regime-gated tax benefit, and the loan you&apos;d
          need. Shows TCO and three levers when the plan is tight.
        </p>
      </section>
      <PurchaseTool />
    </div>
  );
}
