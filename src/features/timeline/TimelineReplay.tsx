/**
 * LM-89 / RL-U6-06 — Timeline replay view.
 *
 * Renders the task's history as a single chronologically-ordered tape
 * of two event streams:
 *
 *   1. Envelope versions (`GET /tasks/:id/envelope/history`) — each
 *      version is a "state-change" tick. The newest is the active
 *      envelope (no `superseded_at`).
 *   2. Run lifecycle events (`GET /runs?task_id=:id`) — each run
 *      contributes `run_start` at `started_at` and, if finished,
 *      `run_end` at `ended_at`.
 *
 * Timeline mechanics:
 *   - Events are sorted by their `at` timestamp ascending.
 *   - A slider scrubs through ticks 0..N-1; each tick shows the state
 *     of the envelope at that moment plus the most recent run event.
 *   - Play/pause auto-advances the slider at one tick per second
 *     (uses `setInterval` so jsdom can mock it cleanly).
 *
 * Why no charting library: the verification surface is "3 envelope
 * versions + 5 runs replayed", which is well-served by a slider + a
 * card showing the resolved-at-tick state. A timeline component from
 * recharts/visx would dwarf the bundle for no extra clarity. If a
 * future view needs duration bars or zooming, swap this for a
 * dedicated component without breaking its API (taskId in, nothing out).
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import type { EnvelopeHistoryEntry, EnvelopeJson, Run } from '../../types';
import { Button } from '../../components/ui';

interface TimelineReplayProps {
  taskId: string;
}

type ReplayEvent =
  | {
      kind: 'envelope';
      at: number;
      version: number;
      signed_by: string;
      envelope: EnvelopeJson;
    }
  | {
      kind: 'run_start';
      at: number;
      runId: string;
      agent: string;
    }
  | {
      kind: 'run_end';
      at: number;
      runId: string;
      agent: string;
      result: string | null;
    };

interface FetchState {
  taskId: string;
  events: ReplayEvent[] | null;
  error: string | null;
}

const TICK_INTERVAL_MS = 1000;

function buildEvents(history: EnvelopeHistoryEntry[], runs: Run[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const h of history) {
    out.push({
      kind: 'envelope',
      at: h.created_at,
      version: h.version,
      signed_by: h.signed_by,
      envelope: h.envelope,
    });
  }
  for (const r of runs) {
    out.push({ kind: 'run_start', at: r.started_at, runId: r.id, agent: r.agent });
    if (r.ended_at != null) {
      out.push({
        kind: 'run_end',
        at: r.ended_at,
        runId: r.id,
        agent: r.agent,
        result: r.result,
      });
    }
  }
  // Stable sort by timestamp; ties preserve insertion order (envelope
  // versions before runs at the same instant).
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** Active envelope as of the timeline cursor. Walks backward from the
 *  cursor to find the most recent envelope event — a tick that lands
 *  on a run event still resolves to the envelope active at that moment. */
function envelopeAtTick(events: ReplayEvent[], tick: number): {
  version: number;
  envelope: EnvelopeJson;
  signed_by: string;
} | null {
  for (let i = tick; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'envelope') {
      return { version: e.version, envelope: e.envelope, signed_by: e.signed_by };
    }
  }
  return null;
}

function formatTimestamp(at: number | string | null | undefined): string {
  if (at == null || at === '') return '—';
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function TimelineReplay({ taskId }: TimelineReplayProps) {
  const [state, setState] = useState<FetchState>({ taskId, events: null, error: null });
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getEnvelopeHistory(taskId), api.listRuns({ task_id: taskId })])
      .then(([history, runs]) => {
        if (cancelled) return;
        const events = buildEvents(history, runs);
        setState({ taskId, events, error: null });
        // Land on the latest tick by default — the user usually wants
        // the present state and scrubs backward from there.
        setTick(events.length > 0 ? events.length - 1 : 0);
        setPlaying(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          taskId,
          events: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Auto-advance during playback. Stops at the last tick.
  useEffect(() => {
    if (!playing) return;
    const events = state.events;
    if (!events || events.length === 0) return;
    const handle = setInterval(() => {
      setTick((prev) => {
        if (prev >= events.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [playing, state.events]);

  const isLoading = state.taskId !== taskId || (state.events === null && state.error === null);

  const eventsAtTick = useMemo(() => {
    if (!state.events) return null;
    if (state.events.length === 0) return null;
    return {
      current: state.events[Math.min(tick, state.events.length - 1)],
      envelope: envelopeAtTick(state.events, Math.min(tick, state.events.length - 1)),
    };
  }, [state.events, tick]);

  if (isLoading) {
    return (
      <div className="text-xs text-muted py-2" aria-busy="true">
        Loading timeline...
      </div>
    );
  }

  if (state.error) {
    return (
      <div role="alert" className="text-xs text-danger py-2">
        Failed to load timeline: {state.error}
      </div>
    );
  }

  const events = state.events ?? [];
  if (events.length === 0) {
    return (
      <div className="text-xs text-muted py-2">
        No history to replay yet — task has no envelope versions or runs.
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-label="timeline-replay">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>
          {events.length} event{events.length === 1 ? '' : 's'} ·{' '}
          tick {tick + 1}/{events.length}
        </span>
        <span aria-hidden>·</span>
        {eventsAtTick?.envelope ? (
          <span data-testid="active-version">envelope v{eventsAtTick.envelope.version}</span>
        ) : (
          <span data-testid="active-version">no envelope yet</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={playing ? 'secondary' : 'primary'}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          disabled={tick >= events.length - 1 && !playing}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <input
          type="range"
          aria-label="timeline-slider"
          min={0}
          max={events.length - 1}
          value={tick}
          onChange={(e) => {
            setTick(Number.parseInt(e.target.value, 10));
            setPlaying(false);
          }}
          className="flex-1"
        />
      </div>

      {eventsAtTick && (
        <div className="space-y-2 text-xs">
          <div
            className="border border-border rounded p-2 bg-background"
            data-testid="current-event"
            data-event-kind={eventsAtTick.current.kind}
          >
            <div className="text-muted">{formatTimestamp(eventsAtTick.current.at)}</div>
            {eventsAtTick.current.kind === 'envelope' && (
              <div>
                <span className="font-medium text-foreground">envelope v{eventsAtTick.current.version}</span>
                {' '}signed by{' '}
                <span className="font-mono">{eventsAtTick.current.signed_by}</span>
              </div>
            )}
            {eventsAtTick.current.kind === 'run_start' && (
              <div>
                <span className="font-medium text-foreground">run started</span>
                {' '}by <span className="font-mono">{eventsAtTick.current.agent}</span>
                {' '}<span className="text-muted font-mono">...{eventsAtTick.current.runId.slice(-6)}</span>
              </div>
            )}
            {eventsAtTick.current.kind === 'run_end' && (
              <div>
                <span className="font-medium text-foreground">
                  run {eventsAtTick.current.result ?? 'ended'}
                </span>
                {' '}by <span className="font-mono">{eventsAtTick.current.agent}</span>
                {' '}<span className="text-muted font-mono">...{eventsAtTick.current.runId.slice(-6)}</span>
              </div>
            )}
          </div>

          {eventsAtTick.envelope && (
            <div className="border border-border rounded p-2 bg-background" data-testid="envelope-snapshot">
              <div className="text-muted mb-1">
                Envelope state at this tick (v{eventsAtTick.envelope.version}):
              </div>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(eventsAtTick.envelope.envelope, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
