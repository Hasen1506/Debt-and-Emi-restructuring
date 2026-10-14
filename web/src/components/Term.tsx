'use client';

/**
 * Tap-to-explain for a technical term (sprint G10, grill #43). The word
 * stays on screen; tapping it opens its plain-words explanation from
 * lib/glossary right under it, and tapping again (or Escape) closes it.
 */
import { useId, useState, type ReactNode } from 'react';
import { GLOSSARY } from '@/lib/glossary';
import { L_T } from '@/components/ledger/primitives';

export function Term({ id, children }: { id: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const entry = GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const boxId = useId();
  if (!entry) return <>{children}</>;
  return (
    <span style={{ display: 'inline' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={boxId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        title={`What is ${entry.term}?`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: 'help',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 3,
        }}
      >
        {children ?? entry.term}
        <span aria-hidden style={{ fontSize: '0.8em', color: L_T.muted, marginLeft: 2 }}>ⓘ</span>
      </button>
      {open && (
        <span
          id={boxId}
          role="note"
          style={{
            display: 'block',
            margin: '6px 0',
            padding: '8px 10px',
            border: `1px solid ${L_T.ink}`,
            background: L_T.paper,
            color: L_T.inkSoft,
            fontSize: 'var(--fs-dense)',
            lineHeight: 1.55,
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 'normal',
            maxWidth: 520,
          }}
        >
          <strong style={{ color: L_T.ink }}>{entry.term}:</strong> {entry.plain}{' '}
          <a href="/glossary" style={{ color: L_T.accent }}>All terms</a>
        </span>
      )}
    </span>
  );
}
