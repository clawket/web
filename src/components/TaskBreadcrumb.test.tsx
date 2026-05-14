/**
 * LM-88 / RL-U6-05 — TaskBreadcrumb verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * TaskBreadcrumb`):
 *
 *  1. Renders a breadcrumb root → ... → parent → current. Daemon
 *     returns ancestors farthest-first (root last); the component
 *     reverses so the leftmost crumb is the root.
 *  2. Each ancestor crumb is clickable and fires `onSelectTask(id)` —
 *     no internal navigation, mirrors the rest of the side panel.
 *  3. The current task always renders as the trailing crumb with
 *     aria-current="page" — the user must always know where they are.
 *  4. A direct-children panel renders below the crumb when descendants
 *     exist; clicking a child also fires `onSelectTask(id)`.
 *  5. A root task (no ancestors) shows a "root task" marker so the
 *     breadcrumb area is never empty — success_criteria says "루트
 *     태스크 정상 네비".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskBreadcrumb from './TaskBreadcrumb';
import type { Task, TaskTreeNode } from '../types';

vi.mock('../api', () => {
  const getTaskAncestors = vi.fn();
  const getTaskDescendants = vi.fn();
  const namespace = { getTaskAncestors, getTaskDescendants };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getTaskAncestors: ReturnType<typeof vi.fn>;
  getTaskDescendants: ReturnType<typeof vi.fn>;
};

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    unit_id: 'UNIT-1',
    idx: 0,
    body: '',
    created_at: 0,
    started_at: null,
    completed_at: null,
    status: 'todo',
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
    ...overrides,
  };
}

function makeNode(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>, depth: number): TaskTreeNode {
  return { ...makeTask(overrides), depth, resolved_envelope: undefined };
}

beforeEach(() => {
  mockedApi.getTaskAncestors.mockReset();
  mockedApi.getTaskDescendants.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskBreadcrumb (LM-88)', () => {
  it('renders ancestors root → parent and current as the trailing crumb', async () => {
    const current = makeTask({ id: 'TASK-CUR', title: 'Current task', ticket_number: 'LM-CUR' });
    // Daemon returns farthest-first (root LAST).
    const ancestors: TaskTreeNode[] = [
      makeNode({ id: 'TASK-PARENT', title: 'Parent', ticket_number: 'LM-PARENT' }, 1),
      makeNode({ id: 'TASK-ROOT', title: 'Root', ticket_number: 'LM-ROOT' }, 2),
    ];
    mockedApi.getTaskAncestors.mockResolvedValue(ancestors);
    mockedApi.getTaskDescendants.mockResolvedValue([]);

    const onSelectTask = vi.fn();
    render(<TaskBreadcrumb task={current} onSelectTask={onSelectTask} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading navigation...')).not.toBeInTheDocument();
    });

    const crumb = screen.getByLabelText('breadcrumb');
    const items = within(crumb).getAllByRole('listitem');
    // Root → Parent → Current.
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/LM-ROOT/);
    expect(items[0]).toHaveTextContent(/Root/);
    expect(items[1]).toHaveTextContent(/LM-PARENT/);
    expect(items[1]).toHaveTextContent(/Parent/);
    expect(items[2]).toHaveAttribute('aria-current', 'page');
    expect(items[2]).toHaveTextContent(/LM-CUR/);
    expect(items[2]).toHaveTextContent(/Current task/);

    // Daemon called with sensible defaults — no envelope payload, deep
    // enough chain to cover any realistic decomposition.
    expect(mockedApi.getTaskAncestors).toHaveBeenCalledWith('TASK-CUR', {
      depth: 64,
      include_envelope: false,
    });
    expect(mockedApi.getTaskDescendants).toHaveBeenCalledWith('TASK-CUR', {
      depth: 1,
      include_envelope: false,
    });
  });

  it('clicking an ancestor crumb fires onSelectTask with that task id', async () => {
    const current = makeTask({ id: 'TASK-CUR', title: 'Current' });
    mockedApi.getTaskAncestors.mockResolvedValue([
      makeNode({ id: 'TASK-PARENT', title: 'Parent' }, 1),
      makeNode({ id: 'TASK-ROOT', title: 'Root' }, 2),
    ]);
    mockedApi.getTaskDescendants.mockResolvedValue([]);

    const onSelectTask = vi.fn();
    render(<TaskBreadcrumb task={current} onSelectTask={onSelectTask} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading navigation...')).not.toBeInTheDocument();
    });

    fireEvent.click(document.querySelector('[data-task-id="TASK-ROOT"]')!);
    expect(onSelectTask).toHaveBeenCalledWith('TASK-ROOT');

    fireEvent.click(document.querySelector('[data-task-id="TASK-PARENT"]')!);
    expect(onSelectTask).toHaveBeenCalledWith('TASK-PARENT');
  });

  it('renders direct children below the crumb and propagates clicks', async () => {
    const current = makeTask({ id: 'TASK-CUR', title: 'Current' });
    mockedApi.getTaskAncestors.mockResolvedValue([]);
    mockedApi.getTaskDescendants.mockResolvedValue([
      makeNode({ id: 'TASK-A', title: 'Child A', ticket_number: 'LM-A', parent_task_id: 'TASK-CUR' }, 1),
      makeNode({ id: 'TASK-B', title: 'Child B', ticket_number: 'LM-B', parent_task_id: 'TASK-CUR', status: 'done' }, 1),
    ]);

    const onSelectTask = vi.fn();
    render(<TaskBreadcrumb task={current} onSelectTask={onSelectTask} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading navigation...')).not.toBeInTheDocument();
    });

    const panel = screen.getByLabelText('children-panel');
    expect(within(panel).getByText('Child A')).toBeInTheDocument();
    expect(within(panel).getByText('Child B')).toBeInTheDocument();
    expect(within(panel).getByText('2 direct children')).toBeInTheDocument();

    fireEvent.click(within(panel).getAllByRole('button')[1]);
    expect(onSelectTask).toHaveBeenCalledWith('TASK-B');
  });

  it('renders a "root task" marker when the task has no ancestors', async () => {
    const current = makeTask({ id: 'TASK-ROOT', title: 'Root', ticket_number: 'LM-R' });
    mockedApi.getTaskAncestors.mockResolvedValue([]);
    mockedApi.getTaskDescendants.mockResolvedValue([]);

    render(<TaskBreadcrumb task={current} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading navigation...')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('breadcrumb-root-marker')).toBeInTheDocument();
    // Current task is still the trailing crumb with aria-current.
    const cur = screen.getByTestId('breadcrumb-current');
    expect(cur).toHaveAttribute('aria-current', 'page');
    expect(cur).toHaveTextContent(/LM-R/);
    expect(cur).toHaveTextContent(/Root/);
  });

  it('hides the children panel when the daemon returns no descendants', async () => {
    const current = makeTask({ id: 'TASK-LEAF', title: 'Leaf' });
    mockedApi.getTaskAncestors.mockResolvedValue([
      makeNode({ id: 'TASK-ROOT', title: 'Root' }, 1),
    ]);
    mockedApi.getTaskDescendants.mockResolvedValue([]);

    render(<TaskBreadcrumb task={current} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading navigation...')).not.toBeInTheDocument();
    });

    expect(screen.queryByLabelText('children-panel')).not.toBeInTheDocument();
  });

  it('surfaces fetch errors as an alert', async () => {
    const current = makeTask({ id: 'TASK-X', title: 'Broken' });
    mockedApi.getTaskAncestors.mockRejectedValue(new Error('boom'));
    mockedApi.getTaskDescendants.mockResolvedValue([]);

    render(<TaskBreadcrumb task={current} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load navigation: boom/);
    });
  });
});
