/**
 * LM-90 / RL-U6-07 — Run diff view.
 *
 * Lists every run for a task and lets the user pick exactly two to
 * compare side-by-side. The diff surface for a single run is purely
 * what lives on the Run record:
 *   - agent (model proxy)
 *   - duration_ms (ended_at - started_at, or `running` if still live)
 *   - result string
 *   - changed_files set (parsed from notes if the agent persisted a
 *     JSON blob with a `changed_files` array — see below)
 *
 * Why "agent" stands in for `target_model`: the daemon's Run schema
 * carries `agent` as the only model identifier; the envelope's
 * `target_model` field is task-level, not per-run, so two runs of the
 * same task share the same envelope target_model unless the envelope
 * was edited between them. We surface both:
 *   - `agent` directly for each run
 *   - the envelope `target_model` active at run start (resolved from
 *     EnvelopeHistory by `started_at`), so the user sees model drift
 *     across envelope versions even when the agent identifier is the
 *     same string.
 *
 * Why parse notes for changed_files: existing runs are populated by
 * Claude hooks that store a JSON blob in `notes` containing the file
 * edits captured via PostToolUse. There's no separate column for
 * structured run output; the parser here is defensive — anything not
 * parseable falls through as "no changed files reported".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { useRunEvents } from '../../hooks/useRunEvents';
import type { EnvelopeHistoryEntry, Run } from '../../types';

interface RunCompareProps {
  taskId: string;
}

interface FetchState {
  taskId: string;
  runs: Run[] | null;
  history: EnvelopeHistoryEntry[] | null;
  error: string | null;
}

/** Best-effort parse of `notes` to find an array of relative paths.
 *  The hook adapter writes JSON like `{ "changed_files": ["a.rs", ...] }`;
 *  older or hand-edited runs may have plain text — those return []. */
function parseChangedFiles(notes: string | null): string[] {
  if (!notes) return [];
  try {
    const obj = JSON.parse(notes) as unknown;
    if (
      obj &&
      typeof obj === 'object' &&
      'changed_files' in obj &&
      Array.isArray((obj as { changed_files: unknown }).changed_files)
    ) {
      return (obj as { changed_files: unknown[] }).changed_files.filter(
        (f): f is string => typeof f === 'string',
      );
    }
  } catch {
    // not JSON — treat as opaque notes.
  }
  return [];
}

/** Envelope `target_model` active at the moment `at` (run start).
 *  Walks the history (newest-first by `created_at` from the daemon)
 *  for the latest entry signed at-or-before `at`. */
function targetModelAt(history: EnvelopeHistoryEntry[], at: number): string | null {
  // Daemon returns newest-first. Find the first entry whose
  // created_at <= at — that's the envelope active at run-start.
  for (const entry of history) {
    if (entry.created_at <= at) {
      const model = entry.envelope['target_model'];
      return typeof model === 'string' ? model : null;
    }
  }
  return null;
}

