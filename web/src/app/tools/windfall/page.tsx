import { WindfallTool } from './tool';

export default function WindfallPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Got a bonus — where should it go?</h1>
        <p className="muted">
          Compares prepaying your loudest debt against topping up the
          emergency fund or parking the cash in liquid — and tells you the
          single best home for it.
        </p>
      </section>
      <WindfallTool />
    </div>
  );
}
