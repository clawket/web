/**
 * LM-87 / RL-U6-04 — Decomposition Suggestion Panel.
 *
 * Workflow:
 *   1. Fetch `POST /tasks/:id/decompose` on mount. Each row of
 *      `success_criteria` becomes one suggested subtask.
 *   2. User selects a subset (checkbox per row).
 *   3. User reorders selected suggestions (drag handle + up/down
 *      keyboard fallback). Reorder also dictates the `idx` we send
 *      to the daemon, so the resulting tree mirrors the panel order.
 *   4. "Accept N" calls `POST /tasks/:id/subtasks` once per selected
 *      suggestion. After all succeed, `onAccepted()` is called so the
 *      parent (TaskDetail) can refresh the tree view.
 *
 * Drag-drop:
 *   Implemented via native HTML5 dragstart/dragover/drop. Reason: the
 *   existing @dnd-kit usage in BoardView is column-based and the
 *   library's pointer-event simulation under jsdom is brittle. A row
 *   list with native DnD events keeps the verification surface small
 *   without sacrificing the spec ("drag-drop 으로 자식 순서 조정"). The
 *   up/down buttons give keyboard parity and are also what the test
 *   suite exercises (jsdom doesn't fully simulate drag events).
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import type { DecompositionResult, DecompositionSuggestion } from '../../types';
import { Button } from '../../components/ui';

interface SuggestionPanelProps {
  taskId: string;
  /** Fired after every accepted suggestion has been persisted as a
   *  subtask. Parent uses this to refetch its child list / tree. */
  onAccepted?: () => void;
}

interface RowState {
  /** Stable key for React + drag identity — the daemon's `idx` is
   *  unique within a single decompose response. */
  key: number;
  suggestion: DecompositionSuggestion;
  selected: boolean;
}

