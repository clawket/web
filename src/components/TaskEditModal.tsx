import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Select, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api, { type UpdateTaskPatch } from '../api';
import type { Task } from '../types';

export interface TaskEditModalProps {
  task: Task;
  onClose: () => void;
  onUpdated: (task: Task) => void;
}

type Tier = 'low' | 'med' | 'high';
const TIER_OPTIONS: Tier[] = ['low', 'med', 'high'];
const PRIORITY_OPTIONS: Task['priority'][] = ['critical', 'high', 'medium', 'low'];

interface DraftState {
  title: string;
  body: string;
  priority: Task['priority'];
  assignee: string;
  tier: Tier;
  labelsCsv: string;
}

function normalizeLabels(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildPatch(
  initial: DraftState,
  initialLabels: string[],
  draft: DraftState,
  initialTier: Tier,
): UpdateTaskPatch {
  const patch: UpdateTaskPatch = {};
  if (draft.title !== initial.title) patch.title = draft.title;
  if (draft.body !== initial.body) {
    patch.body = draft.body.length > 0 ? draft.body : null;
  }
  if (draft.priority !== initial.priority) patch.priority = draft.priority;
  if (draft.assignee !== initial.assignee) {
    patch.assignee = draft.assignee.length > 0 ? draft.assignee : null;
  }
  if (draft.tier !== initialTier) patch.tier = draft.tier;
  const draftLabels = normalizeLabels(draft.labelsCsv);
  if (!arraysEqual(draftLabels, initialLabels)) patch.labels = draftLabels;
  return patch;
}

export function TaskEditModal({ task, onClose, onUpdated }: TaskEditModalProps) {
  const initialTier: Tier = (task.tier as Tier | null | undefined) ?? 'med';
  const initial: DraftState = {
    title: task.title,
    body: task.body ?? '',
    priority: task.priority,
    assignee: task.assignee ?? '',
    tier: initialTier,
    labelsCsv: task.labels.join(', '),
  };
  const initialLabels = task.labels;

  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [priority, setPriority] = useState<Task['priority']>(initial.priority);
  const [assignee, setAssignee] = useState(initial.assignee);
  const [tier, setTier] = useState<Tier>(initialTier);
  const [labelsCsv, setLabelsCsv] = useState(initial.labelsCsv);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const trimmedAssignee = assignee.trim();
  const draft: DraftState = {
    title: trimmedTitle,
    body: trimmedBody,
    priority,
    assignee: trimmedAssignee,
    tier,
    labelsCsv,
  };
  const patch = buildPatch(initial, initialLabels, draft, initialTier);
  const hasChanges = Object.keys(patch).length > 0;
  const canSubmit = trimmedTitle.length > 0 && hasChanges && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const updated = await api.updateTask(task.id, patch);
      toastSuccess(`Task updated: ${updated.title}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update task';
      setErr(message);
      toastError(message);
      setSubmitting(false);
    }
  }

  return (
    <Modal.Overlay onClose={onClose}>
      <Modal.Content className="w-[640px] max-w-[calc(100vw-2rem)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit task"
          data-testid="task-edit-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Edit task</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="task-edit-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <p
              data-testid="task-edit-id"
              className="font-mono text-xs text-muted"
            >
              {task.ticket_number ?? task.id}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="task-edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Body
              </span>
              <Textarea
                size="sm"
                data-testid="task-edit-body"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Priority
                </span>
                <Select
                  size="sm"
                  data-testid="task-edit-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Task['priority'])}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Tier
                </span>
                <Select
                  size="sm"
                  data-testid="task-edit-tier"
                  value={tier}
                  onChange={(e) => setTier(e.target.value as Tier)}
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Assignee
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="task-edit-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Leave empty to unassign"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Labels
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="task-edit-labels"
                value={labelsCsv}
                onChange={(e) => setLabelsCsv(e.target.value)}
                placeholder="Comma-separated, e.g. ui, refactor"
              />
            </label>
            {err && (
              <p
                role="alert"
                data-testid="task-edit-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="task-edit-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="task-edit-submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Overlay>
  );
}

export default TaskEditModal;
