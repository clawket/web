import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UnitDetail from './UnitDetail';
import type { Plan, Task, Unit } from '../types';

vi.mock('../api', () => {
  const namespace = {
    getUnit: vi.fn(),
    getPlan: vi.fn(),
    listTasks: vi.fn(),
    listArtifacts: vi.fn(),
    listQuestions: vi.fn(),
  };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getUnit: ReturnType<typeof vi.fn>;
  getPlan: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
  listArtifacts: ReturnType<typeof vi.fn>;
  listQuestions: ReturnType<typeof vi.fn>;
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

const PLAN: Plan = {
  id: 'PLAN-1',
  project_id: 'PROJ-1',
  title: 'Parent plan',
  description: null,
  source: 'manual',
  source_path: null,
  created_at: 0,
  approved_at: null,
  status: 'active',
};

const TASK: Task = {
  id: 'TASK-1',
  unit_id: 'UNIT-1',
  idx: 0,
  title: 'Unit-scoped task',
  body: '',
  created_at: 0,
  started_at: null,
  completed_at: null,
  status: 'in_progress',
  assignee: null,
  depends_on: [],
  ticket_number: 'LM-9',
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

function wireApi({ tasks = [TASK] }: { tasks?: Task[] } = {}) {
  mockedApi.getUnit.mockResolvedValue(UNIT);
  mockedApi.getPlan.mockResolvedValue(PLAN);
  mockedApi.listTasks.mockResolvedValue(tasks);
  mockedApi.listArtifacts.mockResolvedValue([]);
  mockedApi.listQuestions.mockResolvedValue([]);
}

describe('UnitDetail tree-aware listing (LM-10985)', () => {
  it('renders tasks belonging to the unit', async () => {
    wireApi();
    render(<UnitDetail unitId="UNIT-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('unit-detail-tasks')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('unit-detail-task-TASK-1');
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('Unit-scoped task');
  });

  it('fires onSelectItem({type:"task"}) when a task row is clicked', async () => {
    wireApi();
    const onSelectItem = vi.fn();
    render(
      <UnitDetail
        unitId="UNIT-1"
        onClose={() => {}}
        onSelectItem={onSelectItem}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('unit-detail-task-TASK-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('unit-detail-task-TASK-1'));
    expect(onSelectItem).toHaveBeenCalledWith({ type: 'task', id: 'TASK-1' });
  });

  it('disables task rows when onSelectItem is omitted', async () => {
    wireApi();
    render(<UnitDetail unitId="UNIT-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('unit-detail-task-TASK-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('unit-detail-task-TASK-1')).toBeDisabled();
  });
});
