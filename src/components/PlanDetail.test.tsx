import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlanDetail from './PlanDetail';
import type { Plan, Task, Unit } from '../types';

vi.mock('../api', () => {
  const namespace = {
    getPlan: vi.fn(),
    listUnits: vi.fn(),
    listTasks: vi.fn(),
    listArtifacts: vi.fn(),
    listQuestions: vi.fn(),
  };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getPlan: ReturnType<typeof vi.fn>;
  listUnits: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
  listArtifacts: ReturnType<typeof vi.fn>;
  listQuestions: ReturnType<typeof vi.fn>;
};

const PLAN: Plan = {
  id: 'PLAN-1',
  project_id: 'PROJ-1',
  title: 'Test plan',
  description: null,
  source: 'manual',
  source_path: null,
  created_at: 0,
  approved_at: null,
  status: 'active',
};

const UNIT: Unit = {
  id: 'UNIT-1',
  plan_id: 'PLAN-1',
  idx: 0,
  title: 'Test unit',
  goal: null,
  created_at: 0,
  started_at: null,
  completed_at: null,
  approval_required: 0,
  approved_by: null,
  approved_at: null,
};

const TASK: Task = {
  id: 'TASK-1',
  unit_id: 'UNIT-1',
  idx: 0,
  title: 'Nested task',
  body: '',
  created_at: 0,
  started_at: null,
  completed_at: null,
  status: 'todo',
  assignee: null,
  depends_on: [],
  ticket_number: 'LM-100',
  parent_task_id: null,
  priority: 'medium',
  complexity: null,
  estimated_edits: null,
  cycle_id: null,
  labels: [],
  reporter: null,
  type: 'task',
};

afterEach(() => {
  vi.clearAllMocks();
});

function wireApi({
  plan = PLAN,
  units = [UNIT],
  tasks = [TASK],
}: {
  plan?: Plan;
  units?: Unit[];
  tasks?: Task[];
}) {
  mockedApi.getPlan.mockResolvedValue(plan);
  mockedApi.listUnits.mockResolvedValue(units);
  mockedApi.listTasks.mockResolvedValue(tasks);
  mockedApi.listArtifacts.mockResolvedValue([]);
  mockedApi.listQuestions.mockResolvedValue([]);
}

describe('PlanDetail tree-aware listing (LM-10985)', () => {
  it('renders units with nested task rows', async () => {
    wireApi({});
    render(<PlanDetail planId="PLAN-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('plan-detail-units')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('plan-detail-unit-UNIT-1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-detail-task-TASK-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('plan-detail-task-TASK-1').textContent,
    ).toContain('Nested task');
  });

  it('fires onSelectItem({type:"unit"}) when a unit row is clicked', async () => {
    wireApi({});
    const onSelectItem = vi.fn();
    render(
      <PlanDetail
        planId="PLAN-1"
        onClose={() => {}}
        onSelectItem={onSelectItem}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('plan-detail-unit-UNIT-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('plan-detail-unit-UNIT-1'));
    expect(onSelectItem).toHaveBeenCalledWith({ type: 'unit', id: 'UNIT-1' });
  });

  it('fires onSelectItem({type:"task"}) when a nested task row is clicked', async () => {
    wireApi({});
    const onSelectItem = vi.fn();
    render(
      <PlanDetail
        planId="PLAN-1"
        onClose={() => {}}
        onSelectItem={onSelectItem}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('plan-detail-task-TASK-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('plan-detail-task-TASK-1'));
    expect(onSelectItem).toHaveBeenCalledWith({ type: 'task', id: 'TASK-1' });
  });

  it('disables unit/task rows when onSelectItem is omitted', async () => {
    wireApi({});
    render(<PlanDetail planId="PLAN-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('plan-detail-unit-UNIT-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('plan-detail-unit-UNIT-1')).toBeDisabled();
    expect(screen.getByTestId('plan-detail-task-TASK-1')).toBeDisabled();
  });

  it('does not render a nested task list for a unit without tasks', async () => {
    wireApi({ tasks: [] });
    render(<PlanDetail planId="PLAN-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('plan-detail-unit-UNIT-1')).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('plan-detail-unit-UNIT-1-tasks'),
    ).toBeNull();
  });
});
