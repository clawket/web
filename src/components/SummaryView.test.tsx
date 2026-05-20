import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverallProgressCard } from './SummaryView';
import { findActivePlan, findActiveTask } from './SummaryView.helpers';
import type { Plan, Task } from '../types';

// Minimal Plan / Task fixtures — only the fields findActivePlan / findActiveTask
// read are populated. Casts keep the helper signatures honest without dragging
// in the full schema. The order of array entries here mirrors the API ordering
// (created_at DESC), so `[0]` is the most recent — the old fallback would have
// returned it; the new behavior must NOT.
function plan(status: Plan['status'], id = `PLAN-${status}`): Plan {
  return {
    id,
    project_id: 'PROJ-x',
    title: `${status} plan`,
    description: null,
    source: 'manual',
    source_path: null,
    created_at: 0,
    approved_at: null,
    status,
  };
}

function task(status: Task['status'], id = `TASK-${status}`): Task {
  return {
    id,
    unit_id: 'UNIT-x',
    idx: 0,
    title: `${status} task`,
    body: '',
    created_at: 0,
    started_at: null,
    completed_at: null,
    status,
    assignee: null,
    depends_on: [],
    ticket_number: null,
    parent_task_id: null,
    priority: 'medium',
    complexity: null,
    estimated_edits: null,
    cycle_id: null,
    labels: [],
    reporter: null,
    type: 'task',
  };
}

describe('findActivePlan (LM-11032)', () => {
  it('returns the active plan when one exists', () => {
    const result = findActivePlan([plan('completed'), plan('active'), plan('draft')]);
    expect(result?.status).toBe('active');
  });

  it('returns null when no plan is active — never falls back to plans[0]', () => {
    // Pre-fix bug: returned plans[0] (the most recent), making the "Now active"
    // header lie about a draft/completed plan being active.
    expect(findActivePlan([plan('completed'), plan('draft')])).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findActivePlan([])).toBeNull();
  });
});

describe('findActiveTask (LM-11032)', () => {
  it('returns the in_progress task when one exists', () => {
    const result = findActiveTask([task('done'), task('in_progress'), task('todo')]);
    expect(result?.status).toBe('in_progress');
  });

  it('returns null when no task is in_progress — never falls back to tasks[0]', () => {
    // Pre-fix bug: returned tasks[0] (the most recent), so a closed-out project
    // showed a stale "Now active" card with a done/cancelled task.
    expect(findActiveTask([task('done'), task('todo')])).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findActiveTask([])).toBeNull();
  });
});

describe('OverallProgressCard', () => {
  it('counts done + cancelled together as Closed and reaches 100% when no active work remains', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={2}
        inProgress={0}
        todo={0}
        blocked={0}
        total={3}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('100.00%');
    expect(screen.getByText('Closed 3')).toBeTruthy();
  });

  it('counts only done toward Closed when no cancelled tasks exist', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={0}
        inProgress={1}
        todo={2}
        blocked={0}
        total={4}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('25.00%');
    expect(screen.getByText('Closed 1')).toBeTruthy();
    expect(screen.getByText('Active 1')).toBeTruthy();
    expect(screen.getByText('Todo 2')).toBeTruthy();
  });

  it('truncates percent to two decimal places (floor, not round)', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={0}
        inProgress={0}
        todo={2}
        blocked={0}
        total={3}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('33.33%');
  });

  it('renders 0.00% with no tasks (zero total)', () => {
    render(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={0}
        todo={0}
        blocked={0}
        total={0}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('0.00%');
    expect(screen.getByText('Closed 0')).toBeTruthy();
  });

  it('shows Blocked legend entry only when blocked > 0', () => {
    const { rerender } = render(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={1}
        todo={1}
        blocked={0}
        total={2}
      />,
    );
    expect(screen.queryByText(/^Blocked/)).toBeNull();

    rerender(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={1}
        todo={1}
        blocked={2}
        total={4}
      />,
    );
    expect(screen.getByText('Blocked 2')).toBeTruthy();
  });

  it('proportions bar segments against total (not segTotal minus cancelled)', () => {
    const { container } = render(
      <OverallProgressCard
        done={1}
        cancelled={1}
        inProgress={1}
        todo={0}
        blocked={1}
        total={4}
      />,
    );
    const bar = container.querySelector('[aria-hidden].rounded-full')!;
    const segments = Array.from(bar.querySelectorAll('div')) as HTMLDivElement[];
    expect(segments).toHaveLength(3);
    // closed = 2 / 4 = 50%, in_progress = 1 / 4 = 25%, blocked = 1 / 4 = 25%
    expect(segments[0].style.width).toBe('50%');
    expect(segments[1].style.width).toBe('25%');
    expect(segments[2].style.width).toBe('25%');
  });
});