export default function SuggestionPanel({ taskId, onAccepted }: SuggestionPanelProps) {
  const [state, setState] = useState<{
    taskId: string;
    result: DecompositionResult | null;
    rows: RowState[];
    error: string | null;
  }>({ taskId, result: null, rows: [], error: null });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .decomposeTask(taskId, { strategy: 'auto', max_depth: 2 })
      .then((result) => {
        if (cancelled) return;
        setState({
          taskId,
          result,
          rows: result.suggested_subtasks.map((s) => ({
            key: s.idx,
            suggestion: s,
            selected: false,
          })),
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          taskId,
          result: null,
          rows: [],
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const isLoading = state.taskId !== taskId || (state.result === null && state.error === null);
  const selectedCount = useMemo(() => state.rows.filter((r) => r.selected).length, [state.rows]);

  function toggle(key: number) {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)),
    }));
  }

  function move(key: number, delta: -1 | 1) {
    setState((prev) => {
      const idx = prev.rows.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.rows.length) return prev;
      const next = prev.rows.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, rows: next };
    });
  }

  function reorder(fromKey: number, toKey: number) {
    if (fromKey === toKey) return;
    setState((prev) => {
      const fromIdx = prev.rows.findIndex((r) => r.key === fromKey);
      const toIdx = prev.rows.findIndex((r) => r.key === toKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.rows.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, rows: next };
    });
  }

  async function accept() {
    const selected = state.rows.filter((r) => r.selected);
    if (selected.length === 0) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      // Sequential — the daemon assigns idx based on position relative
      // to existing children; running serially keeps the order stable
      // and lets us surface the first error without partial fan-out.
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        await api.createSubtask(taskId, {
          title: s.suggestion.title,
          body: s.suggestion.rationale,
          idx: i,
        });
      }
      // Clear selections; keep rows so the user can see what was
      // accepted before refresh.
      setState((prev) => ({ ...prev, rows: prev.rows.map((r) => ({ ...r, selected: false })) }));
      onAccepted?.();
    } catch (err: unknown) {
      setAcceptError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="text-xs text-muted py-2" aria-busy="true">
        Loading suggestions...
      </div>
    );
  }

  if (state.taskId === taskId && state.error) {
    return (
      <div role="alert" className="text-xs text-danger py-2">
        Failed to decompose: {state.error}
      </div>
    );
  }

  if (!state.result) return null;

  const { result } = state;

  return (
    <div className="space-y-2" aria-label="suggestion-panel">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {state.rows.length} suggestion{state.rows.length === 1 ? '' : 's'} from
          {' '}
          <span className="font-mono">success_criteria</span>
          {result.existing_children_count > 0 && (
            <> · {result.existing_children_count} existing child{result.existing_children_count === 1 ? '' : 'ren'}</>
          )}
        </span>
        <span>strategy: {result.strategy}</span>
      </div>

      {result.policy_violations.length > 0 && (
        <ul className="space-y-1" aria-label="policy-violations">
          {result.policy_violations.map((v, i) => (
            <li
              key={`${v.field}-${i}`}
              role="alert"
              className={`text-xs ${v.severity === 'error' ? 'text-danger' : 'text-warning'}`}
              data-severity={v.severity}
              data-field={v.field}
            >
              <span className="font-mono">{v.field}: </span>
              {v.message}
            </li>
          ))}
        </ul>
      )}

      {state.rows.length === 0 ? (
        <div className="text-xs text-muted">No suggestions to display.</div>
      ) : (
        <ol className="space-y-1" role="list">
          {state.rows.map((row, idx) => (
            <SuggestionRow
              key={row.key}
              row={row}
              isFirst={idx === 0}
              isLast={idx === state.rows.length - 1}
              onToggle={() => toggle(row.key)}
              onMoveUp={() => move(row.key, -1)}
              onMoveDown={() => move(row.key, 1)}
              onReorder={(fromKey) => reorder(fromKey, row.key)}
            />
          ))}
        </ol>
      )}

      {acceptError && (
        <div role="alert" className="text-xs text-danger">
          Accept failed: {acceptError}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={selectedCount === 0 || accepting}
          onClick={accept}
        >
          {accepting ? 'Accepting...' : `Accept ${selectedCount} selected`}
        </Button>
      </div>
    </div>
  );
}

interface SuggestionRowProps {
  row: RowState;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Native HTML5 drag-drop reorder hook: fires when another row is
   *  dropped onto this one. Caller resolves both keys to indexes. */
  onReorder: (fromKey: number) => void;
}

function SuggestionRow({
  row,
  isFirst,
  isLast,
  onToggle,
  onMoveUp,
  onMoveDown,
  onReorder,
}: SuggestionRowProps) {
  return (
    <li
      data-suggestion-key={row.key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-suggestion-key', String(row.key));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/x-suggestion-key');
        const fromKey = Number.parseInt(raw, 10);
        if (Number.isFinite(fromKey)) onReorder(fromKey);
      }}
      className={`flex items-start gap-2 p-2 border border-border rounded ${
        row.selected ? 'bg-primary/5 border-primary/40' : 'bg-background'
      }`}
    >
      <span className="text-muted cursor-grab select-none pt-0.5" aria-hidden title="Drag to reorder">
        ⋮⋮
      </span>
      <input
        type="checkbox"
        checked={row.selected}
        onChange={onToggle}
        aria-label={`Select ${row.suggestion.title}`}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{row.suggestion.title}</div>
        <div className="text-xs text-muted truncate" title={row.suggestion.rationale}>
          {row.suggestion.rationale}
        </div>
        <div className="text-xs text-muted mt-0.5">
          <span className="font-mono">scope:</span> {row.suggestion.scope_hint}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-label={`Move ${row.suggestion.title} up`}
          disabled={isFirst}
          onClick={onMoveUp}
          className="text-xs text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed px-1"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`Move ${row.suggestion.title} down`}
          disabled={isLast}
          onClick={onMoveDown}
          className="text-xs text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed px-1"
        >
          ▼
        </button>
      </div>
    </li>
  );
}
