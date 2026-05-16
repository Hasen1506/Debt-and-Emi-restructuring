import { RecomputeTool } from './tool';

export default function RecomputePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">I just paid extra — where does that leave me?</h1>
        <p className="muted">
          Reruns the full schedule with the lump-sum applied and tells you how
          much closer to debt-free you are now.
        </p>
      </section>
      <RecomputeTool />
    </div>
  );
}
