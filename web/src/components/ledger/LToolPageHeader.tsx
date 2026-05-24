'use client';

/**
 * Common ledger header used by every `/tools/<id>/page.tsx` wrapper.
 *
 * Drops the legacy `<h1>Tool Title</h1>` + `<p class="muted">subtitle</p>`
 * pattern and renders the §4.9 contract instead:
 *
 *   `$ §<TAG> · <NAME> · <DATE>`
 *   `<HERO QUESTION IN CAPS>`
 *
 * The hero question is taken from `TOOLS` metadata. Tool body components
 * still own their INPUT/VERDICT/MATH blocks — this only fixes the
 * top-of-page chrome so all nine tools share the same masthead.
 */

import { TOOLS } from '@/lib/tools';
import { LToolHeader } from './LToolShell';
import { LShell } from './primitives';

export function LToolPageHeader({
  id,
  children,
}: {
  /** Tool slug — matches `TOOLS[].id`. */
  id: string;
  /** Body content — typically the per-tool `<XYZTool />` client component. */
  children: React.ReactNode;
}) {
  const meta = TOOLS.find((t) => t.id === id);
  const today = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (!meta) {
    // Defensive — every route id should be in TOOLS. Render children
    // bare-bones so the route still works even if metadata drifts.
    return <LShell>{children}</LShell>;
  }

  // §4.9 spec: the *exact* question the tool answers is the hero line.
  // TOOLS metadata stores them as sentence-case ("Got a bonus?"); we
  // upcase here so every tool reads as a ledger statement.
  const question = meta.question;

  return (
    <LShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <LToolHeader
          tag={meta.tag}
          name={meta.name}
          date={today}
          question={question}
        />
        {children}
      </div>
    </LShell>
  );
}
