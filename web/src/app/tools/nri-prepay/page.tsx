import { NriPrepayTool } from './tool';

export default function NriPrepayPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Loan back home — prepay from foreign savings?</h1>
        <p className="muted">
          You earn in one currency, your loan accrues in another. We weigh the
          FX-adjusted loan cost against your post-tax yield and call it.
        </p>
      </section>
      <NriPrepayTool />
    </div>
  );
}
