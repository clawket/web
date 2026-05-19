import { useState, useEffect } from 'react';
import type { Plan, Unit, Task, Cycle, TimelineEvent } from '../types';
import api from '../api';
import { Badge, type BadgeProps } from './ui';
import { cn } from '../lib/cn';

interface SummaryViewProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
}

type TaskStatus = Task['status'];
type Tier = 'low' | 'med' | 'high';

const KPI_STATUSES: TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];

const STATUS_VARIANT: Record<TaskStatus, BadgeProps['variant']> = {
  todo: 'default',
  in_progress: 'info',
  blocked: 'warning',
  done: 'success',
  cancelled: 'default',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'todo',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
};

const TIER_VARIANT: Record<Tier, BadgeProps['variant']> = {
  low: 'default',
  med: 'secondary',
  high: 'danger',
};

const TIMELINE_DOT: Record<TimelineEvent['event_type'], string> = {
  status_change: 'bg-primary',
  assignment: 'bg-primary',
  comment: 'bg-muted',
  knowledge: 'bg-primary',
  run_start: 'bg-warning',
  run_end: 'bg-success',
  question: 'bg-warning',
  created: 'bg-success',
  updated: 'bg-muted',
};

const AGENT_PALETTE: BadgeProps['variant'][] = [
  'info',
  'secondary',
  'success',
  'warning',
];

