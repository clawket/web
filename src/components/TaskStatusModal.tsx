import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Textarea } from './ui';
import StatusBadge from './StatusBadge';
import { toastError, toastSuccess } from '../lib/toast';
import api, { type UpdateTaskPatch } from '../api';
import type { Task } from '../types';

export interface TaskStatusModalProps {
  task: Task;
  onClose: () => void;
  onUpdated: (task: Task) => void;
}

type Status = Task['status'];

/** Lifecycle transitions allowed from each starting status — mirrors the
 *  daemon's `repo::tasks::validate_transition`. `done` / `cancelled` are
 *  terminal; reopening cancelled work is intentionally out of scope. */
const TRANSITIONS: Record<Status, Status[]> = {
  todo: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['todo', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

const STATUS_LABELS: Record<Status, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

function buildPatch(
  next: Status,
  evidence: string,
  reason: string,
  comment: string,
): UpdateTaskPatch {
  const patch: UpdateTaskPatch = { status: next };
  if (next === 'done') {
    patch.evidence = evidence;
  } else if (next === 'cancelled') {
    if (reason.length > 0) patch._comment = reason;
  } else if (comment.length > 0) {
    patch._comment = comment;
  }
  return patch;
}

export function TaskStatusModal({ task, onClose, onUpdated }: TaskStatusModalProps) {
  const allowed = TRANSITIONS[task.status];
  const [next, setNext] = useState<Status | ''>(() => allowed[0] ?? '');
  const [evidence, setEvidence] = useState(task.evidence ?? '');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmedEvidence = evidence.trim();
  const trimmedReason = reason.trim();
  const trimmedComment = comment.trim();
  const evidenceMissing = next === 'done' && trimmedEvidence.length === 0;
  const canSubmit = useMemo(
    () => next !== '' && !evidenceMissing && !submitting,
    [next, evidenceMissing, submitting],
  );

  async function handleSubmit() {
    if (!canSubmit || next === '') return;
    setSubmitting(true);
    setErr(null);
    try {
      const patch = buildPatch(next, trimmedEvidence, trimmedReason, trimmedComment);
      const updated = await api.updateTask(task.id, patch);
      toastSuccess(`Task status: ${STATUS_LABELS[updated.status]}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update task status';
      setErr(message);
      toastError(message);
      setSubmitting(false);
    }
  }

  return (
    <Modal.Overlay onClose={onClose}>
      <Modal.Content className="w-[520px] max-w-[calc(100vw-2rem)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Change task status"
          data-testid="task-status-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Change status</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="task-status-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <span
                className="font-mono text-xs text-muted"
                data-testid="task-status-ticket"
              >
                {task.ticket_number ?? task.id}
              </span>
              <StatusBadge status={task.status} size="sm" />
              <span className="text-muted">→</span>
              {next === '' ? (
                <span
                  className="text-muted italic"
                  data-testid="task-status-no-transitions"
                >
                  No transitions available
                </span>
              ) : (
                <StatusBadge status={next} size="sm" />
              )}
            </div>
            {allowed.length === 0 ? (
              <p className="text-sm text-muted">
                This task is in a terminal state ({STATUS_LABELS[task.status]});
                create a follow-up task if more work is needed.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  New status
                </span>
                <div
                  role="radiogroup"
                  aria-label="New status"
                  className="flex flex-wrap gap-2"
                >
                  {allowed.map((s) => {
                    const selected = next === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-testid={`task-status-option-${s}`}
                        onClick={() => setNext(s)}
                        className={
                          'rounded-md border px-3 py-1.5 text-sm transition-colors cursor-pointer ' +
                          (selected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-surface text-muted hover:border-primary/60 hover:text-foreground')
                        }
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {next === 'done' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Evidence <span className="text-danger">*</span>
                </span>
                <Textarea
                  size="sm"
                  data-testid="task-status-evidence"
                  rows={5}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="What confirms this task is done? (test output, PR link, screenshot path, …)"
                />
                <span className="text-xs text-muted">
                  The daemon rejects status=done without evidence (EVIDENCE_REQUIRED).
                </span>
              </label>
            )}
            {next === 'cancelled' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Reason
                </span>
                <Textarea
                  size="sm"
                  data-testid="task-status-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this task being cancelled? (optional, recorded as a comment)"
                />
              </label>
            )}
            {next !== '' && next !== 'done' && next !== 'cancelled' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Comment
                </span>
                <Textarea
                  size="sm"
                  data-testid="task-status-comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Optional note attached as a comment."
                />
              </label>
            )}
            {err && (
              <p
                role="alert"
                data-testid="task-status-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="task-status-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="task-status-submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Saving…' : 'Update status'}
              </Button>
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Overlay>
  );
}

export default TaskStatusModal;
