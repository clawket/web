import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Select, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api from '../api';
import type { Cycle, Plan, Unit } from '../types';

export interface CycleCreateModalProps {
  projectId: string;
  /** Optional default unit. When omitted, the modal loads the project's
   *  active plan units and lets the user pick. */
  unitId?: string;
  onClose: () => void;
  onCreated: (cycle: Cycle) => void;
}

interface UnitOption {
  id: string;
  planId: string;
  planTitle: string;
  title: string;
  idx: number;
}

function buildUnitOptions(plans: Plan[], units: Unit[]): UnitOption[] {
  const planById = new Map(plans.map((p) => [p.id, p]));
  return units
    .filter((u) => planById.has(u.plan_id))
    .map((u) => ({
      id: u.id,
      planId: u.plan_id,
      planTitle: planById.get(u.plan_id)?.title ?? u.plan_id,
      title: u.title,
      idx: u.idx,
    }))
    .sort((a, b) => {
      if (a.planTitle !== b.planTitle) return a.planTitle.localeCompare(b.planTitle);
      return a.idx - b.idx;
    });
}

export function CycleCreateModal({
  projectId,
  unitId: defaultUnitId,
  onClose,
  onCreated,
}: CycleCreateModalProps) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [unitId, setUnitId] = useState<string>(defaultUnitId ?? '');
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(defaultUnitId == null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (defaultUnitId) return;
    let cancelled = false;
    Promise.all([
      api.listPlans({ project_id: projectId }),
      api.listUnits(),
    ])
      .then(([plans, units]) => {
        if (cancelled) return;
        const inProject = plans.filter((p) => p.project_id === projectId);
        const planIds = new Set(inProject.map((p) => p.id));
        const projectUnits = units.filter((u) => planIds.has(u.plan_id));
        const options = buildUnitOptions(inProject, projectUnits);
        setUnitOptions(options);
        if (!unitId && options.length > 0) {
          const active = inProject.find((p) => p.status === 'active');
          const preferred = active
            ? options.find((o) => o.planId === active.id) ?? options[0]
            : options[0];
          setUnitId(preferred.id);
        }
      })
      .catch((e) => setErr((e as Error).message || 'Failed to load units'))
      .finally(() => {
        if (!cancelled) setLoadingUnits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, defaultUnitId, unitId]);

  const trimmedTitle = title.trim();
  const canSubmit = useMemo(
    () => trimmedTitle.length > 0 && unitId.length > 0 && !submitting && !loadingUnits,
    [trimmedTitle, unitId, submitting, loadingUnits],
  );

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const trimmedGoal = goal.trim();
      const created = await api.createCycle({
        project_id: projectId,
        unit_id: unitId,
        title: trimmedTitle,
        goal: trimmedGoal.length > 0 ? trimmedGoal : undefined,
      });
      toastSuccess(`Cycle created: ${created.title}`);
      onCreated(created);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to create cycle';
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
          aria-label="Create cycle"
          data-testid="cycle-create-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Create cycle</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="cycle-create-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            {defaultUnitId ? (
              <p
                data-testid="cycle-create-unit"
                className="font-mono text-xs text-muted"
              >
                unit: {defaultUnitId}
              </p>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted">
                  Unit <span className="text-danger">*</span>
                </span>
                <Select
                  size="sm"
                  data-testid="cycle-create-unit"
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  disabled={loadingUnits || unitOptions.length === 0}
                >
                  {loadingUnits && <option value="">Loading units…</option>}
                  {!loadingUnits && unitOptions.length === 0 && (
                    <option value="">No units in this project</option>
                  )}
                  {!loadingUnits &&
                    unitOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.planTitle} · #{o.idx + 1} {o.title}
                      </option>
                    ))}
                </Select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Title <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="cycle-create-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Round 1: discover defects"
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
                data-testid="cycle-create-goal"
                rows={4}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What this cycle must converge on…"
              />
            </label>
            {err && (
              <p
                role="alert"
                data-testid="cycle-create-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="cycle-create-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="cycle-create-submit"
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

export default CycleCreateModal;
