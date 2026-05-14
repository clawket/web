import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Task, Artifact, Run, Question, TaskComment, Cycle } from '../types';
import api from '../api';
import { Label, Input, Select, Button } from './ui';
import { TaskComments } from './task-detail/TaskComments';
import { TaskSubTasks } from './task-detail/TaskSubTasks';
import { ArtifactsSection, RunsSection, QuestionsSection } from './task-detail/TaskSections';
import EnvelopeForm from './EnvelopeForm';
import TaskTreeView from './TaskTreeView';
import TaskBreadcrumb from './TaskBreadcrumb';
import SuggestionPanel from '../features/decomposition/SuggestionPanel';
import TimelineReplay from '../features/timeline/TimelineReplay';
import RunCompare from '../features/runs/RunCompare';

/** US-CKT-SCHEMA-014 — file:line evidence source-link pattern.
 *  Matches strings like `src/foo/bar.ts:42` or `daemon/routes.rs:100`.
 *  The scheme is intentionally kept simple: no spaces, only word chars,
 *  dots, slashes, hyphens, followed by a colon and a decimal line number. */
const FILE_LINE_RE = /^[\w./-]+:\d+$/;

/** Renders an evidence string. When it matches the file:line pattern it is
 *  wrapped in an `<a>` tag styled as a source reference; otherwise it renders
 *  as plain monospace text. NULL / undefined renders an em-dash. */
function EvidenceValue({ value }: { value: string | null | undefined }) {
  if (value == null) return <span className="text-muted">—</span>;
  if (FILE_LINE_RE.test(value)) {
    return (
      <a
        href={`#evidence:${value}`}
        className="text-primary font-mono hover:underline"
        title={`source: ${value}`}
      >
        {value}
      </a>
    );
  }
  return <span className="text-foreground font-mono break-all">{value}</span>;
}

/** US-CKT-SCHEMA-025 — link from a task's batch_id to other tasks sharing it.
 *  Renders the batch_id as a clickable link plus an inline count badge of
 *  sibling tasks. Clicking opens an inline list which when expanded lets
 *  the user jump to any sibling task via onSelectTask. */
