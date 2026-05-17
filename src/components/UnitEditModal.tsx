import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api from '../api';
import type { Unit } from '../types';

export interface UnitEditModalProps {
  unit: Unit;
  onClose: () => void;
  onUpdated: (unit: Unit) => void;
}

interface UnitDraft {
  title: string;
  goal: string;
}

type UnitPatch = Partial<Pick<Unit, 'title' | 'goal'>>;

function buildPatch(initial: UnitDraft, draft: UnitDraft): UnitPatch {
  const patch: UnitPatch = {};
  if (draft.title !== initial.title) patch.title = draft.title;
  if (draft.goal !== initial.goal) {
    patch.goal = draft.goal.length > 0 ? draft.goal : null;
  }
  return patch;
}

export function UnitEditModal({ unit, onClose, onUpdated }: UnitEditModalProps) {
  const initial: UnitDraft = {
    title: unit.title,
    goal: unit.goal ?? '',
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
      const updated = await api.updateUnit(unit.id, patch);
      toastSuccess(`Unit updated: ${updated.title}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update unit';
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
          aria-label="Edit unit"
          data-testid="unit-edit-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Edit unit</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="unit-edit-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <p
              data-testid="unit-edit-id"
              className="font-mono text-xs text-muted"
            >
              {unit.id}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="unit-edit-title"
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
                data-testid="unit-edit-goal"
                rows={6}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            {err && (
              <p
                role="alert"
                data-testid="unit-edit-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="unit-edit-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="unit-edit-submit"
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

export default UnitEditModal;
