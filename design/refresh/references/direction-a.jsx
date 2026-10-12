// Direction A — "The Quiet Advisor"
// Editorial / personal-letter form. Cream paper, deep serif headlines,
// generous whitespace, one decision per screen. Talks TO you.
// Anti-dashboard. Reduces anxiety.

const A_TOKENS = {
  bg: '#f4ede2',
  paper: '#fbf7ed',
  ink: '#1a1612',
  rule: '#d4c8b3',
  muted: '#7a6b58',
  accent: '#8b3a1f',
  positive: '#2c5f3a',
  marginalia: '#a5947c',
};

const A_serif = "'Spectral', Georgia, serif";
const A_sans = "'Inter', -apple-system, sans-serif";

const AScreen = ({ children }) => (
  <div style={{
    width: '100%', height: '100%', background: A_TOKENS.bg,
    fontFamily: A_serif, color: A_TOKENS.ink,
    display: 'flex', flexDirection: 'column',
  }}>
    {children}
  </div>
);

const AMasthead = ({ section = '' }) => (
  <header style={{
    padding: '28px 64px 0', display: 'flex',
    alignItems: 'baseline', justifyContent: 'space-between',
    borderBottom: `1px solid ${A_TOKENS.rule}`, paddingBottom: 18,
    margin: '0 32px',
  }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
      <div style={{ fontFamily: A_serif, fontWeight: 600, fontSize: 22, letterSpacing: '-0.01em' }}>
        FinOptima
      </div>
      <div style={{ fontFamily: A_sans, fontSize: 11, color: A_TOKENS.muted, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
        Vol. III · Thursday, 14 May 2026
      </div>
    </div>
    <nav style={{ display: 'flex', gap: 26, fontFamily: A_sans, fontSize: 12, color: A_TOKENS.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      <span>{section === 'home' ? <strong style={{ color: A_TOKENS.ink }}>The letter</strong> : 'The letter'}</span>
      <span>{section === 'plan' ? <strong style={{ color: A_TOKENS.ink }}>The path</strong> : 'The path'}</span>
      <span>Your debts</span>
      <span>Decisions</span>
      <span>Archive</span>
    </nav>
  </header>
);

// ─── HOME — a letter ──────────────────────────────────────────────────────
const AHome = () => (
  <AScreen>
    <AMasthead section="home" />
    <div style={{ flex: 1, padding: '48px 64px 64px', display: 'grid', gridTemplateColumns: '1fr 240px', gap: 48, margin: '0 32px' }}>
      <article style={{ maxWidth: 640 }}>
        <div style={{ fontFamily: A_sans, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: A_TOKENS.marginalia, marginBottom: 12 }}>
          This week's letter
        </div>
        <h1 style={{
          fontFamily: A_serif, fontWeight: 400, fontSize: 56, lineHeight: 1.05,
          letterSpacing: '-0.02em', margin: 0,
        }}>
          Hasen — pay the card,<br />
          <em style={{ fontStyle: 'italic', color: A_TOKENS.accent }}>then breathe.</em>
        </h1>
        <p style={{ fontFamily: A_serif, fontSize: 18, lineHeight: 1.65, marginTop: 28, color: A_TOKENS.ink }}>
          Your ICICI card is the loudest debt you own. Nominal 36% becomes
          <strong> 42.48% </strong> once GST is folded in, and at a balance of
          ₹1 lakh it adds about <strong>₹3,540 every month</strong> in pure friction.
          Until it's clear, every other move loses to this one.
        </p>
        <p style={{ fontFamily: A_serif, fontSize: 18, lineHeight: 1.65, marginTop: 12, color: A_TOKENS.ink }}>
          So the move this month is simple: send <strong>₹18,500</strong> to
          the card on the next salary credit. You'll save roughly
          <strong style={{ color: A_TOKENS.positive }}> ₹31,400 </strong>
          in interest over the next year if you stay the course.
        </p>

        <div style={{ marginTop: 36, padding: '20px 0', borderTop: `1px solid ${A_TOKENS.rule}`, borderBottom: `1px solid ${A_TOKENS.rule}` }}>
          <div style={{ fontFamily: A_sans, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: A_TOKENS.marginalia, marginBottom: 14 }}>
            The decision, in numbers
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {[
              { v: '₹18,500', l: 'pay this month', c: A_TOKENS.ink },
              { v: '₹31,400', l: 'saved over 12 months', c: A_TOKENS.positive },
              { v: 'Aug 2027', l: 'debt-free, at this pace', c: A_TOKENS.ink },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontFamily: A_serif, fontSize: 28, fontWeight: 500, color: s.c, lineHeight: 1 }}>{s.v}</div>
                <div style={{ fontFamily: A_sans, fontSize: 11, color: A_TOKENS.muted, marginTop: 8, letterSpacing: '0.04em' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ fontFamily: A_serif, fontSize: 16, lineHeight: 1.6, marginTop: 28, color: A_TOKENS.muted, fontStyle: 'italic' }}>
          If a bonus, refund, or windfall arrives this month, write back —
          we'll decide together where it should go.
        </p>

        <div style={{ marginTop: 32, display: 'flex', gap: 18, fontFamily: A_sans, fontSize: 13 }}>
          <span style={{ color: A_TOKENS.accent, borderBottom: `1px solid ${A_TOKENS.accent}`, paddingBottom: 2, cursor: 'pointer' }}>
            Show me the math →
          </span>
          <span style={{ color: A_TOKENS.muted, borderBottom: `1px solid ${A_TOKENS.muted}`, paddingBottom: 2, cursor: 'pointer' }}>
            What if I disagree?
          </span>
          <span style={{ color: A_TOKENS.muted, borderBottom: `1px solid ${A_TOKENS.muted}`, paddingBottom: 2, cursor: 'pointer' }}>
            See alternatives
          </span>
        </div>
      </article>

      {/* Right margin — marginalia */}
      <aside style={{ fontFamily: A_sans, fontSize: 11, color: A_TOKENS.marginalia, lineHeight: 1.6, paddingTop: 36 }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 14, fontSize: 10 }}>
          Also worth knowing
        </div>
        {[
          { date: 'Apr 7', txt: 'RBI held repo at 5.25%. Your floating home loan is unaffected at its next reset.' },
          { date: 'Apr 2', txt: 'Your HDFC home loan crossed the halfway mark — principal paid since 2018 now exceeds remaining.' },
          { date: 'Mar 28', txt: '"No-cost EMI" rarely is. The real APR is usually 14–18%.' },
        ].map((n, i) => (
          <div key={i} style={{ marginBottom: 18, borderLeft: `2px solid ${A_TOKENS.rule}`, paddingLeft: 12 }}>
            <div style={{ fontWeight: 600, color: A_TOKENS.ink, marginBottom: 4, fontSize: 10, letterSpacing: '0.05em' }}>{n.date}</div>
            <div style={{ color: A_TOKENS.ink, fontSize: 12, lineHeight: 1.55 }}>{n.txt}</div>
          </div>
        ))}
      </aside>
    </div>
  </AScreen>
);

// ─── PLAN — the path ──────────────────────────────────────────────────────
const APlan = () => {
  // simple monotonic curve points for the trajectory (engraving style)
  const pts = Array.from({ length: 37 }, (_, i) => ({
    x: i / 36,
    y_av: Math.max(0, 1 - i / 28 + 0.02 * Math.sin(i / 3)),
    y_min: Math.max(0, 1 - i / 50),
  }));
  const w = 760, h = 220, mx = 0, my = 0;
  const path = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(mx + p.x * w).toFixed(1)},${(my + (1 - p[key]) * h).toFixed(1)}`).join(' ');

  return (
    <AScreen>
      <AMasthead section="plan" />
      <div style={{ flex: 1, padding: '48px 64px 64px', display: 'grid', gridTemplateColumns: '1fr 240px', gap: 48, margin: '0 32px' }}>
        <article style={{ maxWidth: 760 }}>
          <div style={{ fontFamily: A_sans, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: A_TOKENS.marginalia, marginBottom: 12 }}>
            Chapter II · the path
          </div>
          <h1 style={{ fontFamily: A_serif, fontWeight: 400, fontSize: 48, lineHeight: 1.1, letterSpacing: '-0.02em', margin: 0 }}>
            If you hold the line, you'll be free<br />
            <em style={{ fontStyle: 'italic', color: A_TOKENS.accent }}>in seventeen months.</em>
          </h1>
          <p style={{ fontFamily: A_serif, fontSize: 17, lineHeight: 1.65, marginTop: 22, color: A_TOKENS.ink, maxWidth: 580 }}>
            That assumes your surplus stays at <strong>₹1,05,000/mo</strong>,
            rates don't shock either way, and you continue the avalanche order
            (card, then SBI, then the home loan tail). Two restructures could
            arrive sooner.
          </p>

          {/* The line drawing — engraved, no fill */}
          <figure style={{ margin: '36px 0 12px' }}>
            <svg width={w} height={h + 28} viewBox={`0 0 ${w} ${h + 28}`}>
              {/* hairline grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <line key={i} x1={0} x2={w} y1={t * h} y2={t * h} stroke={A_TOKENS.rule} strokeWidth={i === 0 || i === 4 ? 0.8 : 0.4} strokeDasharray={i === 0 || i === 4 ? '' : '2 4'} />
              ))}
              {/* minimums — light dashed */}
              <path d={path('y_min')} stroke={A_TOKENS.marginalia} strokeWidth={1} fill="none" strokeDasharray="3 4" />
              {/* avalanche — solid engraved */}
              <path d={path('y_av')} stroke={A_TOKENS.accent} strokeWidth={1.8} fill="none" />
              {/* labels at right */}
              <text x={w - 8} y={(1 - pts[pts.length - 1].y_av) * h - 8} textAnchor="end" fontFamily={A_serif} fontStyle="italic" fontSize={12} fill={A_TOKENS.accent}>avalanche · clear Aug 2027</text>
              <text x={w - 8} y={(1 - pts[pts.length - 1].y_min) * h - 8} textAnchor="end" fontFamily={A_serif} fontStyle="italic" fontSize={11} fill={A_TOKENS.marginalia}>minimums · clear Oct 2028</text>
              {/* x-axis dates */}
              {['May 26', 'Nov 26', 'May 27', 'Nov 27', 'May 28'].map((d, i) => (
                <text key={i} x={(i / 4) * w} y={h + 18} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fontFamily={A_sans} fontSize={10} fill={A_TOKENS.muted}>{d}</text>
              ))}
              {/* y-axis ₹ markers */}
              <text x={0} y={-4} fontFamily={A_sans} fontSize={10} fill={A_TOKENS.muted}>₹41L</text>
            </svg>
            <figcaption style={{ fontFamily: A_serif, fontStyle: 'italic', fontSize: 13, color: A_TOKENS.muted, marginTop: 8, textAlign: 'center' }}>
              Total balance over time. Solid: the avalanche path you're on. Dashed: doing nothing.
            </figcaption>
          </figure>

          <div style={{ marginTop: 36, padding: '20px 0', borderTop: `1px solid ${A_TOKENS.rule}` }}>
            <div style={{ fontFamily: A_sans, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: A_TOKENS.marginalia, marginBottom: 14 }}>
              Two ways to shave months off
            </div>
            <ol style={{ fontFamily: A_serif, fontSize: 16, lineHeight: 1.75, paddingLeft: 18, margin: 0 }}>
              <li>
                <strong>Move the ICICI balance</strong> to HDFC at 16% for 9 months.
                Saves <strong style={{ color: A_TOKENS.positive }}>₹31,400</strong> a year, recovers the fee in seven weeks.
              </li>
              <li style={{ marginTop: 8 }}>
                <strong>Refinance the home loan</strong> to ICICI at 8.05% (a 45 bps gain).
                Saves <strong style={{ color: A_TOKENS.positive }}>₹17,320</strong> a year over the remaining tenure.
              </li>
            </ol>
          </div>
        </article>

        <aside style={{ fontFamily: A_sans, fontSize: 11, color: A_TOKENS.marginalia, lineHeight: 1.6, paddingTop: 36 }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 14, fontSize: 10 }}>
            What if…
          </div>
          {[
            { q: 'rates rise 100 bps?', a: '+6 mo, +₹42k interest' },
            { q: 'you cut ₹10k/mo?', a: '−3 mo, −₹18k interest' },
            { q: 'a ₹2L windfall lands?', a: '−5 mo, −₹39k interest' },
            { q: 'you pause for 2 mo?', a: '+2 mo, +₹9k interest' },
          ].map((s, i) => (
            <div key={i} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${A_TOKENS.rule}` }}>
              <div style={{ color: A_TOKENS.ink, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }}>{s.q}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: A_TOKENS.ink }}>{s.a}</div>
            </div>
          ))}
          <div style={{ fontStyle: 'italic', fontFamily: A_serif, fontSize: 12, color: A_TOKENS.muted, marginTop: 4 }}>
            Adjust any of these — the letter rewrites itself.
          </div>
        </aside>
      </div>
    </AScreen>
  );
};

window.DirectionA = { AHome, APlan };
