import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskDetail from './TaskDetail';
import type { Task, Unit, Plan } from '../types';

vi.mock('../api', () => {
  const namespace = {
    getTask: vi.fn(),
    getUnit: vi.fn(),
    getPlan: vi.fn(),
    listUnits: vi.fn(async () => []),
    listArtifacts: vi.fn(async () => []),
    listRuns: vi.fn(async () => []),
    listQuestions: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    listCycles: vi.fn(async () => []),
    listChildTasks: vi.fn(async () => []),
    fetchTaskComments: vi.fn(async () => []),
    getTaskEnvelope: vi.fn(async () => null),
    validateTaskEnvelope: vi.fn(async () => ({ violations: [] })),
    getEnvelopeHistory: vi.fn(async () => []),
    getTaskAncestors: vi.fn(async () => []),
    getTaskDescendants: vi.fn(async () => []),
    decomposeTask: vi.fn(async () => ({
      parent: { id: 'T1', ticket_number: 'LM-1', title: 'X' },
      strategy: 'auto',
      max_depth: 2,
      existing_children_count: 0,
      suggested_subtasks: [],
      policy_violations: [],
    })),
    createSubtask: vi.fn(),
    createTaskComment: vi.fn(),
    deleteTask: vi.fn(),
    deleteTaskComment: vi.fn(),
    updateTask: vi.fn(),
    ApiError: class ApiError extends Error {},
  };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getTask: ReturnType<typeof vi.fn>;
  getUnit: ReturnType<typeof vi.fn>;
  getPlan: ReturnType<typeof vi.fn>;
  listUnits: ReturnType<typeof vi.fn>;
  listChildTasks: ReturnType<typeof vi.fn>;
  fetchTaskComments: ReturnType<typeof vi.fn>;
};

function makeTask(p: Partial<Task>): Task {
  return {
    id: p.id ?? 'TASK-X',
    unit_id: p.unit_id ?? 'UNIT-1',
    cycle_id: 'CYC-1',
    parent_task_id: null,
    ticket_number: p.ticket_number ?? 'LM-X',
    idx: p.idx ?? 0,
    title: p.title ?? 'Task title',
    body: p.body ?? '',
    priority: 'medium',
    complexity: null,
    estimated_edits: null,
    type: 'task',
    reporter: null,
    assignee: 'main',
    agent_id: null,
    created_at: 0,
    started_at: null,
    completed_at: null,
    status: p.status ?? 'todo',
    depends_on: p.depends_on ?? [],
    labels: [],
    atomic_size_hint: 'small',
    decomposition_policy: 'auto',
    ...p,
  } as unknown as Task;
}

const UNIT: Unit = {
  id: 'UNIT-1',
  plan_id: 'PLAN-1',
  idx: 0,
  title: 'Unit',
  goal: null,
  execution_mode: 'sequential',
  created_at: 0,
} as unknown as Unit;

const PLAN: Plan = {
  id: 'PLAN-1',
  project_id: 'PROJ-1',
  title: 'Plan',
  description: null,
  source: 'manual',
  source_path: null,
  created_at: 0,
  approved_at: null,
  status: 'active',
};

describe('TaskDetail depends_on rendering — web↔desktop parity (LM-10992)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listUnits.mockResolvedValue([UNIT]);
    mockedApi.getUnit.mockResolvedValue(UNIT);
    mockedApi.getPlan.mockResolvedValue(PLAN);
    mockedApi.listChildTasks.mockResolvedValue([]);
    mockedApi.fetchTaskComments.mockResolvedValue([]);
  });

  it('resolves dep IDs to ticket numbers and renders a clickable button per dep', async () => {
    const TASK = makeTask({
      id: 'T1',
      ticket_number: 'LM-1',
      depends_on: ['T-DEP-1', 'T-DEP-MISSING'],
    });
    const DEP1 = makeTask({
      id: 'T-DEP-1',
      ticket_number: 'LM-99',
      title: 'Blocker task',
    });
    mockedApi.getTask.mockImplementation(async (id: string) => {
      if (id === 'T1') return TASK;
      if (id === 'T-DEP-1') return DEP1;
      throw new Error('not found');
    });

    const onSelectTask = vi.fn();
    render(
      <TaskDetail
        taskId="T1"
        projectId="PROJ-1"
        onClose={() => {}}
        onSelectTask={onSelectTask}
      />,
    );

    const list = await screen.findByTestId('task-detail-depends-on');
    // Resolved dep → ticket number
    const resolvedBtn = await within(list).findByText('LM-99');
    expect(resolvedBtn.tagName).toBe('BUTTON');
    expect(resolvedBtn).toHaveAttribute('title', 'Blocker task');
    // Unresolved dep → ID slice fallback
    const fallbackBtn = within(list).getByText('…ISSING');
    expect(fallbackBtn.tagName).toBe('BUTTON');
    expect(fallbackBtn).toHaveAttribute('title', 'T-DEP-MISSING');
  });

  it('fires onSelectTask with the dep id when a dependency button is clicked', async () => {
    const TASK = makeTask({
      id: 'T1',
      depends_on: ['T-DEP-1'],
    });
    const DEP1 = makeTask({
      id: 'T-DEP-1',
      ticket_number: 'LM-99',
      title: 'Blocker',
    });
    mockedApi.getTask.mockImplementation(async (id: string) => {
      if (id === 'T1') return TASK;
      if (id === 'T-DEP-1') return DEP1;
      throw new Error('not found');
    });

    const onSelectTask = vi.fn();
    render(
      <TaskDetail
        taskId="T1"
        projectId="PROJ-1"
        onClose={() => {}}
        onSelectTask={onSelectTask}
      />,
    );

    const btn = await screen.findByText('LM-99');
    fireEvent.click(btn);
    await waitFor(() => expect(onSelectTask).toHaveBeenCalledWith('T-DEP-1'));
  });

  it('hides the Dependencies section when depends_on is empty', async () => {
    const TASK = makeTask({ id: 'T1', depends_on: [] });
    mockedApi.getTask.mockImplementation(async (id: string) => {
      if (id === 'T1') return TASK;
      throw new Error('not found');
    });

    render(
      <TaskDetail
        taskId="T1"
        projectId="PROJ-1"
        onClose={() => {}}
      />,
    );

    await screen.findByText('LM-X', undefined, { timeout: 2000 }).catch(() => {});
    expect(screen.queryByTestId('task-detail-depends-on')).toBeNull();
  });
});
