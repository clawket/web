import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api from '../api';
import type { Plan } from '../types';

export interface PlanEditModalProps {
  plan: Plan;
  onClose: () => void;
  onUpdated: (plan: Plan) => void;
}

interface PlanDraft {
  title: string;
  description: string;
}

type PlanPatch = Partial<Pick<Plan, 'title' | 'description'>>;

function buildPatch(initial: PlanDraft, draft: PlanDraft): PlanPatch {
  const patch: PlanPatch = {};
  if (draft.title !== initial.title) patch.title = draft.title;
  if (draft.description !== initial.description) {
    patch.description = draft.description.length > 0 ? draft.description : null;
  }
  return patch;
}

export function PlanEditModal({ plan, onClose, onUpdated }: PlanEditModalProps) {
  const initial: PlanDraft = {
    title: plan.title,
    description: plan.description ?? '',
  };
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
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
  const trimmedDescription = description.trim();
  const patch = buildPatch(initial, {
    title: trimmedTitle,
    description: trimmedDescription,
  });
  const hasChanges = Object.keys(patch).length > 0;
  const canSubmit = trimmedTitle.length > 0 && hasChanges && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const updated = await api.updatePlan(plan.id, patch);
      toastSuccess(`Plan updated: ${updated.title}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update plan';
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
          aria-label="Edit plan"
          data-testid="plan-edit-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Edit plan</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="plan-edit-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <p
              data-testid="plan-edit-id"
              className="font-mono text-xs text-muted"
            >
              {plan.id}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="plan-edit-title"
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
                Description
              </span>
              <Textarea
                size="sm"
                data-testid="plan-edit-description"
                rows={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {err && (
              <p
                role="alert"
                data-testid="plan-edit-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="plan-edit-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="plan-edit-submit"
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

export default PlanEditModal;
