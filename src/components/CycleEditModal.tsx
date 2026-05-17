import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api from '../api';
import type { Cycle } from '../types';

export interface CycleEditModalProps {
  cycle: Cycle;
  onClose: () => void;
  onUpdated: (cycle: Cycle) => void;
}

interface CycleDraft {
  title: string;
  goal: string;
}

type CyclePatch = Partial<Pick<Cycle, 'title' | 'goal'>>;

function buildPatch(initial: CycleDraft, draft: CycleDraft): CyclePatch {
  const patch: CyclePatch = {};
  if (draft.title !== initial.title) patch.title = draft.title;
  if (draft.goal !== initial.goal) {
    patch.goal = draft.goal.length > 0 ? draft.goal : null;
  }
  return patch;
}

export function CycleEditModal({ cycle, onClose, onUpdated }: CycleEditModalProps) {
  const initial: CycleDraft = {
    title: cycle.title,
    goal: cycle.goal ?? '',
  };
  const [title, setTitle] = useState(initial.title);
  const [goal, setGoal] = useState(initial.goal);
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
  const trimmedGoal = goal.trim();
  const patch = buildPatch(initial, { title: trimmedTitle, goal: trimmedGoal });
  const hasChanges = Object.keys(patch).length > 0;
  const canSubmit = trimmedTitle.length > 0 && hasChanges && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const updated = await api.updateCycle(cycle.id, patch);
      toastSuccess(`Cycle updated: ${updated.title}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update cycle';
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
          aria-label="Edit cycle"
          data-testid="cycle-edit-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Edit cycle</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="cycle-edit-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <p
              data-testid="cycle-edit-id"
              className="font-mono text-xs text-muted"
            >
              {cycle.id}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="cycle-edit-title"
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
                Goal
              </span>
              <Textarea
                size="sm"
                data-testid="cycle-edit-goal"
                rows={6}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            {err && (
              <p
                role="alert"
                data-testid="cycle-edit-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="cycle-edit-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="cycle-edit-submit"
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

export default CycleEditModal;
