import { DRAFT_MARKER_TEXT, isPendingReview, type ReviewId } from '@/lib/legal-review';

/**
 * Small "Draft — pending legal review" tag on a letter or a changed legal
 * section (founder decision 15 Oct 2026). Informational only: nothing is
 * disabled. Disappears once lib/legal-review marks the id 'signed_off'.
 */
export function DraftLegalMarker({ id, note }: { id: ReviewId; note?: string }) {
  if (!isPendingReview(id)) return null;
  return (
    <p
      data-testid={`draft-legal-${id}`}
      data-draft-legal={id}
      style={{
        display: 'inline-block',
        margin: '4px 0 8px',
        padding: '2px 8px',
        border: '1px dashed #8b3a1f',
        color: '#8b3a1f',
        background: '#fff8d3',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-small, 12px)',
        letterSpacing: '0.04em',
        lineHeight: 1.5,
      }}
    >
      {DRAFT_MARKER_TEXT}
      {note ? <span style={{ fontFamily: 'inherit' }}> · {note}</span> : null}
    </p>
  );
}
