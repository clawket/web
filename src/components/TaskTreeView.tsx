/**
 * LM-152 / RL-U6-03 — Task tree visualization.
 *
 * Renders the parent → child decomposition tree rooted at `taskId`.
 * Daemon `GET /tasks/:id/subtree` returns nodes pre-flattened with
 * `depth` so layout is purely a parent-id grouping pass — no client-
 * side DAG library needed.
 *
 * Why no react-flow / dagre: the only interaction in the success
 * criteria is "click → detail". Pan/zoom/drag aren't required at this
 * stage (RL-U6-04 will introduce drag-drop with the existing dnd-kit
 * dep). Skipping a 80kb graph library keeps the dashboard bundle lean
 * and the jsdom test surface trivial. If a future view needs spatial
 * layout, this component can be replaced without breaking its API
 * (taskId in, onSelectTask out).
 */
import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { ENVELOPE_FIELDS, type EnvelopeJson, type Task, type TaskTreeNode } from '../types';
import StatusBadge from './StatusBadge';

interface TaskTreeViewProps {
  /** Root task whose subtree is rendered. The root is always shown. */
  taskId: string;
  /** Click target for any node — wired by the parent into the side
   *  panel route, mirroring PlanTree's contract. */
  onSelectTask?: (taskId: string) => void;
  /** Currently-selected task ID — used to highlight the active row. */
  selectedTaskId?: string;
  /** Daemon depth cap. Defaults to 3 per the LM-152 success criteria
   *  ("3-depth 트리 렌더링"). The wire format guarantees `depth` on
   *  every node so the renderer doesn't recompute it. */
  maxDepth?: number;
}

interface TreeNodeWithChildren extends TaskTreeNode {
  children: TreeNodeWithChildren[];
}

/** Group flat subtree nodes into a parent → children map keyed by
 *  `parent_task_id`. The root is detected as the one node without a
 *  parent inside the result set (the daemon's pre-order guarantees the
 *  root is index 0, but we don't rely on that — fall back to the first
 *  node so a future BFS traversal still works). */
function buildTree(nodes: TaskTreeNode[]): TreeNodeWithChildren | null {
  if (nodes.length === 0) return null;
  const idToNode = new Map<string, TreeNodeWithChildren>();
  for (const n of nodes) idToNode.set(n.id, { ...n, children: [] });
  const ids = new Set(idToNode.keys());

  let root: TreeNodeWithChildren | null = null;
  for (const node of idToNode.values()) {
    const parentId = node.parent_task_id;
    if (parentId && ids.has(parentId)) {
      idToNode.get(parentId)!.children.push(node);
    } else {
      // First parentless node wins — same task can't be a root twice
      // because the daemon already enforced subtree-from-id semantics.
      root = root ?? node;
    }
  }
  if (!root) root = idToNode.get(nodes[0].id) ?? null;

  // Stable child order: by `idx` then `id` to mirror the backlog
  // sort users see elsewhere.
  const sortRecursive = (n: TreeNodeWithChildren) => {
    n.children.sort((a, b) => a.idx - b.idx || a.id.localeCompare(b.id));
    n.children.forEach(sortRecursive);
  };
  if (root) sortRecursive(root);
  return root;
}

/** Envelope completeness — fraction of canonical ADR-0001 fields the
 *  resolved envelope has populated. `planned_sha` and `version` are
 *  auto-stamped by the daemon, but counting them is consistent with
 *  how the form surfaces them; the badge is meant as a coarse signal,
 *  not a contract score. */
function envelopeCompleteness(envelope?: EnvelopeJson): { filled: number; total: number } {
  const total = ENVELOPE_FIELDS.length;
  if (!envelope) return { filled: 0, total };
  let filled = 0;
  for (const field of ENVELOPE_FIELDS) {
    const v = envelope[field];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    filled++;
  }
  return { filled, total };
}

const STATUS_DOT: Record<Task['status'], string> = {
  todo: 'bg-muted',
  in_progress: 'bg-warning',
  done: 'bg-success',
  blocked: 'bg-danger',
  cancelled: 'bg-muted',
};

interface FetchState {
  taskId: string;
  nodes: TaskTreeNode[] | null;
  error: string | null;
}

export default function TaskTreeView({
  taskId,
  onSelectTask,
  selectedTaskId,
  maxDepth = 3,
}: TaskTreeViewProps) {
  // Single state object keyed by taskId so changing the prop puts us
  // back into the loading branch without a synchronous setState in
  // the effect (react-hooks/set-state-in-effect). When `state.taskId`
  // and the current `taskId` prop diverge, we render "Loading..."
  // until the in-flight fetch reconciles them.
  const [state, setState] = useState<FetchState>({ taskId, nodes: null, error: null });

  useEffect(() => {
    let cancelled = false;
    api
      .getTaskSubtree(taskId, { depth: maxDepth, include_envelope: true })
      .then((result) => {
        if (cancelled) return;
        setState({ taskId, nodes: result, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ taskId, nodes: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, maxDepth]);

  const isLoading = state.taskId !== taskId || (state.nodes === null && state.error === null);
  const tree = useMemo(
    () => (!isLoading && state.nodes ? buildTree(state.nodes) : null),
    [isLoading, state.nodes],
  );

  if (state.taskId === taskId && state.error) {
    return (
      <div role="alert" className="text-xs text-danger py-2">
        Failed to load tree: {state.error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-xs text-muted py-2" aria-busy="true">
        Loading tree...
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="text-xs text-muted py-2">
        Task has no children to visualize.
      </div>
    );
  }

  return (
    <div className="text-sm" role="tree" aria-label="task-tree">
      <TreeRow
        node={tree}
        onSelectTask={onSelectTask}
        selectedTaskId={selectedTaskId}
      />
    </div>
  );
}

interface TreeRowProps {
  node: TreeNodeWithChildren;
  onSelectTask?: (id: string) => void;
  selectedTaskId?: string;
}

function TreeRow({ node, onSelectTask, selectedTaskId }: TreeRowProps) {
  const isSelected = selectedTaskId === node.id;
  const completeness = envelopeCompleteness(node.resolved_envelope);
  const completenessClass =
    completeness.filled === completeness.total
      ? 'bg-success/15 text-success'
      : completeness.filled === 0
        ? 'bg-border/50 text-muted'
        : 'bg-warning/15 text-warning';

  return (
    <div role="treeitem" aria-selected={isSelected} aria-level={node.depth + 1}>
      <button
        type="button"
        onClick={() => onSelectTask?.(node.id)}
        data-task-id={node.id}
        data-depth={node.depth}
        className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover transition-colors ${
          isSelected ? 'bg-primary/10' : ''
        }`}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[node.status]}`}
          title={node.status}
          aria-hidden
        />
        <span className="text-xs text-muted font-mono shrink-0" title={node.id}>
          {node.ticket_number ?? `...${node.id.slice(-6)}`}
        </span>
        <span className="text-foreground truncate flex-1">{node.title}</span>
        <StatusBadge status={node.status} />
        <span
          className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${completenessClass}`}
          title={`Envelope: ${completeness.filled} of ${completeness.total} fields filled`}
          data-testid={`envelope-completeness-${node.id}`}
        >
          {completeness.filled}/{completeness.total}
        </span>
      </button>
      {node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              onSelectTask={onSelectTask}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
