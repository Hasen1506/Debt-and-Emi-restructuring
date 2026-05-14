import Link from 'next/link';

export function ActionTile({
  label,
  sub,
  href,
}: {
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        color: 'var(--ink)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </Link>
  );
}
