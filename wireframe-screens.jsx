// Wireframe screens for Module 02 — Home in three modes.
// All visual chrome lives in wireframes-home.html's stylesheet so these
// components stay close to pure structure.

const { Fragment } = React;

// ── shared ─────────────────────────────────────────────────────────────
function TopBar({ countryFlag = '🇮🇳', countryCode = 'IN', settings = '⚙' }) {
  return (
    <header className="wf-top">
      <span className="country-chip">{countryFlag} {countryCode}</span>
      <span className="settings-icon">{settings}</span>
    </header>
  );
}

function ToolsRow({ compact = false }) {
  const items = [
    { code: 'W', name: 'Windfall' },
    { code: 'N', name: 'New EMI?' },
    { code: 'S', name: 'Sell asset?' },
    { code: '✓', name: 'Paid extra' },
    { code: '$', name: 'Cash yield' },
    { code: '⏳', name: 'Wait or borrow?' },
  ];
  return (
    <div>
      <div className="label">Tools</div>
      <div className="tools">
        {items.map(t => (
          <div className="tool" key={t.code}>
            <div className="tool-icon">{t.code}</div>
            <div>{t.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeFooter({ mode = 'Simple', tone = 'Calm' }) {
  return (
    <footer className="wf-footer">
      <span className="overwhelm-link">feeling overwhelmed?</span>
      <span className="mode-toggle">
        <span className={mode === 'Simple' ? 'on' : ''}>Simple</span>
        <span className={mode === 'Detailed' ? 'on' : ''}>Detailed</span>
      </span>
    </footer>
  );
}

// ── 01 · SIMPLE × CALM (the default) ──────────────────────────────────
function HomeSimpleCalm() {
  return (
    <div className="wf">
      <TopBar />
      <div className="body">

        {/* HEADLINE — the killer output */}
        <div className="card card-headline">
          <div className="label">Your debt-free date</div>
          <div className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
            <div className="big-number">Aug 2027</div>
            <div className="meta" style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--positive)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                14 months earlier
              </div>
              <div style={{ fontSize: 10 }}>vs. minimums-only</div>
            </div>
          </div>
          <div className="row" style={{ paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
            <div>
              <div className="meta-mono">Total owed</div>
              <div className="med-number">₹46,80,000</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="meta-mono">Interest saved</div>
              <div className="med-number" style={{ color: 'var(--positive)' }}>₹2,18,400</div>
            </div>
          </div>
        </div>

        {/* THIS MONTH'S ACTION — the one-thing-to-do card */}
        <div className="card action">
          <div className="label label-accent">This month · do this</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4, letterSpacing: '-0.01em' }}>
            Pay extra ₹10,000 to
          </div>
          <div className="med-number" style={{ fontSize: 16, marginBottom: 12 }}>
            Kotak Credit Card
          </div>
          <div className="meta" style={{ marginBottom: 14 }}>
            Highest effective rate in your portfolio (38%). Every rupee here
            saves you more than anywhere else.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-block" style={{ flex: 1 }}>I made this payment</button>
            <button className="btn btn-secondary" style={{ flex: '0 0 auto' }}>Why?</button>
          </div>
        </div>

        {/* INSIGHT (rotates daily) */}
        <div className="card card-soft">
          <div className="label">Today's insight</div>
          <div className="insight-line">
            Your real interest rate on the Kotak card is{' '}
            <span className="accent">42%</span>, not 36%. The bundled fees
            and GST add 6 percentage points.{' '}
            <span style={{ textDecoration: 'underline', color: 'var(--muted)' }}>
              See the breakdown →
            </span>
          </div>
        </div>

        <ToolsRow />

      </div>
      <ModeFooter mode="Simple" tone="Calm" />
    </div>
  );
}

// ── 02 · DETAILED × CALM ──────────────────────────────────────────────
function HomeDetailedCalm() {
  return (
    <div className="wf wf-detailed">
      <TopBar />
      <div className="body">

        {/* HEADLINE WITH SENSITIVITY BAND */}
        <div className="card card-headline">
          <div className="label">
            Debt-free date <span className="stars">
              <span className="star-on">★</span>
              <span className="star-on">★</span>
              <span className="star-on">★</span>
              <span className="star-on">★</span>
              <span>★</span>
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
            <div>
              <div className="big-number" style={{ fontSize: 26 }}>Jul – Oct 2027</div>
              <div className="meta-mono" style={{ marginTop: 4 }}>
                80% confidence · central: Aug 14, 2027
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="meta-mono" style={{ color: 'var(--positive)' }}>−14 mo</div>
              <div className="meta-mono">vs. min.</div>
            </div>
          </div>
          <div className="ph ph-sparkline">debt-reduction trajectory · 4 strategies overlaid</div>
        </div>

        {/* DEBT PORTFOLIO ROLL-UP — what makes Detailed Detailed */}
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="label" style={{ margin: 0 }}>Your debts · by priority</div>
            <span className="meta-mono">post-tax effective</span>
          </div>
          <div className="debt-row">
            <span className="rank">1</span>
            <span className="name">Kotak Credit Card
              <span className="name-sub">multi-tier · cash adv. 48%</span>
            </span>
            <span className="rate">38.0%</span>
            <span className="bal">₹65k</span>
          </div>
          <div className="debt-row">
            <span className="rank">2</span>
            <span className="name">HDFC Personal Loan
              <span className="name-sub">fixed · 18 mo left</span>
            </span>
            <span className="rate">14.5%</span>
            <span className="bal">₹1.8L</span>
          </div>
          <div className="debt-row">
            <span className="rank">3</span>
            <span className="name">SBI Auto Loan
              <span className="name-sub">floating · last RBI ↓ applied</span>
            </span>
            <span className="rate">10.2%</span>
            <span className="bal">₹2.4L</span>
          </div>
          <div className="debt-row">
            <span className="rank rank-low">4</span>
            <span className="name">HDFC Home Loan
              <span className="name-sub">floating · Sec 24 shield active</span>
            </span>
            <span className="rate" style={{ color: 'var(--positive)' }}>7.3%</span>
            <span className="bal">₹38L</span>
          </div>
        </div>

        {/* THIS MONTH ACTION (compact form) */}
        <div className="card action">
          <div className="label label-accent">This month · do this</div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Pay extra ₹10,000 → Kotak CC</div>
              <div className="meta-mono">saves ₹3,200 this cycle · MoM −2.1 mo to zero</div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '8px 12px' }}>Done</button>
          </div>
        </div>

        {/* DIAGNOSTICS STRIP — Detailed only */}
        <div>
          <div className="label">Plan diagnostics</div>
          <div className="sens">
            <div>
              <div className="lbl">Rate +1%</div>
              <div className="val">+3 mo</div>
            </div>
            <div>
              <div className="lbl">Surplus −10%</div>
              <div className="val">+5 mo</div>
            </div>
            <div>
              <div className="lbl">Job loss 3mo</div>
              <div className="val">+9 mo</div>
            </div>
          </div>
        </div>

        {/* INSIGHT */}
        <div className="card card-soft">
          <div className="label">Insight · click to expand math</div>
          <div className="insight-line">
            Your real Kotak rate is <span className="accent">41.7%</span> after fees
            +18% GST. <span className="meta-mono">[show formula ↓]</span>
          </div>
        </div>

        <ToolsRow />

      </div>
      <ModeFooter mode="Detailed" tone="Calm" />
    </div>
  );
}

// ── 03 · SIMPLE × OVERWHELMED ─────────────────────────────────────────
function HomeSimpleOverwhelmed() {
  return (
    <div className="wf wf-overwhelmed">
      <TopBar />
      <div className="body" style={{ justifyContent: 'flex-start', gap: 24, paddingTop: 32 }}>

        <div className="breath-card">
          <div className="breath-h">Take a breath. You're going to be okay.</div>

          <div style={{ marginBottom: 20 }}>
            <div className="label" style={{ color: 'var(--soft)', marginBottom: 8 }}>
              one step this week
            </div>
            <div className="breath-action">
              Pay ₹10,000 to your Kotak credit card.
            </div>
            <div className="meta" style={{ lineHeight: 1.6 }}>
              That's the single most useful thing you can do right now.
              Nothing else needs to be decided today.
            </div>
          </div>

          <button className="breath-cta">I'll do this</button>

          <div style={{
            marginTop: 14, fontSize: 11, color: 'var(--soft)',
            textAlign: 'center', fontFamily: 'var(--font-mono)'
          }}>
            or · let me see the full plan
          </div>
        </div>

        <div style={{ padding: '0 4px' }}>
          <div className="meta" style={{ textAlign: 'center', fontStyle: 'italic' }}>
            We've hidden your 3-year horizon, total debt, and the rest of
            your debts on purpose. They'll be here when you're ready.
          </div>
        </div>

      </div>
      <footer className="wf-footer">
        <span className="overwhelm-link" style={{ color: 'var(--muted)' }}>
          back to calm view
        </span>
        <span className="meta-mono">Simple · Overwhelmed</span>
      </footer>
    </div>
  );
}

// ── Designer's notes card ─────────────────────────────────────────────
function NotesCard() {
  return (
    <div style={{
      padding: 28, background: '#fff', height: '100%', overflow: 'auto',
      fontFamily: 'var(--font-sans)', color: 'var(--ink)', fontSize: 13, lineHeight: 1.6
    }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--soft)', marginBottom: 8, fontFamily: 'var(--font-mono)'
      }}>How to read these wireframes</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 18, letterSpacing: '-0.01em' }}>
        Three live mode combinations, one underlying data set.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--accent)', marginBottom: 8, letterSpacing: '0.06em'
          }}>01 · SIMPLE × CALM</div>
          <p style={{ marginBottom: 10 }}>
            The default. One sentence + one number per insight. The headline
            is a date the user can feel. The action card is the single most
            valuable thing they can do this month.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            <strong>Test it by asking:</strong> can a stressed user know what
            to do in 10 seconds without scrolling?
          </p>
        </div>

        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--accent)', marginBottom: 8, letterSpacing: '0.06em'
          }}>02 · DETAILED × CALM</div>
          <p style={{ marginBottom: 10 }}>
            Same Home, but: sensitivity band on the date, full debt portfolio
            sorted by priority, post-tax effective rates visible, plan
            diagnostics strip, confidence stars on every number.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            <strong>Test it by asking:</strong> can a power user audit our
            math and disagree productively?
          </p>
        </div>

        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--accent)', marginBottom: 8, letterSpacing: '0.06em'
          }}>03 · SIMPLE × OVERWHELMED</div>
          <p style={{ marginBottom: 10 }}>
            One card. One action. Soft palette. Long horizons and total-debt
            numbers are deliberately hidden — they cause spirals. The "or ·
            full plan" link is the escape hatch, not the focus.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            <strong>Test it by asking:</strong> would a panicked late-night
            user feel calmer after 30 seconds on this screen?
          </p>
        </div>
      </div>

      <div style={{
        marginTop: 24, paddingTop: 16, borderTop: '1px dashed var(--border)',
        fontSize: 12, color: 'var(--muted)'
      }}>
        <strong style={{ color: 'var(--ink)' }}>Intentionally placeholder:</strong>{' '}
        the rate-trajectory sparkline (artboard 02), tool icons (single letters
        instead of real glyphs), exact colour palette. These wait for the
        visual-language decision (open question 1 in the design spec).
      </div>
    </div>
  );
}

// Expose to global scope for the inline App component
Object.assign(window, {
  HomeSimpleCalm,
  HomeDetailedCalm,
  HomeSimpleOverwhelmed,
  NotesCard,
});
