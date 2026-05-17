import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Select, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api, { type CreateSubtaskInput } from '../api';
import type { Task } from '../types';

export interface SubtaskCreateModalProps {
  /** Parent task — unit/cycle inherited unless overridden by the daemon. */
  parent: Task;
  onClose: () => void;
  onCreated: (subtask: Task) => void;
}

const PRIORITY_OPTIONS: Task['priority'][] = ['critical', 'high', 'medium', 'low'];

export function SubtaskCreateModal({ parent, onClose, onCreated }: SubtaskCreateModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Task['priority']>(parent.priority);
  const [assignee, setAssignee] = useState(parent.assignee ?? '');
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
  const canSubmit = trimmedTitle.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    const input: CreateSubtaskInput = { title: trimmedTitle };
    if (trimmedBody.length > 0) input.body = trimmedBody;
    if (priority !== parent.priority) input.priority = priority;
    if (trimmedAssignee.length > 0) input.assignee = trimmedAssignee;
    try {
      const child = await api.createSubtask(parent.id, input);
      toastSuccess(`Subtask created: ${child.title}`);
      onCreated(child);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to create subtask';
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
          aria-label="Add subtask"
          data-testid="subtask-create-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Add subtask</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="subtask-create-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <p
              data-testid="subtask-create-parent"
              className="font-mono text-xs text-muted"
            >
              parent: {parent.ticket_number ?? parent.id}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="subtask-create-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) handleSubmit();
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Body
              </span>
              <Textarea
                size="sm"
                data-testid="subtask-create-body"
                rows={6}
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
                  data-testid="subtask-create-priority"
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
                  Assignee
                </span>
                <Input
                  size="sm"
                  type="text"
                  data-testid="subtask-create-assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Inherits parent's assignee by default"
                />
              </label>
            </div>
            {err && (
              <p
                role="alert"
                data-testid="subtask-create-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="subtask-create-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="subtask-create-submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Overlay>
  );
}

export default SubtaskCreateModal;
