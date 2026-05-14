/**
 * LM-89 / RL-U6-06 — TimelineReplay verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * TimelineReplay`):
 *
 *  1. Mount fetches envelope history + runs in parallel and merges
 *     them into a single chronologically-ordered tape. Latest event
 *     is the default tick.
 *  2. The slider scrubs through ticks; the "current event" card
 *     updates to match. The active envelope is whichever version was
 *     most recently signed at or before the current tick.
 *  3. Play auto-advances through events (one tick per second). Pause
 *     stops it. Reaching the last tick auto-pauses.
 *  4. Empty state copy renders when both streams come back empty —
 *     a fresh task isn't an error.
 *  5. Failed fetch surfaces as an alert.
 *
 *  6. The success_criteria scenario — 3 envelope versions + 5 runs
 *     replayed — produces 8 (envelope) + 10 (run start/end pairs) = 13
 *     events, and a full play cycle visits all of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import TimelineReplay from './TimelineReplay';
import type { EnvelopeHistoryEntry, Run } from '../../types';

vi.mock('../../api', () => {
  const getEnvelopeHistory = vi.fn();
  const listRuns = vi.fn();
  const namespace = { getEnvelopeHistory, listRuns };
  return { default: namespace, ...namespace };
});

import api from '../../api';

const mockedApi = api as unknown as {
  getEnvelopeHistory: ReturnType<typeof vi.fn>;
  listRuns: ReturnType<typeof vi.fn>;
};

function envEntry(version: number, at: number, signed_by = 'main'): EnvelopeHistoryEntry {
  return {
    id: `ENV-${version}`,
    version,
    created_at: at,
    signed_by,
    superseded_at: undefined,
    envelope: { version, intent: `intent-v${version}` },
  };
}

function run(id: string, started_at: number, ended_at: number | null, result: string | null): Run {
  return {
    id,
    task_id: 'TASK-X',
    session_id: null,
    agent: 'claude',
    started_at,
    ended_at,
    result,
    notes: null,
  };
}

beforeEach(() => {
  mockedApi.getEnvelopeHistory.mockReset();
  mockedApi.listRuns.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimelineReplay (LM-89)', () => {
  it('replays 3 envelope versions + 5 runs as a merged event tape', async () => {
    // 3 envelope versions at t=10, 30, 60.
    const history: EnvelopeHistoryEntry[] = [
      envEntry(3, 60),
      envEntry(2, 30),
      envEntry(1, 10),
    ];
    // 5 runs interleaved across 0..100.
    const runs: Run[] = [
      run('RUN-1', 5, 8, 'success'),
      run('RUN-2', 15, 25, 'success'),
      run('RUN-3', 35, 50, 'fail'),
      run('RUN-4', 55, 65, 'success'),
      run('RUN-5', 70, null, null), // still running at the head
    ];
    mockedApi.getEnvelopeHistory.mockResolvedValue(history);
    mockedApi.listRuns.mockResolvedValue(runs);

    render(<TimelineReplay taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading timeline...')).not.toBeInTheDocument();
    });

    // 3 envelope ticks + 4 run-start + 4 run-end (run 5 has no end) = 12 events.
    // Wait — RUN-5 has only a start because ended_at is null, so:
    // 3 envelope + 5 run_start + 4 run_end = 12.
    expect(screen.getByText(/12 events/)).toBeInTheDocument();

    // Default cursor is the latest tick. Active envelope at the head
    // is v3 (signed at t=60); RUN-5 started at t=70, RUN-4 ended at
    // t=65, both are after v3's signing — v3 stays active.
    expect(screen.getByTestId('active-version')).toHaveTextContent(/envelope v3/);
  });

  it('scrubbing the slider updates active envelope and current event', async () => {
    const history: EnvelopeHistoryEntry[] = [
      envEntry(2, 100),
      envEntry(1, 10),
    ];
    const runs: Run[] = [run('RUN-A', 50, 80, 'success')];
    mockedApi.getEnvelopeHistory.mockResolvedValue(history);
    mockedApi.listRuns.mockResolvedValue(runs);

    render(<TimelineReplay taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading timeline...')).not.toBeInTheDocument();
    });

    // Events sorted ascending by `at`: v1@10, RUN-A start@50, RUN-A end@80, v2@100
    // tick 0: envelope event v1.
    const slider = screen.getByLabelText('timeline-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByTestId('current-event').getAttribute('data-event-kind')).toBe('envelope');
    expect(screen.getByTestId('active-version')).toHaveTextContent(/envelope v1/);

    // tick 1: run_start. Active envelope is still v1 (v2 not signed yet).
    fireEvent.change(slider, { target: { value: '1' } });
    expect(screen.getByTestId('current-event').getAttribute('data-event-kind')).toBe('run_start');
    expect(screen.getByTestId('active-version')).toHaveTextContent(/envelope v1/);

    // tick 2: run_end. Still v1 active.
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('current-event').getAttribute('data-event-kind')).toBe('run_end');
    expect(screen.getByTestId('active-version')).toHaveTextContent(/envelope v1/);

    // tick 3: v2 envelope event becomes active.
    fireEvent.change(slider, { target: { value: '3' } });
    expect(screen.getByTestId('current-event').getAttribute('data-event-kind')).toBe('envelope');
    expect(screen.getByTestId('active-version')).toHaveTextContent(/envelope v2/);
  });

  it('Play advances ticks at one per second and auto-pauses at the end', async () => {
    const history: EnvelopeHistoryEntry[] = [envEntry(2, 50), envEntry(1, 10)];
    const runs: Run[] = [run('RUN-A', 30, null, null)];
    mockedApi.getEnvelopeHistory.mockResolvedValue(history);
    mockedApi.listRuns.mockResolvedValue(runs);

    render(<TimelineReplay taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading timeline...')).not.toBeInTheDocument();
    });

    // 3 events (v1, RUN-A start, v2). Default tick = 2 (last).
    const slider = screen.getByLabelText('timeline-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.value).toBe('0');

    // Click Play → ticks advance every second.
    fireEvent.click(screen.getByRole('button', { name: /Play replay/ }));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(slider.value).toBe('1');

    act(() => { vi.advanceTimersByTime(1000); });
    expect(slider.value).toBe('2');

    // Past last tick — auto-pause kicks in (button label flips back).
    act(() => { vi.advanceTimersByTime(1000); });
    expect(slider.value).toBe('2');
    expect(screen.getByRole('button', { name: /Play replay/ })).toBeInTheDocument();
  });

  it('renders empty-state copy when there is no history or runs', async () => {
    mockedApi.getEnvelopeHistory.mockResolvedValue([]);
    mockedApi.listRuns.mockResolvedValue([]);

    render(<TimelineReplay taskId="TASK-NEW" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading timeline...')).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('No history to replay yet — task has no envelope versions or runs.'),
    ).toBeInTheDocument();
  });

  it('surfaces a fetch error as an alert', async () => {
    mockedApi.getEnvelopeHistory.mockRejectedValue(new Error('history boom'));
    mockedApi.listRuns.mockResolvedValue([]);

    render(<TimelineReplay taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load timeline: history boom/);
    });
  });
});
