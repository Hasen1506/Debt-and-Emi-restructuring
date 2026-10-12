/**
 * Plan-page loading state. Rendered by the App Router while the server
 * component awaits the engine's /simulate call so the user sees something
 * happening instead of a blank screen on slow / cold-start requests.
 * Theme-agnostic — uses CSS variables so it picks up the active palette.
 */
export default function PlanLoading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '32px 0',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft, var(--muted))',
        }}
      >
        Computing your plan…
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--muted)',
          maxWidth: 520,
          lineHeight: 1.6,
        }}
      >
        Checking your saved balances, payoff order and goals. Unchanged
        calculations are reused; a sleeping test server can take longer to wake.
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <SkeletonBlock height={64} />
        <SkeletonBlock height={260} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <SkeletonBlock height={84} />
          <SkeletonBlock height={84} />
          <SkeletonBlock height={84} />
        </div>
      </div>
      <style>{`
        @keyframes rightdue-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}

function SkeletonBlock({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        animation: 'rightdue-pulse 1.4s ease-in-out infinite',
      }}
    />
  );
}
