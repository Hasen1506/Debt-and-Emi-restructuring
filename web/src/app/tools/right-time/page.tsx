import { RightTimeTool } from './tool';

export default function RightTimePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h1 className="h1">Wait for a rate cut, or lock in now?</h1>
        <p className="muted">
          Picks the current median rate from your bank&apos;s published card,
          weighs it against the consensus on the next central-bank decision,
          and tells you whether the wait is worth it.
        </p>
      </section>
      <RightTimeTool />
    </div>
  );
}
