/**
 * Live re-test 4 R4-1: what Invest or prepay's answer box says while it has
 * no answer. It names the fields that stop it (invalid first, then blank),
 * instead of always asking for the loan's rate and tax rate.
 */
export type IvpNoteField = { name: string; text: string; error: string | null; shown?: boolean };

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function ivpAnswerNote(fields: IvpNoteField[]): string {
  const shown = fields.filter((f) => f.shown !== false);
  const invalid = shown.filter((f) => !!f.error).map((f) => f.name);
  if (invalid.length) return `Fix ${list(invalid)} to see the answer.`;
  const blank = shown.filter((f) => f.text.trim().replace(/%$/, '').trim().replace(/^\.$/, '') === '').map((f) => f.name);
  if (blank.length) return `Enter ${list(blank)} to see the answer.`;
  return 'Check the highlighted fields to see the answer.';
}
