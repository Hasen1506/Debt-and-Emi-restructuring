import { Card } from '@/components/Card';

export function ExistingDebts() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="h1">Your debts</h1>
      <p className="muted">Three active. Total outstanding ₹41,80,000.</p>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>HDFC Home Loan</div>
            <div className="muted" style={{ fontSize: 12 }}>
              8.5% · floating · 240 months left
            </div>
          </div>
          <div className="num">₹40,00,000</div>
        </div>
      </Card>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              ICICI Credit Card{' '}
              <span
                className="chip"
                style={{
                  marginLeft: 8,
                  color: 'var(--negative)',
                  borderColor: 'var(--negative)',
                }}
              >
                BT candidate
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              36% nominal · 42.48% effective with GST
            </div>
          </div>
          <div className="num">₹1,00,000</div>
        </div>
      </Card>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>SBI Personal Loan</div>
            <div className="muted" style={{ fontSize: 12 }}>
              13% · fixed · 36 months left
            </div>
          </div>
          <div className="num">₹80,000</div>
        </div>
      </Card>
      <button
        className="btn btn-primary"
        style={{ alignSelf: 'flex-start' }}
      >
        + Add a debt
      </button>
    </div>
  );
}
