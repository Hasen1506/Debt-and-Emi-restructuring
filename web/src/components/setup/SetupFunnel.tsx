'use client';

/**
 * Where people stop in setup (docs/SETUP-FUNNEL.md, A15). Wraps the setup
 * form and listens from outside, so QuickSetup itself doesn't change: for
 * each field, once per page load, it counts "reached" (focus), then "filled"
 * or "left empty" (blur), taps on an "I don't know" button, and, when the
 * page is closed, "left while on this field". The field is named by its
 * label's letters only ("Months left" → months_left); values are never read
 * beyond empty-or-not. Does nothing unless NEXT_PUBLIC_FUNNEL=1.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { fieldKey, funnelOn, track } from '@/lib/funnel';

const KIND_WORDS: [RegExp, string][] = [
  [/home|housing/i, 'home_loan'], [/car|auto|vehicle|bike/i, 'auto_loan'], [/personal/i, 'personal_loan'],
  [/card/i, 'credit_card'], [/education|student/i, 'education_loan'], [/gold/i, 'gold_loan'], [/later|bnpl/i, 'bnpl'],
];

function labelOf(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const lab = input.labels?.[0]?.textContent ?? '';
  return lab || el.getAttribute('aria-label') || input.name || '';
}

function stepNow(): number {
  const nav = document.querySelector('nav[aria-label="Setup steps"]');
  const cur = nav?.querySelector('[aria-current="step"]');
  if (!nav || !cur) return 0;
  const all = Array.from(nav.querySelectorAll('button, a'));
  return Math.max(0, all.indexOf(cur as Element)) + 1;
}

function loanKindNear(el: HTMLElement): string {
  const group = el.closest('[role="group"]');
  const pressed = group?.querySelector('[aria-pressed="true"]')?.textContent ?? '';
  for (const [re, kind] of KIND_WORDS) if (re.test(pressed)) return kind;
  return '';
}

export function SetupFunnel({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !funnelOn()) return;
    const counted = new Set<string>();
    let last: { field: string; step: number; kind: string; filled: boolean } | null = null;
    const once = (key: string, fn: () => void) => { if (!counted.has(key)) { counted.add(key); fn(); } };
    const isField = (t: EventTarget | null): t is HTMLInputElement | HTMLSelectElement =>
      t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

    const onFocus = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      const field = fieldKey(labelOf(e.target));
      if (!field) return;
      const step = stepNow();
      const kind = loanKindNear(e.target);
      last = { field, step, kind, filled: false };
      once(`f|${step}|${field}`, () => track('field_focus', { step, field, loan_kind: kind }));
    };
    const onBlur = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      const field = fieldKey(labelOf(e.target));
      if (!field) return;
      const step = stepNow();
      const filled = String((e.target as HTMLInputElement).value ?? '').trim() !== '';
      if (last && last.field === field) last.filled = filled;
      once(`b|${step}|${field}`, () => track(filled ? 'field_filled' : 'field_left_empty', { step, field, loan_kind: loanKindNear(e.target as HTMLElement) }));
    };
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      const text = b?.textContent ?? '';
      if (!/DON.T KNOW/i.test(text)) return;
      const field = fieldKey(text.replace(/I\s+DON.T\s+KNOW\s*(THE)?/i, '')) || 'unknown';
      const step = stepNow();
      once(`d|${step}|${field}`, () => track('field_dont_know', { step, field }));
    };
    const onHide = () => {
      if (last && !last.filled) {
        const l = last;
        once(`a|${l.step}|${l.field}`, () => track('field_abandon', { step: l.step, field: l.field, loan_kind: l.kind }));
      }
    };
    el.addEventListener('focusin', onFocus);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('click', onClick);
    window.addEventListener('pagehide', onHide);
    return () => {
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', onBlur);
      el.removeEventListener('click', onClick);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
  return <div ref={root} style={{ display: "contents" }}>{children}</div>;
}
