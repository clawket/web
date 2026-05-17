import { useState, useEffect, useCallback } from 'react';
import type { Unit, Task, Artifact, Question, Plan } from '../types';
import { CLOSED_STATUSES } from '../types';
import api from '../api';
import StatusBadge from './StatusBadge';
import { Button, Label } from './ui';
import { UnitEditModal } from './UnitEditModal';
import DetailBreadcrumb, { type DetailBreadcrumbKind } from './DetailBreadcrumb';

interface UnitDetailProps {
  unitId: string;
  onClose: () => void;
  onSelectItem?: (item: { type: DetailBreadcrumbKind; id: string }) => void;
}

export default function UnitDetail({ unitId, onClose, onSelectItem }: UnitDetailProps) {
  const [unit, setUnit] = useState<Unit | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ph, st, a, q] = await Promise.all([
        api.getUnit(unitId),
        api.listTasks({ unit_id: unitId }),
        api.listArtifacts({ unit_id: unitId }),
        api.listQuestions({ unit_id: unitId }),
      ]);
      setUnit(ph);
      setTasks(st.sort((a, b) => a.idx - b.idx));
      setArtifacts(a);
      setQuestions(q);
      if (ph.plan_id) {
        api.getPlan(ph.plan_id).then(setPlan).catch(() => setPlan(null));
      } else {
        setPlan(null);
      }
    } catch (err) {
      console.error('Failed to load unit:', err);
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => { load(); }, [load]);

  function formatTime(ts: number | string | null | undefined) {
    if (ts == null || ts === '') return '\u2014';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '\u2014';
    return d.toLocaleString();
  }

  if (loading || !unit) {
    return (
      <div className="w-full bg-surface flex items-center justify-center text-muted text-sm">
        Loading...
      </div>
    );
  }

  const doneCount = tasks.filter((s) => CLOSED_STATUSES.has(s.status)).length;
  const progress = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;

  const statusCounts = tasks.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="w-full bg-surface flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted font-mono">{unit.id.slice(0, 8)}</span>
          {/* Unit: no status */}
        </div>
        <div className="flex items-center gap-2">
          {!unit.completed_at && (
            <Button
              size="sm"
              variant="outline"
              data-testid="unit-detail-edit"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">&times;</button>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Breadcrumb (LM-10984) */}
        <DetailBreadcrumb
          items={[
            ...(plan
              ? [
                  {
                    type: 'plan' as const,
                    id: plan.id,
                    label: plan.title,
                    status: plan.status,
                  },
                ]
              : []),
            { type: 'unit', id: unit.id, label: unit.title },
          ]}
          onSelectItem={onSelectItem}
        />

        {/* Title */}
        <h2 className="text-lg font-semibold text-foreground">{unit.title}</h2>

        {/* Index & Approval */}
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-muted">Unit</span>{' '}
            <span className="text-foreground font-medium">#{unit.idx + 1}</span>
          </div>
          <div>
            <span className="text-muted">Approval:</span>{' '}
            {unit.approval_required ? (
              unit.approved_at ? (
                <span className="text-success">Approved by {unit.approved_by}</span>
              ) : (
                <span className="text-warning">Required</span>
              )
            ) : (
              <span className="text-muted">Not required</span>
            )}
          </div>
        </div>

        {/* Goal */}
        {unit.goal && (
          <div>
            <Label>Goal</Label>
            <div className="bg-background border border-border rounded p-3 text-sm text-foreground whitespace-pre-wrap">
              {unit.goal}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted">Created:</span> <span className="text-foreground">{formatTime(unit.created_at)}</span></div>
          <div><span className="text-muted">Started:</span> <span className="text-foreground">{formatTime(unit.started_at)}</span></div>
          <div><span className="text-muted">Completed:</span> <span className="text-foreground">{formatTime(unit.completed_at)}</span></div>
          {unit.approved_at && (
            <div><span className="text-muted">Approved:</span> <span className="text-foreground">{formatTime(unit.approved_at)}</span></div>
          )}
        </div>

        {/* Progress */}
        <div>
          <Label>Progress</Label>
          <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-2">
            <div className="h-full bg-success rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-3 text-xs">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <StatusBadge status={status} size="sm" />
                <span className="text-muted">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tasks summary (LM-10985 — clickable rows route to TaskDetail) */}
        <div>
          <Label>Tasks ({tasks.length})</Label>
          <div className="space-y-1" data-testid="unit-detail-tasks">
            {tasks.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`unit-detail-task-${s.id}`}
                onClick={() => onSelectItem?.({ type: 'task', id: s.id })}
                disabled={!onSelectItem}
                className={`flex w-full items-center gap-2 text-sm rounded px-1.5 py-0.5 text-left ${
                  onSelectItem ? 'hover:bg-surface-high' : 'cursor-default'
                }`}
                title={s.title}
              >
                <StatusBadge status={s.status} size="sm" />
                {s.ticket_number && (
                  <span className="font-mono text-xs text-muted">{s.ticket_number}</span>
                )}
                <span className="text-foreground truncate">{s.title}</span>
                {s.assignee && <span className="text-xs text-muted ml-auto shrink-0">{s.assignee}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div>
            <Label>Artifacts ({artifacts.length})</Label>
            <div className="space-y-1.5">
              {artifacts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 bg-background border border-border rounded px-3 py-2">
                  <span className="text-xs font-mono bg-secondary/20 text-secondary px-1.5 py-0.5 rounded">{a.type}</span>
                  <span className="text-sm text-foreground truncate">{a.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Questions */}
        {questions.length > 0 && (
          <div>
            <Label>Questions ({questions.length})</Label>
            <div className="space-y-2">
              {questions.map((q) => (
                <div key={q.id} className="bg-background border border-border rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded">{q.kind}</span>
                    <span className="text-xs text-muted">by {q.asked_by}</span>
                  </div>
                  <div className="text-sm text-foreground">{q.body}</div>
                  {q.answer && (
                    <div className="mt-2 pl-3 border-l-2 border-success">
                      <div className="text-xs text-muted mb-0.5">Answer by {q.answered_by}</div>
                      <div className="text-sm text-foreground">{q.answer}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {editing && (
        <UnitEditModal
          unit={unit}
          onClose={() => setEditing(false)}
          onUpdated={(next) => setUnit(next)}
        />
      )}
    </div>
  );
}
