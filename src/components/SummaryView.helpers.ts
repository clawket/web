import type { Plan, Task } from '../types';

// LM-11032: "Now active" / subtitle must reflect lifecycle status, not
// recency. The previous `?? plans[0]` fallback caused the most-recent plan
// (typically draft or completed) to render as if it were active, which lied
// to users about the project's real state. Same anti-pattern was duplicated
// for `activeTask` — both are strict on status and let the render path show
// the empty/null branch when nothing is truly active.
export function findActivePlan(plans: Plan[]): Plan | null {
  return plans.find((p) => p.status === 'active') ?? null;
}

export function findActiveTask(tasks: Task[]): Task | null {
  return tasks.find((t) => t.status === 'in_progress') ?? null;
}
