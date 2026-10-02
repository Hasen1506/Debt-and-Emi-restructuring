/** Undo a recent decision without overwriting a newer choice or losing history. */
import { readDecisionsClient, isWithinUndoWindow, type DecisionEntry } from './decisions';
import { readGoalsClient, goalSliceWrite, type Goal } from './goals';
import { DEFAULT_EF_SPLIT } from './ef-split';
import { persistClientSlices, type ClientSliceWrite } from './persist-client-slices';

function goalId(entry: DecisionEntry): string | undefined {
  const snap = entry.snapshot.goal as Goal | undefined;
  return typeof entry.result.goalId === 'string' ? entry.result.goalId : snap?.id;
}

export function undoPlanDecision(_entries: DecisionEntry[], requested: DecisionEntry): DecisionEntry[] {
  const entries = readDecisionsClient();
  const index = entries.findIndex(e => e.id === requested.id);
  const entry = entries[index];
  if (!entry || !isWithinUndoWindow(entry) || !canUndoPlanDecision(entry))
    throw new Error('This change can no longer be undone. Reload the history.');
  const targetId = goalId(entry);
  if (entries.slice(0,index).some(e => !e.reverted && (entry.kind === 'ef_split_change' ? e.kind === entry.kind : targetId ? goalId(e) === targetId : e.kind.startsWith('goal_'))))
    throw new Error('A newer change affects this setting or goal. Undo the latest change first.');
  const writes: ClientSliceWrite[] = [];
  if (entry.kind === 'ef_split_change') {
    const previous = Number(entry.snapshot.efSplit ?? DEFAULT_EF_SPLIT);
    const value = Number.isFinite(previous) && previous >= 0 && previous <= 1 ? previous.toFixed(2) : DEFAULT_EF_SPLIT;
    writes.push({cookie:'finoptima_ef_split',digest:value,value,slice:'ef_split'});
  } else {
    const goals = readGoalsClient();
    const expected = entry.result.goal as Goal | undefined;
    const current = goals.find(g => g.id === targetId);
    // Automatic funding-start adjustments do not replace an explicit goal edit.
    const comparable = (g: Goal) => JSON.stringify({...g,fundingStartMonth:undefined});
    if (entry.result.deleted === true && current) throw new Error('This goal was restored elsewhere. Reload before undoing it.');
    if (expected && (!current || comparable(current) !== comparable(expected)))
      throw new Error('This goal changed elsewhere. Reload before undoing it.');
    if (entry.kind === 'goal_added') {
      const target = targetId ? current : [...goals].reverse().find(g => g.kind === entry.result.kind);
      if (!target) throw new Error('That goal is no longer present. Reload the history.');
      writes.push(goalSliceWrite(goals.filter(g => g.id !== target.id)));
    } else {
      const snap = entry.snapshot.goal as Goal | undefined;
      if (!snap?.id) throw new Error('The original goal is unavailable. Edit the goal instead.');
      writes.push(goalSliceWrite([...goals.filter(g => g.id !== snap.id),snap]));
    }
  }
  const next = entries.map(e => e.id === entry.id ? {...e,reverted:true} : e);
  writes.push({key:'finoptima_decisions',value:next,slice:'decisions'});
  persistClientSlices(writes);
  return next;
}

export function canUndoPlanDecision(entry: DecisionEntry): boolean {
  return ['ef_split_change','goal_added','goal_edited','goal_removed'].includes(entry.kind);
}
