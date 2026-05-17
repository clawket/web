import { useState, useEffect, useCallback } from 'react';
import type { Plan, Unit, Task, Artifact, Question } from '../types';
import api from '../api';
import StatusBadge from './StatusBadge';
import { Button, Label } from './ui';
import { PlanEditModal } from './PlanEditModal';
import DetailBreadcrumb, { type DetailBreadcrumbKind } from './DetailBreadcrumb';

interface PlanDetailProps {
  planId: string;
  onClose: () => void;
  onSelectItem?: (item: { type: DetailBreadcrumbKind; id: string }) => void;
}

export default function PlanDetail({ planId, onClose, onSelectItem }: PlanDetailProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, u, t, a, q] = await Promise.all([
        api.getPlan(planId),
        api.listUnits({ plan_id: planId }),
        api.listTasks({ plan_id: planId }),
        api.listArtifacts({ plan_id: planId }),
        api.listQuestions({ plan_id: planId }),
      ]);
      setPlan(p);
      setUnits(u.sort((a, b) => a.idx - b.idx));
      setTasks(t.sort((a, b) => a.idx - b.idx));
      setArtifacts(a);
      setQuestions(q);
    } catch (err) {
      console.error('Failed to load plan:', err);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  function formatTime(ts: number | string | null | undefined) {
    if (ts == null || ts === '') return '\u2014';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '\u2014';
    return d.toLocaleString();
  }

  if (loading || !plan) {
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted font-mono">{plan.id.slice(0, 8)}</span>
          <StatusBadge status={plan.status} />
        </div>
        <div className="flex items-center gap-2">
          {plan.status !== 'completed' && (
            <Button
              size="sm"
              variant="outline"
              data-testid="plan-detail-edit"
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
            {
              type: 'plan',
              id: plan.id,
              label: plan.title,
              status: plan.status,
            },
          ]}
          onSelectItem={onSelectItem}
        />

        {/* Title */}
        <h2 className="text-lg font-semibold text-foreground">{plan.title}</h2>

        {/* Source */}
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-muted">Source:</span>{' '}
            <span className="text-foreground">{plan.source}</span>
          </div>
          {plan.source_path && (
            <div>
              <span className="text-muted">Path:</span>{' '}
              <span className="text-foreground font-mono text-xs">{plan.source_path}</span>
            </div>
          )}
        </div>

        {/* Description */}
        {plan.description && (
          <div>
            <Label>Description</Label>
            <div className="bg-background border border-border rounded p-3 text-sm text-foreground whitespace-pre-wrap">
              {plan.description}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted">Created:</span> <span className="text-foreground">{formatTime(plan.created_at)}</span></div>
          <div><span className="text-muted">Approved:</span> <span className="text-foreground">{formatTime(plan.approved_at)}</span></div>
        </div>

        {/* Units overview (LM-10985 — tree-aware listing: unit + nested tasks) */}
        <div>
          <Label>Units ({units.length})</Label>
          {units.length === 0 ? (
            <div className="text-sm text-muted italic">No units yet</div>
          ) : (
            <div className="space-y-2" data-testid="plan-detail-units">
              {units.map((u) => {
                const unitTasks = tasks.filter((t) => t.unit_id === u.id);
                return (
                  <div key={u.id} className="space-y-1">
                    <button
                      type="button"
                      data-testid={`plan-detail-unit-${u.id}`}
                      onClick={() => onSelectItem?.({ type: 'unit', id: u.id })}
                      disabled={!onSelectItem}
                      className={`flex w-full items-center gap-2 bg-background border border-border rounded px-3 py-2 text-left ${
                        onSelectItem ? 'hover:border-primary/60 hover:bg-surface-high' : 'cursor-default'
                      }`}
                    >
                      <span className="text-xs text-muted font-mono w-5">#{u.idx + 1}</span>
                      <span className="text-sm text-foreground truncate flex-1">{u.title}</span>
                      <span className="text-xs text-muted shrink-0">
                        {unitTasks.length} task{unitTasks.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    {unitTasks.length > 0 && (
                      <ul
                        data-testid={`plan-detail-unit-${u.id}-tasks`}
                        className="ml-4 space-y-0.5 border-l border-border pl-2"
                      >
                        {unitTasks.map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              data-testid={`plan-detail-task-${t.id}`}
                              onClick={() => onSelectItem?.({ type: 'task', id: t.id })}
                              disabled={!onSelectItem}
                              className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-sm ${
                                onSelectItem ? 'hover:bg-surface-high' : 'cursor-default'
                              }`}
                              title={t.title}
                            >
                              <StatusBadge status={t.status} size="sm" />
                              {t.ticket_number && (
                                <span className="font-mono text-xs text-muted">{t.ticket_number}</span>
                              )}
                              <span className="truncate text-foreground">{t.title}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div>
            <Label>Artifacts ({artifacts.length})</Label>
            <div className="space-y-1.5">
              {artifacts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 bg-background border border-border rounded px-3 py-2">
                  <span className="text-xs font-mono bg-secondary/20 text-secondary px-1.5 py-0.5 rounded">{a.type}</span>
                  <span className="text-sm text-foreground truncate flex-1">{a.title}</span>
                  <span className="text-xs text-muted">{a.content_format}</span>
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
        <PlanEditModal
          plan={plan}
          onClose={() => setEditing(false)}
          onUpdated={(next) => setPlan(next)}
        />
      )}
    </div>
  );
}
