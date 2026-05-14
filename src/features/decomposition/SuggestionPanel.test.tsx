/**
 * LM-87 / RL-U6-04 — SuggestionPanel verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * SuggestionPanel`):
 *
 *  1. Mounts → POST /tasks/:id/decompose, renders one row per
 *     `success_criteria` entry returned by the daemon.
 *  2. User can multi-select rows; "Accept N" calls
 *     POST /tasks/:id/subtasks once per selected suggestion in
 *     panel order, with sequential `idx`. After all succeed
 *     `onAccepted()` fires so the parent can refresh the tree
 *     ("승인 → 트리 즉시 갱신").
 *  3. The keyboard-accessible up/down buttons reorder rows and the
 *     reorder is reflected in the eventual createSubtask call order
 *     (drag-drop's keyboard parity per RL-U6-04 spec).
 *  4. Policy violations from the daemon render with severity/field
 *     attributes so the inheritance test can later assert against
 *     them.
 *  5. A failing decompose surfaces as an alert; a failing accept
 *     surfaces an inline error without losing the panel state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuggestionPanel from './SuggestionPanel';
import type { DecompositionResult } from '../../types';

vi.mock('../../api', () => {
  const decomposeTask = vi.fn();
  const createSubtask = vi.fn();
  const namespace = { decomposeTask, createSubtask };
  return { default: namespace, ...namespace };
});

import api from '../../api';

const mockedApi = api as unknown as {
  decomposeTask: ReturnType<typeof vi.fn>;
  createSubtask: ReturnType<typeof vi.fn>;
};

function makeResult(overrides: Partial<DecompositionResult> = {}): DecompositionResult {
  return {
    parent: { id: 'TASK-P', ticket_number: 'LM-100', title: 'Parent task' },
    strategy: 'auto',
    max_depth: 2,
    existing_children_count: 0,
    suggested_subtasks: [
      { idx: 0, title: 'Form renders 19 fields', rationale: 'criterion A', scope_hint: 'web/src', inherited_envelope_keys: [] },
      { idx: 1, title: 'PATCH wired',             rationale: 'criterion B', scope_hint: 'web/src', inherited_envelope_keys: [] },
      { idx: 2, title: 'List parsing works',      rationale: 'criterion C', scope_hint: 'web/src', inherited_envelope_keys: [] },
    ],
    policy_violations: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockedApi.decomposeTask.mockReset();
  mockedApi.createSubtask.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SuggestionPanel (LM-87)', () => {
  it('renders one row per success_criteria entry from the daemon', async () => {
    mockedApi.decomposeTask.mockResolvedValue(makeResult());

    render(<SuggestionPanel taskId="TASK-P" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    expect(mockedApi.decomposeTask).toHaveBeenCalledWith('TASK-P', {
      strategy: 'auto',
      max_depth: 2,
    });
    expect(screen.getByText('Form renders 19 fields')).toBeInTheDocument();
    expect(screen.getByText('PATCH wired')).toBeInTheDocument();
    expect(screen.getByText('List parsing works')).toBeInTheDocument();
    // Strategy badge surfaced so the user sees what the daemon ran.
    expect(screen.getByText(/strategy: auto/)).toBeInTheDocument();
  });

  it('Accept N posts createSubtask once per selected row in panel order', async () => {
    mockedApi.decomposeTask.mockResolvedValue(makeResult());
    mockedApi.createSubtask.mockResolvedValue({ task: { id: 'TASK-CHILD' } });

    const user = userEvent.setup();
    const onAccepted = vi.fn();
    render(<SuggestionPanel taskId="TASK-P" onAccepted={onAccepted} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    // Select rows 0 and 2 — row 1 stays unchecked.
    await user.click(screen.getByLabelText('Select Form renders 19 fields'));
    await user.click(screen.getByLabelText('Select List parsing works'));

    const acceptBtn = screen.getByRole('button', { name: /Accept 2 selected/ });
    await user.click(acceptBtn);

    await waitFor(() => expect(mockedApi.createSubtask).toHaveBeenCalledTimes(2));

    // Sequential idx assigned in order of selection within the panel
    // (selected rows preserve their visible order, not click order).
    const [firstParent, firstBody] = mockedApi.createSubtask.mock.calls[0];
    const [secondParent, secondBody] = mockedApi.createSubtask.mock.calls[1];
    expect(firstParent).toBe('TASK-P');
    expect(secondParent).toBe('TASK-P');
    expect(firstBody.title).toBe('Form renders 19 fields');
    expect(firstBody.idx).toBe(0);
    expect(secondBody.title).toBe('List parsing works');
    expect(secondBody.idx).toBe(1);

    // onAccepted fires after all subtasks are persisted.
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
  });

  it('reorder via up/down buttons changes the order createSubtask is called', async () => {
    mockedApi.decomposeTask.mockResolvedValue(makeResult());
    mockedApi.createSubtask.mockResolvedValue({ task: { id: 'TASK-CHILD' } });

    const user = userEvent.setup();
    render(<SuggestionPanel taskId="TASK-P" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    // Move "List parsing works" (last) up twice → becomes first.
    await user.click(screen.getByLabelText('Move List parsing works up'));
    await user.click(screen.getByLabelText('Move List parsing works up'));

    // Select all three to validate the new ordering.
    await user.click(screen.getByLabelText('Select List parsing works'));
    await user.click(screen.getByLabelText('Select Form renders 19 fields'));
    await user.click(screen.getByLabelText('Select PATCH wired'));

    await user.click(screen.getByRole('button', { name: /Accept 3 selected/ }));

    await waitFor(() => expect(mockedApi.createSubtask).toHaveBeenCalledTimes(3));

    const titles = mockedApi.createSubtask.mock.calls.map((c) => c[1].title);
    expect(titles).toEqual([
      'List parsing works',
      'Form renders 19 fields',
      'PATCH wired',
    ]);
    // idx is panel-order: 0, 1, 2 — the daemon will resolve the
    // absolute position relative to existing children.
    const idxs = mockedApi.createSubtask.mock.calls.map((c) => c[1].idx);
    expect(idxs).toEqual([0, 1, 2]);
  });

  it('renders policy violations from the daemon with severity + field metadata', async () => {
    mockedApi.decomposeTask.mockResolvedValue(
      makeResult({
        policy_violations: [
          { field: 'success_criteria', severity: 'warning', message: 'less than 2 entries' },
          { field: 'decomposition_policy', severity: 'error', message: 'missing' },
        ],
      }),
    );

    render(<SuggestionPanel taskId="TASK-P" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    const list = screen.getByLabelText('policy-violations');
    const items = within(list).getAllByRole('alert');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-severity')).toBe('warning');
    expect(items[0].getAttribute('data-field')).toBe('success_criteria');
    expect(items[1].getAttribute('data-severity')).toBe('error');
    expect(items[1].getAttribute('data-field')).toBe('decomposition_policy');
  });

  it('surfaces a decompose failure as an alert and disables Accept', async () => {
    mockedApi.decomposeTask.mockRejectedValue(new Error('daemon down'));

    render(<SuggestionPanel taskId="TASK-P" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to decompose: daemon down/);
    });
    // The accept button never renders because the panel never mounts
    // its row list; the error path returns early.
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

  it('keeps panel state when an accept call fails so the user can retry', async () => {
    mockedApi.decomposeTask.mockResolvedValue(makeResult());
    mockedApi.createSubtask.mockRejectedValueOnce(new Error('write failed'));

    const user = userEvent.setup();
    const onAccepted = vi.fn();
    render(<SuggestionPanel taskId="TASK-P" onAccepted={onAccepted} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Select Form renders 19 fields'));
    await user.click(screen.getByRole('button', { name: /Accept 1 selected/ }));

    await waitFor(() => {
      expect(screen.getByText(/Accept failed: write failed/)).toBeInTheDocument();
    });
    expect(onAccepted).not.toHaveBeenCalled();
    // Row remains so the user can re-trigger.
    expect(screen.getByLabelText('Select Form renders 19 fields')).toBeInTheDocument();
  });

  it('drag-drop reorder uses native HTML5 dataTransfer with text/x-suggestion-key', async () => {
    mockedApi.decomposeTask.mockResolvedValue(makeResult());
    mockedApi.createSubtask.mockResolvedValue({ task: { id: 'TASK-CHILD' } });

    render(<SuggestionPanel taskId="TASK-P" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading suggestions...')).not.toBeInTheDocument();
    });

    // Simulate dropping row idx=2 onto row idx=0 — the resulting
    // panel order should put "List parsing works" first.
    const rowFrom = document.querySelector('[data-suggestion-key="2"]') as HTMLElement;
    const rowTo = document.querySelector('[data-suggestion-key="0"]') as HTMLElement;
    expect(rowFrom).toBeTruthy();
    expect(rowTo).toBeTruthy();

    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => { data[k] = v; },
      getData: (k: string) => data[k] ?? '',
      effectAllowed: 'none',
      dropEffect: 'none',
    };

    fireEvent.dragStart(rowFrom, { dataTransfer });
    fireEvent.dragOver(rowTo, { dataTransfer });
    fireEvent.drop(rowTo, { dataTransfer });

    expect(data['text/x-suggestion-key']).toBe('2');

    // After the reorder the visible first row text should be the
    // dragged one. We assert by reading the rendered <li> sequence.
    const items = document.querySelectorAll('[data-suggestion-key]');
    expect(items[0].getAttribute('data-suggestion-key')).toBe('2');
    expect(items[1].getAttribute('data-suggestion-key')).toBe('0');
    expect(items[2].getAttribute('data-suggestion-key')).toBe('1');
  });
});
