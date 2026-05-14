/**
 * LM-152 / RL-U6-03 — TaskTreeView verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * TaskTreeView`):
 *
 *  1. The 3-depth subtree renders every node with its title, ticket
 *     number, status, and envelope completeness badge.
 *  2. Clicking a node fires `onSelectTask(id)` so the parent can open
 *     the side panel — no internal navigation, no routing assumption.
 *  3. Tree shape is reconstructed from the daemon's flat pre-order
 *     output via parent_task_id, not from result order.
 *  4. Envelope completeness counts only present non-empty fields, so
 *     a node with no resolved envelope shows 0/19 and a fully
 *     populated one shows 19/19.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskTreeView from './TaskTreeView';
import { ENVELOPE_FIELDS, type Task, type TaskTreeNode } from '../types';

vi.mock('../api', () => {
  const getTaskSubtree = vi.fn();
  const namespace = { getTaskSubtree };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getTaskSubtree: ReturnType<typeof vi.fn>;
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

function makeNode(
  overrides: Partial<Task> & Pick<Task, 'id' | 'title'>,
  depth: number,
  resolved?: Record<string, unknown>,
): TaskTreeNode {
  return {
    ...makeTask(overrides),
    depth,
    resolved_envelope: resolved,
  };
}

const FULL_ENVELOPE = Object.fromEntries(
  ENVELOPE_FIELDS.map((f) => [f, f === 'version' || f === 'max_turns' || f === 'checkpoint_interval' ? 1 : `value-${f}`]),
);

beforeEach(() => {
  mockedApi.getTaskSubtree.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskTreeView (LM-152)', () => {
  it('renders a 3-depth tree from the daemon subtree response', async () => {
    // Pre-order: root, child A, grandchild A1, child B
    const subtree: TaskTreeNode[] = [
      makeNode({ id: 'TASK-R', title: 'Root', ticket_number: 'LM-100', status: 'in_progress' }, 0, FULL_ENVELOPE),
      makeNode({ id: 'TASK-A', title: 'Child A', ticket_number: 'LM-101', parent_task_id: 'TASK-R', status: 'todo' }, 1),
      makeNode(
        {
          id: 'TASK-A1',
          title: 'Grandchild A1',
          ticket_number: 'LM-102',
          parent_task_id: 'TASK-A',
          status: 'done',
        },
        2,
        { intent: 'do A1', prompt_template: 'go', success_criteria: ['ok'] },
      ),
      makeNode({ id: 'TASK-B', title: 'Child B', ticket_number: 'LM-103', parent_task_id: 'TASK-R', status: 'blocked' }, 1),
    ];
    mockedApi.getTaskSubtree.mockResolvedValue(subtree);

    render(<TaskTreeView taskId="TASK-R" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading tree...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Child A')).toBeInTheDocument();
    expect(screen.getByText('Grandchild A1')).toBeInTheDocument();
    expect(screen.getByText('Child B')).toBeInTheDocument();

    // Depth attributes are derived from the daemon's `depth` field —
    // the renderer doesn't recompute them from parent traversal.
    const root = screen.getByRole('button', { name: /Root/ });
    expect(root.getAttribute('data-depth')).toBe('0');
    const grandchild = screen.getByRole('button', { name: /Grandchild A1/ });
    expect(grandchild.getAttribute('data-depth')).toBe('2');

    // Daemon was called with the documented depth + envelope opts.
    expect(mockedApi.getTaskSubtree).toHaveBeenCalledWith('TASK-R', {
      depth: 3,
      include_envelope: true,
    });
  });

  it('emits onSelectTask when a node is clicked', async () => {
    const subtree: TaskTreeNode[] = [
      makeNode({ id: 'TASK-R', title: 'Root', ticket_number: 'LM-100' }, 0),
      makeNode({ id: 'TASK-A', title: 'Child A', parent_task_id: 'TASK-R' }, 1),
    ];
    mockedApi.getTaskSubtree.mockResolvedValue(subtree);

    const onSelectTask = vi.fn();
    render(<TaskTreeView taskId="TASK-R" onSelectTask={onSelectTask} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading tree...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Child A/ }));
    expect(onSelectTask).toHaveBeenCalledWith('TASK-A');
  });

  it('counts envelope completeness — full vs empty', async () => {
    const subtree: TaskTreeNode[] = [
      makeNode({ id: 'TASK-R', title: 'Root' }, 0, FULL_ENVELOPE),
      makeNode({ id: 'TASK-A', title: 'Child', parent_task_id: 'TASK-R' }, 1),
      makeNode(
        { id: 'TASK-B', title: 'Half', parent_task_id: 'TASK-R' },
        1,
        // 3 of 19 populated; empty string and empty array don't count
        {
          intent: 'x',
          prompt_template: 'y',
          success_criteria: ['z'],
          target_repo: '',
          context_refs: [],
        },
      ),
    ];
    mockedApi.getTaskSubtree.mockResolvedValue(subtree);

    render(<TaskTreeView taskId="TASK-R" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading tree...')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('envelope-completeness-TASK-R')).toHaveTextContent('19/19');
    expect(screen.getByTestId('envelope-completeness-TASK-A')).toHaveTextContent('0/19');
    expect(screen.getByTestId('envelope-completeness-TASK-B')).toHaveTextContent('3/19');
  });

  it('reconstructs tree shape from parent_task_id, not from result order', async () => {
    // Deliberately scramble the order — children before their parent —
    // to prove the renderer uses parent_task_id, not array index.
    const subtree: TaskTreeNode[] = [
      makeNode({ id: 'TASK-A', title: 'Child A', parent_task_id: 'TASK-R', idx: 0 }, 1),
      makeNode({ id: 'TASK-B', title: 'Child B', parent_task_id: 'TASK-R', idx: 1 }, 1),
      makeNode({ id: 'TASK-R', title: 'Root' }, 0),
    ];
    mockedApi.getTaskSubtree.mockResolvedValue(subtree);

    render(<TaskTreeView taskId="TASK-R" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading tree...')).not.toBeInTheDocument();
    });

    // All three render. Root is at depth 0; the two children at 1.
    const buttons = screen.getAllByRole('button');
    const rootBtn = buttons.find((b) => b.textContent?.includes('Root'))!;
    const aBtn = buttons.find((b) => b.textContent?.includes('Child A'))!;
    expect(rootBtn.getAttribute('data-depth')).toBe('0');
    expect(aBtn.getAttribute('data-depth')).toBe('1');
  });

  it('shows empty-state copy when daemon returns no nodes', async () => {
    mockedApi.getTaskSubtree.mockResolvedValue([]);

    render(<TaskTreeView taskId="TASK-EMPTY" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading tree...')).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('Task has no children to visualize.'),
    ).toBeInTheDocument();
  });

  it('surfaces fetch errors as an alert', async () => {
    mockedApi.getTaskSubtree.mockRejectedValue(new Error('boom'));

    render(<TaskTreeView taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load tree: boom/);
    });
  });
});
