import { Card } from '@/components/Card';

export function ExistingInsights() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="h1">Insights</h1>
      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Rate-change notification · 7 Apr 2026
        </div>
        <div style={{ fontWeight: 600, marginTop: 4 }}>
          RBI held repo at 5.25%
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Your floating home loan was last reset on 1 Jan 2026 at 8.5%. No
          change expected at your next reset.
        </div>
      </Card>
      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Educational · This week
        </div>
        <div style={{ fontWeight: 600, marginTop: 4 }}>
          Why "no-cost EMI" isn't really 0%
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          The retailer bakes the cost into either a foregone discount or a
          processing fee. Real APR is usually 14–18%.
        </div>
      </Card>
    </div>
  );
}
