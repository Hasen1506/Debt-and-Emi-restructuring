import { persistClientSlices, type ClientSliceWrite } from './persist-client-slices';

export interface GoalSliceWrite extends ClientSliceWrite {
  key: string;
  cookie: string;
  digest: string;
  slice: 'goals' | 'goal_contributions';
}

export function persistGoalSlices(writes: GoalSliceWrite[]): void {
  persistClientSlices(writes);
}
