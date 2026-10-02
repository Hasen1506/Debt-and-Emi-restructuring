'use client';

/**
 * What markets expect at the coming RBI or Fed decisions (Polymarket):
 * one bar per meeting, split into the chance of each move. Nothing to
 * type: Right time used to ask people for this, which was asking them
 * for the answer.
 */
import { L_MONO, L_T } from './primitives';
import { LStepSub } from './LToolSteps';
import type { RateOddsResponse } from '@/lib/api';

type Meeting = RateOddsResponse['meetings'][number];

function moveLabel(bps: number, label: string): string {
  if (bps === 0) return 'Hold';
  const plus = label.includes('+') ? '+' : '';
  return `${bps < 0 ? 'Cut' : 'Rise'} ${(Math.abs(bps) / 100).toFixed(2)}%${plus}`;
}

function chanceText(c: number): string {
  if (c > 0 && c < 0.005) return '<1%';
  return `${Math.round(c * 100)}%`;
}

function moveColor(bps: number, deep: boolean): string {
  if (bps < 0) return deep ? '#0b5a29' : L_T.positive;
  if (bps > 0) return deep ? '#8a1414' : L_T.negative;
  return L_T.ruleSoft;
}

export function fmtDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function MeetingRow({ m, bank }: { m: Meeting; bank: string }) {
  const outs = m.outcomes.map((o) => ({ ...o, c: Number(o.chance) })).filter((o) => o.c > 0);
  // A bigger cut or rise than the smallest one listed gets the deeper shade.
  const mildCut = Math.max(-Infinity, ...outs.filter((o) => o.bps < 0).map((o) => o.bps));
  const mildRise = Math.min(Infinity, ...outs.filter((o) => o.bps > 0).map((o) => o.bps));
  const deep = (bps: number) => (bps < 0 && bps < mildCut) || (bps > 0 && bps > mildRise);
  const summary = outs.map((o) => `${moveLabel(o.bps, o.label)} ${chanceText(o.c)}`).join(', ');
  return (
    <li style={{ listStyle: 'none', padding: '10px 0', borderBottom: `1px solid ${L_T.ruleSoft}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
          {bank} · {fmtDay(m.date).toUpperCase()}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: Number(m.cut_chance) >= 0.5 ? L_T.positive : L_T.ink }}>
          {chanceText(Number(m.cut_chance))} chance of a cut
        </span>
      </div>
      <div role="img" aria-label={`${bank} on ${fmtDay(m.date)}: ${summary}`} style={{ display: 'flex', height: 10, margin: '6px 0', border: `1px solid ${L_T.ink}` }}>
        {outs.map((o) => (
          <span key={o.bps} style={{ width: `${o.c * 100}%`, background: moveColor(o.bps, deep(o.bps)) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, color: L_T.muted }}>
        {outs.map((o) => (
          <span key={o.bps} style={{ whiteSpace: 'nowrap' }}>
            <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5, background: moveColor(o.bps, deep(o.bps)), border: `1px solid ${L_T.ink}` }} />
            {moveLabel(o.bps, o.label)} <b style={{ color: L_T.ink }}>{chanceText(o.c)}</b>
          </span>
        ))}
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', fontFamily: L_MONO, fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, whiteSpace: 'nowrap' }}
        >
          ${Math.round(Number(m.volume)).toLocaleString('en-US')} TRADED ↗
        </a>
      </div>
    </li>
  );
}

export function RateOdds({ odds, bank, max = 3 }: { odds: RateOddsResponse | null | 'loading'; bank: string; max?: number }) {
  const when =
    odds && odds !== 'loading' && odds.fetched_at
      ? new Date(odds.fetched_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : null;
  return (
    <div>
      <LStepSub right={when ? `POLYMARKET · ${when}` : 'POLYMARKET'}>What markets expect</LStepSub>
      {odds === 'loading' ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: L_T.muted }}>Fetching the odds…</p>
      ) : !odds || odds.meetings.length === 0 ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6, color: L_T.muted }}>
          No market odds for the next {bank} decision right now, so the answer goes on today&apos;s rate.
        </p>
      ) : (
        <>
          <ul style={{ margin: 0, padding: 0 }}>
            {odds.meetings.slice(0, max).map((m) => (
              <MeetingRow key={m.date} m={m} bank={bank} />
            ))}
          </ul>
          <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.6, color: L_T.muted }}>
            The chance of each move is what people betting real money on it pay. It shifts with every bit of news.
          </p>
        </>
      )}
    </div>
  );
}
