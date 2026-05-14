/**
 * LM-90 / RL-U6-07 — RunCompare verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * RunCompare`):
 *
 *  1. Lists every run for the task with a checkbox; selecting two
 *     runs renders a side-by-side diff panel ("2 run 선택 후 diff
 *     렌더").
 *  2. The diff panel shows agent, duration, result, and changed-file
 *     sets (only-A / only-B / common) parsed from each run's `notes`
 *     JSON.
 *  3. `target_model` is resolved from the envelope active at each
 *     run's `started_at` so envelope drift between runs is visible
 *     even when `agent` is the same string.
 *  4. Selecting a third run evicts the oldest selection so the cap is
 *     always 2 — the diff stays consistent.
 *  5. Tasks with fewer than 2 runs render an empty-state copy instead
 *     of an unusable selector.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RunCompare from './RunCompare';
import type { EnvelopeHistoryEntry, Run } from '../../types';

vi.mock('../../api', () => {
  const listRuns = vi.fn();
  const getEnvelopeHistory = vi.fn();
  const namespace = { listRuns, getEnvelopeHistory };
  return { default: namespace, ...namespace };
});

import api from '../../api';

const mockedApi = api as unknown as {
  listRuns: ReturnType<typeof vi.fn>;
  getEnvelopeHistory: ReturnType<typeof vi.fn>;
};

function makeRun(id: string, started_at: number, ended_at: number | null, result: string | null, notes: string | null): Run {
  return {
    id,
    task_id: 'TASK-X',
    session_id: null,
    agent: 'claude',
    started_at,
    ended_at,
    result,
    notes,
  };
}

beforeEach(() => {
  mockedApi.listRuns.mockReset();
  mockedApi.getEnvelopeHistory.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RunCompare (LM-90)', () => {
  it('renders diff panel after selecting 2 runs with changed-file sets', async () => {
    const runs: Run[] = [
      makeRun('RUN-A', 100, 200, 'success', JSON.stringify({ changed_files: ['x.rs', 'y.rs'] })),
      makeRun('RUN-B', 300, 450, 'fail', JSON.stringify({ changed_files: ['y.rs', 'z.rs'] })),
    ];
    mockedApi.listRuns.mockResolvedValue(runs);
    mockedApi.getEnvelopeHistory.mockResolvedValue([]);

    render(<RunCompare taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading runs...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Select run RUN-A'));
    fireEvent.click(screen.getByLabelText('Select run RUN-B'));

    const diff = screen.getByLabelText('run-diff');
    expect(diff.getAttribute('data-run-a')).toBe('RUN-A');
    expect(diff.getAttribute('data-run-b')).toBe('RUN-B');

    // Each side panel renders agent/duration/result.
    const panelA = screen.getByTestId('run-panel-a');
    expect(within(panelA).getByText(/duration:/).parentElement).toHaveTextContent('100 ms');
    expect(within(panelA).getByText(/result:/).parentElement).toHaveTextContent('success');
    expect(within(panelA).getByText(/only-this-side files \(1\):/)).toBeInTheDocument();
    expect(within(panelA).getByText('x.rs')).toBeInTheDocument();

    const panelB = screen.getByTestId('run-panel-b');
    expect(within(panelB).getByText(/only-this-side files \(1\):/)).toBeInTheDocument();
    expect(within(panelB).getByText('z.rs')).toBeInTheDocument();

    const common = screen.getByTestId('run-diff-common');
    expect(within(common).getByText('y.rs')).toBeInTheDocument();
  });

  it('resolves target_model from the envelope active at run start', async () => {
    const runs: Run[] = [
      makeRun('RUN-A', 100, 200, 'success', null),
      makeRun('RUN-B', 500, 600, 'success', null),
    ];
    // Daemon returns newest-first: v2 created at t=400, v1 at t=50.
    const history: EnvelopeHistoryEntry[] = [
      {
        id: 'ENV-2',
        version: 2,
        created_at: 400,
        signed_by: 'main',
        envelope: { target_model: 'opus' },
      },
      {
        id: 'ENV-1',
        version: 1,
        created_at: 50,
        signed_by: 'main',
        envelope: { target_model: 'sonnet' },
      },
    ];
    mockedApi.listRuns.mockResolvedValue(runs);
    mockedApi.getEnvelopeHistory.mockResolvedValue(history);

    render(<RunCompare taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading runs...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Select run RUN-A'));
    fireEvent.click(screen.getByLabelText('Select run RUN-B'));

    // RUN-A started at t=100 → v1 active → sonnet.
    // RUN-B started at t=500 → v2 active → opus.
    const panelA = screen.getByTestId('run-panel-a');
    expect(within(panelA).getByText(/target_model:/).parentElement).toHaveTextContent('sonnet');
    const panelB = screen.getByTestId('run-panel-b');
    expect(within(panelB).getByText(/target_model:/).parentElement).toHaveTextContent('opus');
  });

  it('selecting a third run evicts the oldest selection', async () => {
    const runs: Run[] = [
      makeRun('RUN-A', 100, 200, 'success', null),
      makeRun('RUN-B', 300, 400, 'success', null),
      makeRun('RUN-C', 500, 600, 'success', null),
    ];
    mockedApi.listRuns.mockResolvedValue(runs);
    mockedApi.getEnvelopeHistory.mockResolvedValue([]);

    render(<RunCompare taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading runs...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Select run RUN-A'));
    fireEvent.click(screen.getByLabelText('Select run RUN-B'));
    fireEvent.click(screen.getByLabelText('Select run RUN-C'));

    // RUN-A evicted, B & C diffed.
    const diff = screen.getByLabelText('run-diff');
    expect(diff.getAttribute('data-run-a')).toBe('RUN-B');
    expect(diff.getAttribute('data-run-b')).toBe('RUN-C');
  });

  it('shows empty-state when fewer than 2 runs exist', async () => {
    mockedApi.listRuns.mockResolvedValue([
      makeRun('RUN-A', 100, 200, 'success', null),
    ]);
    mockedApi.getEnvelopeHistory.mockResolvedValue([]);

    render(<RunCompare taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading runs...')).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('Need at least 2 runs on this task to compare. Currently 1.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('run-diff')).not.toBeInTheDocument();
  });

  it('falls back gracefully when notes is not parseable as JSON', async () => {
    const runs: Run[] = [
      makeRun('RUN-A', 100, 200, 'success', 'free text notes — no JSON'),
      makeRun('RUN-B', 300, 400, 'success', JSON.stringify({ changed_files: ['x.rs'] })),
    ];
    mockedApi.listRuns.mockResolvedValue(runs);
    mockedApi.getEnvelopeHistory.mockResolvedValue([]);

    render(<RunCompare taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading runs...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Select run RUN-A'));
    fireEvent.click(screen.getByLabelText('Select run RUN-B'));

    // RUN-A side has no parseable file list → only-A is empty,
    // common is empty (RUN-A has no files), only-B = [x.rs].
    const panelA = screen.getByTestId('run-panel-a');
    expect(within(panelA).getByText(/only-this-side files \(0\):/)).toBeInTheDocument();
    const panelB = screen.getByTestId('run-panel-b');
    expect(within(panelB).getByText('x.rs')).toBeInTheDocument();
  });
});