function formatDuration(run: Run): string {
  if (run.ended_at == null) return 'running';
  const ms = run.ended_at - run.started_at;
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s.toFixed(1)} s`;
}

export default function RunCompare({ taskId }: RunCompareProps) {
  const [state, setState] = useState<FetchState>({
    taskId,
    runs: null,
    history: null,
    error: null,
  });
  const [selected, setSelected] = useState<string[]>([]);
  // LM-92: bumped by useRunEvents when the daemon broadcasts a
  // run:created / run:updated for this task. The effect below
  // re-fetches the run list and envelope history so badges/diff
  // stay live without polling.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listRuns({ task_id: taskId }), api.getEnvelopeHistory(taskId).catch(() => [] as EnvelopeHistoryEntry[])])
      .then(([runs, history]) => {
        if (cancelled) return;
        setState({ taskId, runs, history, error: null });
        if (refreshTick === 0) setSelected([]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          taskId,
          runs: null,
          history: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshTick]);

  const onRunEvent = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);
  useRunEvents({ taskId, onEvent: onRunEvent });

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Cap at 2 — selecting a third evicts the oldest.
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const isLoading =
    state.taskId !== taskId || (state.runs === null && state.error === null);

  const pair = useMemo(() => {
    if (!state.runs || selected.length !== 2) return null;
    const [a, b] = selected.map((id) => state.runs!.find((r) => r.id === id));
    if (!a || !b) return null;
    return { a, b };
  }, [state.runs, selected]);

  const diff = useMemo(() => {
    if (!pair) return null;
    const filesA = new Set(parseChangedFiles(pair.a.notes));
    const filesB = new Set(parseChangedFiles(pair.b.notes));
    const onlyA = [...filesA].filter((f) => !filesB.has(f)).sort();
    const onlyB = [...filesB].filter((f) => !filesA.has(f)).sort();
    const common = [...filesA].filter((f) => filesB.has(f)).sort();
    return { filesA, filesB, onlyA, onlyB, common };
  }, [pair]);

  if (isLoading) {
    return (
      <div className="text-xs text-muted py-2" aria-busy="true">
        Loading runs...
      </div>
    );
  }

  if (state.error) {
    return (
      <div role="alert" className="text-xs text-danger py-2">
        Failed to load runs: {state.error}
      </div>
    );
  }

  const runs = state.runs ?? [];
  if (runs.length < 2) {
    return (
      <div className="text-xs text-muted py-2">
        Need at least 2 runs on this task to compare. Currently {runs.length}.
      </div>
    );
  }

  const history = state.history ?? [];

  return (
    <div className="space-y-2" aria-label="run-compare">
      <div className="text-xs text-muted">
        Select 2 runs to diff ({selected.length}/2 selected)
      </div>
      <ul className="space-y-1" aria-label="run-list">
        {runs.map((r) => {
          const checked = selected.includes(r.id);
          return (
            <li key={r.id}>
              <label
                className={`flex items-center gap-2 p-1.5 border rounded text-xs cursor-pointer ${
                  checked ? 'border-primary bg-primary/5' : 'border-border bg-background'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(r.id)}
                  aria-label={`Select run ${r.id}`}
                />
                <span className="font-mono text-muted shrink-0">...{r.id.slice(-6)}</span>
                <span className="text-foreground shrink-0">{r.agent}</span>
                <span className="text-muted">{formatDuration(r)}</span>
                <span className="text-muted truncate">{r.result ?? (r.ended_at == null ? '(running)' : '(no result)')}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {pair && diff && (
        <div
          className="grid grid-cols-2 gap-2 text-xs"
          aria-label="run-diff"
          data-run-a={pair.a.id}
          data-run-b={pair.b.id}
        >
          {([
            { side: 'a' as const, run: pair.a, only: diff.onlyA },
            { side: 'b' as const, run: pair.b, only: diff.onlyB },
          ]).map(({ side, run, only }) => (
            <div
              key={side}
              className="border border-border rounded p-2 bg-background space-y-1"
              data-testid={`run-panel-${side}`}
            >
              <div className="font-mono text-muted">...{run.id.slice(-6)}</div>
              <div>
                <span className="text-muted">agent:</span>{' '}
                <span className="font-mono">{run.agent}</span>
              </div>
              <div>
                <span className="text-muted">target_model:</span>{' '}
                <span className="font-mono">
                  {targetModelAt(history, run.started_at) ?? '—'}
                </span>
              </div>
              <div>
                <span className="text-muted">duration:</span> {formatDuration(run)}
              </div>
              <div>
                <span className="text-muted">result:</span>{' '}
                <span>{run.result ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted">only-this-side files ({only.length}):</span>
                {only.length === 0 ? (
                  <span className="ml-1 text-muted italic">none</span>
                ) : (
                  <ul className="ml-2 list-disc">
                    {only.map((f) => (
                      <li key={f} className="font-mono">{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          <div
            className="col-span-2 border border-border rounded p-2 bg-background"
            data-testid="run-diff-common"
          >
            <span className="text-muted">files in both ({diff.common.length}):</span>
            {diff.common.length === 0 ? (
              <span className="ml-1 text-muted italic">none</span>
            ) : (
              <ul className="ml-2 list-disc">
                {diff.common.map((f) => (
                  <li key={f} className="font-mono">{f}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
