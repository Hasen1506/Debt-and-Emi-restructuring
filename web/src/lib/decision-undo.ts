/**
 * Undo for a plan decision (lib/decisions) within its 72-hour window:
 * restores what the decision changed, then marks it reverted (the row
 * stays in the history). Moved here from the old /decisions page so
 * Activity's history can offer it.
 */
import { markReverted, type DecisionEntry } from './decisions';
import { writeEfSplitClient } from './ef-split';
import { readGoalsClient, writeGoalsClient } from './goals';

export function undoPlanDecision(entries: DecisionEntry[], entry: DecisionEntry): DecisionEntry[] {
  switch (entry.kind) {
    case 'ef_split_change': {
      writeEfSplitClient(String(entry.snapshot.efSplit ?? '0.3'));
      break;
    }
    case 'goal_added': {
      const goals = readGoalsClient();
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
      if (g && typeof g === 'object') writeGoalsClient([...goals, g as (typeof goals)[0]]);
      break;
    }
    default:
      break;
  }
  return markReverted(entries, entry.id);
}

/** Decisions whose undo restores something; the rest are a record only. */
export function canUndoPlanDecision(entry: DecisionEntry): boolean {
  return entry.kind === 'ef_split_change' || entry.kind === 'goal_added' || entry.kind === 'goal_removed';
}
