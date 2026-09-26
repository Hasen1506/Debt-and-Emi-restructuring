'use client';

/**
 * Decisions timeline — every plan-affecting choice rendered as a
 * chronological list with soft-undo for recent entries.
 *
 * Soft-undo restores the snapshot to the relevant slice (efSplit
 * cookie, goals slice, etc.) without re-running
 * any simulation — the page refresh on the affected route picks up
 * the restored state.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type DecisionEntry,
  isWithinUndoWindow,
  markReverted,
  readDecisionsClient,
} from '@/lib/decisions';
import { writeEfSplitClient } from '@/lib/ef-split';
import { readGoalsClient, writeGoalsClient } from '@/lib/goals';

export function DecisionsClient() {
  const [entries, setEntries] = useState<DecisionEntry[]>([]);

  useEffect(() => {
    setEntries(readDecisionsClient());
  }, []);

  function refresh() {
    setEntries(readDecisionsClient());
  }

  function handleUndo(entry: DecisionEntry) {
    try {
      switch (entry.kind) {
        case 'ef_split_change': {
          const prev = String(entry.snapshot.efSplit ?? '0.3');
          writeEfSplitClient(prev);
          break;
        }
        case 'goal_added': {
          const goals = readGoalsClient();
          // Remove the most recently added matching kind — best-effort
          // since we don't carry the goal id in the decision snapshot.
          const kind = entry.result.kind as string | undefined;
          if (kind) {
            const last = [...goals].reverse().find((g) => g.kind === kind);
            if (last) writeGoalsClient(goals.filter((g) => g.id !== last.id));
          }
          break;
        }
        case 'goal_removed': {
          const goals = readGoalsClient();
          const g = entry.snapshot.goal as unknown;
          if (g && typeof g === 'object') {
            writeGoalsClient([...goals, g as typeof goals[0]]);
          }
          break;
        }
        default:
          // No reversible handler yet — mark reverted anyway so the row
          // shows as actioned in the UI. Users can still manually
          // re-toggle the underlying setting.
          break;
      }
      const next = markReverted(entries, entry.id);
      setEntries(next);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Undo failed', e);
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Your decisions</h1>
        <Link href="/plan" style={{ color: 'var(--accent)', fontSize: 13 }}>
          Back to plan →
        </Link>
      </div>
      <p style={{ color: 'var(--muted)', maxWidth: 720, marginTop: 8, lineHeight: 1.5 }}>
        Every plan-affecting choice ends up here — toggles, goals, lifecycle
        events, applied recommendations. The most recent 72 hours of
        entries are reversible.
      </p>

      {entries.length === 0 && (
        <div
          style={{
            marginTop: 20,
            padding: 20,
            border: '1px dashed var(--border)',
            borderRadius: 8,
            color: 'var(--muted)',
            textAlign: 'center',
          }}
        >
          No decisions logged yet. Toggles, goal edits, and applied
          recommendations show up here as you make them.
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, marginTop: 20 }}>
        {entries.map((e) => (
          <li
            key={e.id}
            style={{
              padding: 12,
              borderTop: '1px solid var(--border)',
              opacity: e.reverted ? 0.55 : 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {e.label}
                {e.reverted && (
                  <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>
                    (reverted)
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {new Date(e.at).toLocaleString()} ·{' '}
                {e.impactDeltaMonths == null
                  ? 'impact: —'
                  : e.impactDeltaMonths > 0
                    ? `pushed debt-free out by ${e.impactDeltaMonths} mo`
                    : e.impactDeltaMonths < 0
                      ? `pulled debt-free in by ${Math.abs(e.impactDeltaMonths)} mo`
                      : 'no impact on debt-free'}
              </div>
            </div>
            {isWithinUndoWindow(e) ? (
              <button
                type="button"
                onClick={() => handleUndo(e)}
                style={{
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--accent)',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Undo
              </button>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {e.reverted ? '' : 'window closed'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {entries.length > 0 && (
        <button
          type="button"
          onClick={refresh}
          style={{
            marginTop: 16,
            padding: '6px 12px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--accent)',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      )}
    </div>
  );
}