function hashAgent(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function agentVariant(agent: string): BadgeProps['variant'] {
  if (agent === 'main') return 'default';
  return AGENT_PALETTE[hashAgent(agent) % AGENT_PALETTE.length] ?? 'default';
}

function formatRelative(input: number | string | null, now = new Date()): string {
  if (input === null) return '';
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round((now.getTime() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function taskLastTouched(t: Task): number | null {
  return t.completed_at ?? t.started_at ?? t.created_at ?? null;
}

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      data-status={status}
      className={status === 'cancelled' ? 'line-through opacity-70' : ''}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function TierMark({ tier, showPrefix = true }: { tier: Tier; showPrefix?: boolean }) {
  return (
    <Badge variant={TIER_VARIANT[tier]} data-tier={tier}>
      {showPrefix ? `tier:${tier}` : tier}
    </Badge>
  );
}

function AgentTag({ agent }: { agent: string }) {
  return (
    <Badge variant={agentVariant(agent)} data-agent={agent}>
      {agent}
    </Badge>
  );
}

function EvidenceChip({ hasEvidence }: { hasEvidence: boolean }) {
  return (
    <Badge
      variant={hasEvidence ? 'success' : 'danger'}
      data-evidence={hasEvidence ? 'present' : 'missing'}
      title={
        hasEvidence
          ? 'Evidence attached. 4 KiB cap enforced by daemon.'
          : 'Evidence required to transition this task to done (4 KiB cap).'
      }
    >
      {hasEvidence ? 'evidence' : 'no evidence'}
    </Badge>
  );
}

interface KpiCardProps {
  status: TaskStatus;
  count: number;
}

function KpiCard({ status, count }: KpiCardProps) {
  return (
    <div
      data-testid={`kpi-${status}`}
      className={cn(
        'rounded-lg border border-border bg-surface',
        'px-4 py-3',
        'flex items-center justify-between gap-3',
      )}
    >
      <StatusPill status={status} />
      <span className="text-xl font-semibold text-foreground tabular-nums">
        {count}
      </span>
    </div>
  );
}

export interface OverallProgressCardProps {
  done: number;
  cancelled: number;
  inProgress: number;
  todo: number;
  blocked: number;
  total: number;
}

export function OverallProgressCard({
  done,
  cancelled,
  inProgress,
  todo,
  blocked,
  total,
}: OverallProgressCardProps) {
  const closed = done + cancelled;
  const percent =
    total > 0 ? (Math.floor((closed * 10000) / total) / 100).toFixed(2) : '0.00';
  const pClosed = total > 0 ? (closed / total) * 100 : 0;
  const pInProgress = total > 0 ? (inProgress / total) * 100 : 0;
  const pBlocked = total > 0 ? (blocked / total) * 100 : 0;

  return (
    <section
      data-testid="overall-progress"
      aria-label="Overall progress"
      className={cn(
        'rounded-lg border border-border bg-surface',
        'p-4 flex flex-col gap-3',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          Overall Progress
        </span>
        <span
          data-testid="overall-progress-percent"
          className="text-sm font-semibold text-primary tabular-nums"
        >
          {percent}%
        </span>
      </div>
      <div
        aria-hidden
        className="w-full h-2 rounded-full bg-surface-high overflow-hidden flex"
      >
        {pClosed > 0 && (
          <div className="bg-success h-full" style={{ width: `${pClosed}%` }} />
        )}
        {pInProgress > 0 && (
          <div className="bg-warning h-full" style={{ width: `${pInProgress}%` }} />
        )}
        {pBlocked > 0 && (
          <div className="bg-danger h-full" style={{ width: `${pBlocked}%` }} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="w-2 h-2 rounded-full bg-success" />
          Closed {closed}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="w-2 h-2 rounded-full bg-warning" />
          Active {inProgress}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="w-2 h-2 rounded-full bg-surface-high" />
          Todo {todo}
        </span>
        {blocked > 0 && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="w-2 h-2 rounded-full bg-danger" />
            Blocked {blocked}
          </span>
        )}
      </div>
    </section>
  );
}

interface ActiveTaskCardProps {
  task: Task;
  onSelect: (id: string) => void;
}

function ActiveTaskCard({ task, onSelect }: ActiveTaskCardProps) {
  const ticket = task.ticket_number ?? task.id;
  const tier: Tier = (task.tier as Tier | null | undefined) ?? 'med';
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      data-testid="active-task-card"
      data-ticket={ticket}
      className={cn(
        'rounded-lg border border-border bg-surface text-left',
        'p-5',
        'flex flex-col gap-3',
        'hover:bg-surface-high transition-colors cursor-pointer',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">
            Active task &middot; {ticket}
          </p>
          <h3 className="text-lg font-semibold text-foreground mt-1">
            {task.title}
          </h3>
        </div>
        <TierMark tier={tier} showPrefix />
      </header>
      {task.body && (
        <p className="text-sm text-muted leading-relaxed line-clamp-3">
          {task.body}
        </p>
      )}
      <footer className="flex flex-wrap items-center gap-2 pt-2">
        <StatusPill status={task.status} />
        <AgentTag agent={task.assignee ?? 'unassigned'} />
        <EvidenceChip hasEvidence={!!task.evidence} />
        <span className="ml-auto text-xs text-muted">
          Updated {formatRelative(taskLastTouched(task))}
        </span>
      </footer>
    </button>
  );
}

interface TimelineRowProps {
  event: TimelineEvent;
}

function TimelineRow({ event }: TimelineRowProps) {
  const d = event.detail ?? {};
  const dotClass = TIMELINE_DOT[event.event_type] ?? 'bg-muted';
  return (
    <li className="relative pl-6 pb-5 last:pb-0">
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1.5',
          'h-2.5 w-2.5 rounded-full',
          dotClass,
        )}
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wide text-muted">
            {formatRelative(event.created_at)}
          </span>
          {event.actor && <AgentTag agent={event.actor} />}
          <span className="text-xs text-muted font-mono">{event.event_type}</span>
        </div>
        <p className="text-sm text-foreground">{event.entity_title}</p>
        {event.event_type === 'status_change' && d.old_value && d.new_value && (
          <p className="text-xs text-muted">
            {d.old_value} → {d.new_value}
          </p>
        )}
        {event.event_type === 'updated' && d.field && (
          <p className="text-xs text-muted">
            {d.field}: {d.old_value ?? '?'} → {d.new_value ?? '?'}
          </p>
        )}
        {(event.event_type === 'comment' || event.event_type === 'question') &&
          d.body && (
            <p className="text-xs text-muted line-clamp-2">{d.body}</p>
          )}
        {event.event_type === 'run_end' && (
          <p className="text-xs text-muted">
            {[d.result, d.duration_ms != null ? `${Math.round(d.duration_ms / 1000)}s` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>
    </li>
  );
}

function findActivePlan(plans: Plan[]): Plan | null {
  return plans.find((p) => p.status === 'active') ?? plans[0] ?? null;
}

function findActiveUnitTitle(
  cycles: Cycle[],
  units: Unit[],
): string | null {
  const active = cycles.find((c) => c.status === 'active');
  if (!active) return null;
  const unit = units.find((u) => u.id === active.unit_id);
  return unit?.title ?? null;
}

export default function SummaryView({ projectId, onSelectTask }: SummaryViewProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [planList, cycleList, timelineList] = await Promise.all([
          api.listPlans({ project_id: projectId }),
          api.listCycles({ project_id: projectId }),
          api.listProjectTimeline(projectId, { limit: 50 }).catch(() => []),
        ]);
        if (cancelled) return;
        setPlans(planList);
        setCycles(cycleList);
        setTimeline(timelineList);

        const unitResults = await Promise.all(
          planList.map((p) => api.listUnits({ plan_id: p.id })),
        );
        if (cancelled) return;
        const allUnits = unitResults.flat();
        setUnits(allUnits);

        const taskResults = await Promise.all(
          allUnits.map((u) => api.listTasks({ unit_id: u.id })),
        );
        if (cancelled) return;
        setTasks(taskResults.flat());
      } catch (err) {
        console.error('Failed to load summary:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div
        data-testid="summary-loading"
        className="flex-1 flex items-center justify-center text-muted"
      >
        Loading summary...
      </div>
    );
  }

  const counts: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  };
  for (const t of tasks) counts[t.status] += 1;

  const activePlan = findActivePlan(plans);
  const activeTask =
    tasks.find((t) => t.status === 'in_progress') ?? tasks[0] ?? null;
  const recentEvents = timeline.slice(0, 5);
  const unitTitle = findActiveUnitTitle(cycles, units);

  const subtitle = activePlan ? activePlan.title : 'No active plan';

  return (
    <div
      data-testid="view-summary"
      className="flex-1 overflow-y-auto p-6 flex flex-col gap-6"
    >
      <header>
        <h2 className="text-lg font-semibold text-foreground">Summary</h2>
        <p
          data-testid="summary-subtitle"
          className="text-sm text-muted mt-1"
        >
          {subtitle}
        </p>
      </header>

      <OverallProgressCard
        done={counts.done}
        cancelled={counts.cancelled}
        inProgress={counts.in_progress}
        todo={counts.todo}
        blocked={counts.blocked}
        total={tasks.length}
      />

      <section
        aria-label="KPI strip"
        data-testid="kpi-strip"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        {KPI_STATUSES.map((s) => (
          <KpiCard key={s} status={s} count={counts[s]} />
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section
          aria-label="Now active"
          className="lg:col-span-2 flex flex-col gap-4"
        >
          <header className="flex items-end justify-between">
            <h3 className="text-lg font-semibold text-foreground">Now active</h3>
            {unitTitle && (
              <p data-testid="active-unit-title" className="text-xs text-muted">
                {unitTitle}
              </p>
            )}
          </header>
          {activeTask ? (
            <ActiveTaskCard task={activeTask} onSelect={onSelectTask} />
          ) : (
            <p
              data-testid="no-active-task"
              className="text-sm text-muted italic"
            >
              No tasks in this project yet.
            </p>
          )}
          <section
            aria-label="Other in-progress tasks"
            className="flex flex-col gap-2"
          >
            {tasks
              .filter(
                (t) =>
                  t.status === 'in_progress' &&
                  activeTask !== null &&
                  t.id !== activeTask.id,
              )
              .map((t) => {
                const ticket = t.ticket_number ?? t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTask(t.id)}
                    data-testid="in-progress-row"
                    data-ticket={ticket}
                    className={cn(
                      'rounded-md border border-border bg-surface',
                      'px-3 py-2',
                      'flex items-center gap-2 text-left',
                      'hover:bg-surface-high transition-colors cursor-pointer',
                    )}
                  >
                    <span className="font-mono text-xs text-muted">{ticket}</span>
                    <span className="text-sm text-foreground min-w-0 flex-1 truncate">
                      {t.title}
                    </span>
                    <AgentTag agent={t.assignee ?? 'unassigned'} />
                  </button>
                );
              })}
          </section>
        </section>

        <section
          aria-label="Recent activity"
          data-testid="recent-activity"
          className="flex flex-col gap-3"
        >
          <h3 className="text-lg font-semibold text-foreground">Recent activity</h3>
          {recentEvents.length === 0 ? (
            <p
              data-testid="no-recent-activity"
              className="text-sm text-muted italic"
            >
              No activity yet.
            </p>
          ) : (
            <ol className="relative border-l border-border pl-2">
              {recentEvents.map((e) => (
                <TimelineRow key={e.id} event={e} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