function BatchSiblingsLink({
  batchId,
  currentTaskId,
  onSelectTask,
}: {
  batchId: string;
  currentTaskId: string;
  onSelectTask?: (id: string) => void;
}) {
  const [siblings, setSiblings] = useState<Task[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .listTasks({ batch_id: batchId })
      .then((rows) => {
        if (!cancelled) setSiblings(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(String((e as Error).message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);
  const others = (siblings ?? []).filter((t) => t.id !== currentTaskId);
  return (
    <span className="flex items-baseline gap-2 flex-wrap">
      <span className="text-foreground font-mono">{batchId}</span>
      {error ? (
        <span className="text-danger text-[10px]">batch lookup failed</span>
      ) : siblings == null ? (
        <span className="text-muted text-[10px]">…</span>
      ) : others.length === 0 ? (
        <span className="text-muted text-[10px]">no siblings</span>
      ) : (
        <button
          type="button"
          className="text-primary text-[11px] hover:underline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'hide' : 'show'} {others.length} task{others.length === 1 ? '' : 's'} in batch
        </button>
      )}
      {expanded && others.length > 0 && (
        <ul className="basis-full mt-1 ml-26 text-[11px] flex flex-col gap-0.5">
          {others.map((t) => (
            <li key={t.id} className="font-mono">
              <button
                type="button"
                className="text-primary hover:underline text-left"
                onClick={() => onSelectTask?.(t.id)}
                title={t.title}
              >
                {t.id.slice(-10)} — {t.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

const PRIORITY_COLORS: Record<Task['priority'], string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-warning/20 text-warning',
  medium: 'bg-primary/20 text-primary',
  low: 'bg-muted/20 text-muted',
};

interface TaskDetailProps {
  taskId: string;
  projectId?: string;
  onClose: () => void;
  /** Open a different task in the side panel — wired by App for the
   *  TaskTreeView's click-to-navigate behavior. */
  onSelectTask?: (id: string) => void;
}

const STATUS_OPTIONS: Task['status'][] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];

export default function TaskDetail({ taskId, projectId, onClose, onSelectTask }: TaskDetailProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [childTasks, setChildTasks] = useState<Task[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, r, q, c, ch] = await Promise.all([
        api.getTask(taskId),
        api.listArtifacts({ task_id: taskId }),
        api.listRuns({ task_id: taskId }),
        api.listQuestions({ task_id: taskId }),
        api.fetchTaskComments(taskId).catch((e) => { console.error('Failed to load comments:', e); return [] as TaskComment[]; }),
        api.listChildTasks(taskId).catch(() => [] as Task[]),
      ]);
      setTask(s);
      setArtifacts(a);
      setRuns(r);
      setQuestions(q);
      setComments(c);
      setChildTasks(ch);
    } catch (err) {
      console.error('Failed to load task:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!projectId) return;
    api.listCycles({ project_id: projectId }).then(setCycles).catch(() => setCycles([]));
  }, [projectId]);

  async function handleCycleChange(cycleId: string) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { cycle_id: cycleId || null });
      setTask(updated);
    } catch (err) {
      console.error('Failed to update cycle assignment:', err);
    }
  }

  async function handleStatusChange(status: Task['status']) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { status });
      setTask(updated);
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleTitleSave() {
    if (!task || !titleDraft.trim()) return;
    try {
      const updated = await api.updateTask(task.id, { title: titleDraft.trim() });
      setTask(updated);
      setEditingTitle(false);
    } catch (err) {
      console.error('Failed to update title:', err);
    }
  }

  async function handleAssigneeSave() {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { assignee: assigneeDraft.trim() || undefined });
      setTask(updated);
      setEditingAssignee(false);
    } catch (err) {
      console.error('Failed to update assignee:', err);
    }
  }

  async function handleDeleteTask() {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await api.deleteTask(taskId);
      onClose();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  function formatTime(ts: number | string | null | undefined) {
    if (ts == null || ts === '') return '\u2014';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '\u2014';
    return d.toLocaleString();
  }

  if (loading || !task) {
    return (
      <div className="w-full bg-surface flex items-center justify-center text-muted text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="w-full bg-surface flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs text-muted font-mono" title={task.id}>...{task.id.slice(-6)}</span>
        <div className="flex items-center gap-2">
          <Button variant="danger" size="sm" onClick={handleDeleteTask}>Delete</Button>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">&times;</button>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* LM-88 — breadcrumb + children navigation */}
        <TaskBreadcrumb task={task} onSelectTask={onSelectTask} />

        {/* Title */}
        <div>
          {editingTitle ? (
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false); }}
              className="w-full text-lg font-semibold"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {task.ticket_number && (
                <span className="text-xs font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded shrink-0">
                  {task.ticket_number}
                </span>
              )}
              <h2
                className="text-lg font-semibold text-foreground cursor-pointer hover:text-primary transition-colors"
                onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
              >
                {task.title}
              </h2>
            </div>
          )}
          {/* Priority + Complexity badges */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority]}`}>
              {task.priority}
            </span>
            {task.complexity && (
              <span className="text-xs bg-secondary/20 text-secondary px-1.5 py-0.5 rounded font-medium">
                {task.complexity}
              </span>
            )}
            {task.estimated_edits != null && (
              <span className="text-xs text-muted">
                ~{task.estimated_edits} edits
              </span>
            )}
          </div>
        </div>

        {/* Status + Assignee + Cycle row */}
        <div className="flex gap-4">
          <div className="flex-1">
            <Label>Status</Label>
            <Select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value as Task['status'])}
              size="sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex-1">
            <Label>Assignee</Label>
            {editingAssignee ? (
              <Input
                value={assigneeDraft}
                onChange={(e) => setAssigneeDraft(e.target.value)}
                onBlur={handleAssigneeSave}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAssigneeSave(); if (e.key === 'Escape') setEditingAssignee(false); }}
                placeholder="Unassigned"
                size="sm"
                autoFocus
              />
            ) : (
              <div
                onClick={() => { setAssigneeDraft(task.assignee ?? ''); setEditingAssignee(true); }}
                className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm cursor-pointer hover:border-primary transition-colors min-h-[34px]"
              >
                {task.assignee ? (
                  <span className="text-foreground">{task.assignee}</span>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </div>
            )}
          </div>
          <div className="flex-1">
            <Label>Cycle</Label>
            {cycles.length > 0 ? (
              <Select
                value={task.cycle_id ?? ''}
                onChange={(e) => handleCycleChange(e.target.value)}
                size="sm"
              >
                <option value="">Unassigned</option>
                {cycles.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.idx} {b.title}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-muted min-h-[34px]">
                {task.cycle_id ? (
                  <span className="text-foreground font-mono text-xs">...{task.cycle_id.slice(-6)}</span>
                ) : (
                  <span>Unassigned</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted">Created:</span> <span className="text-foreground">{formatTime(task.created_at)}</span></div>
          <div><span className="text-muted">Started:</span> <span className="text-foreground">{formatTime(task.started_at)}</span></div>
          <div><span className="text-muted">Completed:</span> <span className="text-foreground">{formatTime(task.completed_at)}</span></div>
        </div>

        {/* PDD v3.0 metadata — scenario_id / evidence / batch_id (always rendered, em-dash for null) */}
        <div className="grid grid-cols-1 gap-1.5 text-xs border border-border/50 rounded px-3 py-2 bg-background/50">
          <div className="flex items-baseline gap-2">
            <span className="text-muted shrink-0 w-24">Scenario ID:</span>
            <span className="text-foreground font-mono">
              {task.scenario_id ?? '—'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted shrink-0 w-24">Evidence:</span>
            <EvidenceValue value={task.evidence} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted shrink-0 w-24">Batch ID:</span>
            {task.batch_id ? (
              <BatchSiblingsLink
                batchId={task.batch_id}
                currentTaskId={task.id}
                onSelectTask={onSelectTask}
              />
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </div>

        {/* Dependencies */}
        {(task.depends_on || []).length > 0 && (
          <div>
            <Label>Dependencies</Label>
            <div className="flex flex-wrap gap-1.5">
              {(task.depends_on || []).map((dep) => (
                <span key={dep} className="text-xs font-mono bg-border/50 text-muted px-2 py-0.5 rounded" title={dep}>
                  ...{dep.slice(-6)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div>
          <Label>Body</Label>
          <div className="bg-background border border-border rounded p-3 text-sm leading-relaxed max-h-80 overflow-y-auto prose prose-sm max-w-none">
            {task.body ? (
              <Markdown remarkPlugins={[remarkGfm]}>{task.body}</Markdown>
            ) : (
              <span className="text-muted italic">No content</span>
            )}
          </div>
        </div>

        <div>
          <Label>Envelope</Label>
          <div className="bg-background border border-border rounded p-3">
            <EnvelopeForm taskId={task.id} />
          </div>
        </div>

        {childTasks.length > 0 && (
          <div>
            <Label>Decomposition tree</Label>
            <div className="bg-background border border-border rounded p-2">
              <TaskTreeView taskId={task.id} selectedTaskId={task.id} onSelectTask={onSelectTask} />
            </div>
          </div>
        )}

        <div>
          <Label>Decomposition suggestions</Label>
          <div className="bg-background border border-border rounded p-2">
            <SuggestionPanel taskId={task.id} onAccepted={load} />
          </div>
        </div>

        <div>
          <Label>Timeline replay</Label>
          <div className="bg-background border border-border rounded p-2">
            <TimelineReplay taskId={task.id} />
          </div>
        </div>

        <div>
          <Label>Run diff</Label>
          <div className="bg-background border border-border rounded p-2">
            <RunCompare taskId={task.id} />
          </div>
        </div>

        <TaskSubTasks task={task} childTasks={childTasks} onChildCreated={(child) => setChildTasks(prev => [...prev, child])} />
        <ArtifactsSection artifacts={artifacts} />
        <RunsSection runs={runs} />
        <QuestionsSection questions={questions} />
        <TaskComments taskId={taskId} comments={comments} onCommentsChange={setComments} />
      </div>
    </div>
  );
}
