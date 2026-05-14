/**
 * LM-88 / RL-U6-05 — Ancestor/Descendant 네비게이션.
 *
 * Two stacked panels in the task detail header:
 *   1. Breadcrumb — root → ... → parent → current. Each ancestor is a
 *      button that opens that task in the side panel via `onSelectTask`.
 *      Daemon `GET /tasks/:id/ancestors` returns parents in farthest-
 *      first order (root last) — we reverse the chain so the leftmost
 *      crumb is the root and the rightmost is the immediate parent.
 *   2. Children — direct descendants only (depth=1). Same click target
 *      so the user can drill in/out without leaving the side panel.
 *
 * The component is intentionally self-fetching: TaskDetail's `load()`
 * already makes 6 parallel calls and we don't want to bloat that
 * request graph for a sidebar widget. A separate state object also
 * makes the loading/error envelope local to the breadcrumb.
 */
import { useEffect, useState } from 'react';
import api from '../api';
import type { Task, TaskTreeNode } from '../types';
import StatusBadge from './StatusBadge';

interface TaskBreadcrumbProps {
  /** Currently-displayed task. We render its title/ticket as the
   *  trailing crumb without an extra fetch — the caller already has
   *  the Task object loaded. */
  task: Task;
  /** Click target for any ancestor or child. Must navigate to the
   *  given task in the same surface (side panel). */
  onSelectTask?: (taskId: string) => void;
}

interface FetchState {
  taskId: string;
  ancestors: TaskTreeNode[] | null;
  children: TaskTreeNode[] | null;
  error: string | null;
}

export default function TaskBreadcrumb({ task, onSelectTask }: TaskBreadcrumbProps) {
  const [state, setState] = useState<FetchState>({
    taskId: task.id,
    ancestors: null,
    children: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getTaskAncestors(task.id, { depth: 64, include_envelope: false }),
      api.getTaskDescendants(task.id, { depth: 1, include_envelope: false }),
    ])
      .then(([ancestors, children]) => {
        if (cancelled) return;
        setState({ taskId: task.id, ancestors, children, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          taskId: task.id,
          ancestors: null,
          children: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const isLoading =
    state.taskId !== task.id ||
    (state.ancestors === null && state.children === null && state.error === null);

  if (isLoading) {
    return (
      <div className="text-xs text-muted py-1" aria-busy="true">
        Loading navigation...
      </div>
    );
  }

  if (state.error) {
    return (
      <div role="alert" className="text-xs text-danger py-1">
        Failed to load navigation: {state.error}
      </div>
    );
  }

  // Daemon returns ancestors farthest-first (root last). Reverse so
  // the leftmost crumb is the root and the rightmost is the immediate
  // parent — what users expect from a breadcrumb trail.
  const ancestors = (state.ancestors ?? []).slice().reverse();
  const children = state.children ?? [];

  return (
    <div className="space-y-2" aria-label="task-navigation">
      <nav aria-label="breadcrumb" className="text-xs">
        <ol className="flex items-center gap-1 flex-wrap">
          {ancestors.length === 0 ? (
            <li className="text-muted italic" data-testid="breadcrumb-root-marker">
              root task
            </li>
          ) : (
            ancestors.map((a) => (
              <li key={a.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectTask?.(a.id)}
                  className="text-primary hover:underline truncate max-w-[12rem]"
                  data-task-id={a.id}
                  title={a.title}
                >
                  {a.ticket_number ? (
                    <span className="font-mono">{a.ticket_number}</span>
                  ) : (
                    <span>...{a.id.slice(-6)}</span>
                  )}
                  <span className="ml-1 text-foreground">{a.title}</span>
                </button>
                <span aria-hidden className="text-muted">/</span>
              </li>
            ))
          )}
          <li
            className="flex items-center gap-1 text-foreground font-medium truncate"
            aria-current="page"
            data-testid="breadcrumb-current"
          >
            {task.ticket_number && (
              <span className="font-mono text-primary">{task.ticket_number}</span>
            )}
            <span>{task.title}</span>
          </li>
        </ol>
      </nav>

      {children.length > 0 && (
        <div aria-label="children-panel">
          <div className="text-xs text-muted mb-1">
            {children.length} direct child{children.length === 1 ? '' : 'ren'}
          </div>
          <ul className="space-y-0.5">
            {children.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectTask?.(c.id)}
                  className="w-full flex items-center gap-2 text-left text-xs px-2 py-1 rounded hover:bg-primary/5 border border-transparent hover:border-primary/30"
                  data-task-id={c.id}
                >
                  {c.ticket_number ? (
                    <span className="font-mono text-muted shrink-0">{c.ticket_number}</span>
                  ) : (
                    <span className="font-mono text-muted shrink-0">...{c.id.slice(-6)}</span>
                  )}
                  <span className="flex-1 truncate text-foreground">{c.title}</span>
                  <StatusBadge status={c.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
