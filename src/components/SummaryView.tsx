import { useState, useEffect, useCallback } from 'react';
import type { Project, Plan, Unit, Task, Cycle, Run } from '../types';
import { CLOSED_STATUSES } from '../types';
import api from '../api';
import { ProjectSettings } from './ProjectSettings';

interface SummaryViewProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
}

interface UnitWithPlan extends Unit {
  planTitle: string;
  planStatus: Plan['status'];
}

type UnitBucket = 'now' | 'next' | 'done' | 'empty';

const NEXT_DEFAULT_LIMIT = 5;

function classifyUnit(
  planStatus: Plan['status'],
  unitTasks: Task[],
  activeCycleIds: ReadonlySet<string>,
): UnitBucket {
  if (unitTasks.length === 0) return 'empty';
  const allClosed = unitTasks.every(t => CLOSED_STATUSES.has(t.status));
  if (allClosed) return 'done';
  if (planStatus === 'completed') return 'done';
  const hasActiveCycleInProgress = unitTasks.some(
    t => t.status === 'in_progress' && t.cycle_id !== null && activeCycleIds.has(t.cycle_id),
  );
  if (hasActiveCycleInProgress) return 'now';
  return 'next';
}

function PlanStatusPill({ status }: { status: Plan['status'] }) {
  const cls =
    status === 'active'
      ? 'bg-warning/15 text-warning'
      : status === 'completed'
      ? 'bg-success/15 text-success'
      : 'bg-surface-high text-muted';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function UnitRow({
  unit,
  done,
  total,
  dim,
  injected,
}: {
  unit: UnitWithPlan;
  done: number;
  total: number;
  dim?: boolean;
  injected?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${dim ? 'opacity-50' : ''}`}>
      <span
        aria-hidden="true"
        className={`w-1 self-stretch rounded-sm ${injected ? 'bg-warning' : 'bg-transparent'}`}
        title={injected ? 'In active cycle (injected context)' : undefined}
      />
      <span className="text-sm text-foreground flex-1 truncate">{unit.title}</span>
      <span className="text-xs text-muted whitespace-nowrap">
        {done}/{total}
      </span>
      <div className="w-24 h-1.5 rounded-full bg-surface-high overflow-hidden">
        {total > 0 && (
          <div
            className="h-full bg-success rounded-full"
            style={{ width: `${(done / total) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  );
}

function ProgressBar({ done, inProgress, todo, blocked }: { done: number; inProgress: number; todo: number; blocked: number }) {
  const total = done + inProgress + todo + blocked;
  if (total === 0) return null;

  const pDone = (done / total) * 100;
  const pInProgress = (inProgress / total) * 100;
  const pBlocked = (blocked / total) * 100;

  return (
    <div className="w-full h-2 rounded-full bg-surface-high overflow-hidden flex">
      {pDone > 0 && <div className="bg-success h-full" style={{ width: `${pDone}%` }} />}
      {pInProgress > 0 && <div className="bg-warning h-full" style={{ width: `${pInProgress}%` }} />}
      {pBlocked > 0 && <div className="bg-danger h-full" style={{ width: `${pBlocked}%` }} />}
    </div>
  );
}

interface UnitsSectionProps {
  units: UnitWithPlan[];
  plans: Plan[];
  tasks: Task[];
  cycles: Cycle[];
}

function UnitsSection({ units, plans, tasks, cycles }: UnitsSectionProps) {
  const [showAllNextByPlan, setShowAllNextByPlan] = useState<Record<string, boolean>>({});
  const [doneOpenByPlan, setDoneOpenByPlan] = useState<Record<string, boolean>>({});
  const [emptyOpenByPlan, setEmptyOpenByPlan] = useState<Record<string, boolean>>({});

  const activeCycleIds = new Set(cycles.filter(c => c.status === 'active').map(c => c.id));
  const tasksByUnit = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = tasksByUnit.get(t.unit_id) ?? [];
    arr.push(t);
    tasksByUnit.set(t.unit_id, arr);
  }

  // Group units by plan, preserving plan order from `plans` (active first)
  const planOrder = [...plans].sort((a, b) => {
    const rank = (s: Plan['status']) => (s === 'active' ? 0 : s === 'draft' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });
  const showPlanHeader = plans.length > 1;

  if (units.length === 0) {
    return (
      <div className="bg-surface rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Units</h3>
        <div className="text-xs text-muted">No units</div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
      <h3 className="text-sm font-medium text-foreground">Units</h3>
      {planOrder.map(plan => {
        const planUnits = units.filter(u => u.plan_id === plan.id);
        if (planUnits.length === 0) return null;

        const buckets = { now: [] as UnitWithPlan[], next: [] as UnitWithPlan[], done: [] as UnitWithPlan[], empty: [] as UnitWithPlan[] };
        const doneByUnit = new Map<string, { done: number; total: number }>();
        for (const u of planUnits) {
          const ut = tasksByUnit.get(u.id) ?? [];
          const done = ut.filter(t => CLOSED_STATUSES.has(t.status)).length;
          doneByUnit.set(u.id, { done, total: ut.length });
          buckets[classifyUnit(plan.status, ut, activeCycleIds)].push(u);
        }

        const showAllNext = !!showAllNextByPlan[plan.id];
        const doneOpen = !!doneOpenByPlan[plan.id];
        const emptyOpen = !!emptyOpenByPlan[plan.id];
        const visibleNext = showAllNext ? buckets.next : buckets.next.slice(0, NEXT_DEFAULT_LIMIT);
        const hiddenNextCount = buckets.next.length - visibleNext.length;

        const renderRow = (u: UnitWithPlan, dim?: boolean) => {
          const d = doneByUnit.get(u.id) ?? { done: 0, total: 0 };
          return <UnitRow key={u.id} unit={u} done={d.done} total={d.total} dim={dim} />;
        };

        return (
          <div key={plan.id} className="space-y-2">
            {showPlanHeader && (
              <div className="flex items-center gap-2 pb-1 border-b border-border">
                <span className="text-xs font-semibold text-foreground truncate">{plan.title}</span>
                <PlanStatusPill status={plan.status} />
                <span className="text-[10px] text-muted">{planUnits.length}</span>
              </div>
            )}

            {buckets.now.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-warning font-semibold">
                  Now ({buckets.now.length})
                </div>
                {buckets.now.map(u => {
                  const d = doneByUnit.get(u.id) ?? { done: 0, total: 0 };
                  return <UnitRow key={u.id} unit={u} done={d.done} total={d.total} injected />;
                })}
              </div>
            )}

            {buckets.next.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">
                  Next ({buckets.next.length})
                </div>
                {visibleNext.map(u => renderRow(u))}
                {hiddenNextCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllNextByPlan(s => ({ ...s, [plan.id]: true }))}
                    className="text-xs text-primary hover:underline"
                  >
                    Show {hiddenNextCount} more
                  </button>
                )}
                {showAllNext && buckets.next.length > NEXT_DEFAULT_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllNextByPlan(s => ({ ...s, [plan.id]: false }))}
                    className="text-xs text-muted hover:underline"
                  >
                    Show less
                  </button>
                )}
              </div>
            )}

            {buckets.done.length > 0 && (
              <details
                open={doneOpen}
                onToggle={e => setDoneOpenByPlan(s => ({ ...s, [plan.id]: (e.target as HTMLDetailsElement).open }))}
              >
                <summary className="text-[10px] uppercase tracking-wide text-muted font-semibold cursor-pointer select-none list-none">
                  <span className="inline-block w-3">{doneOpen ? '▾' : '▸'}</span>
                  Done units ({buckets.done.length})
                </summary>
                <div className="space-y-1.5 mt-1.5">
                  {buckets.done.map(u => renderRow(u))}
                </div>
              </details>
            )}

            {buckets.empty.length > 0 && (
              <details
                open={emptyOpen}
                onToggle={e => setEmptyOpenByPlan(s => ({ ...s, [plan.id]: (e.target as HTMLDetailsElement).open }))}
              >
                <summary className="text-[10px] uppercase tracking-wide text-muted font-semibold cursor-pointer select-none list-none">
                  <span className="inline-block w-3">{emptyOpen ? '▾' : '▸'}</span>
                  Empty ({buckets.empty.length})
                </summary>
                <div className="space-y-1.5 mt-1.5">
                  {buckets.empty.map(u => renderRow(u, true))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SummaryView({ projectId, onSelectTask }: SummaryViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [units, setUnits] = useState<UnitWithPlan[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadProject = useCallback(async () => {
    const p = await api.getProject(projectId);
    setProject(p);
    return p;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [proj, planList, cycleList] = await Promise.all([
          api.getProject(projectId),
          api.listPlans({ project_id: projectId }),
          api.listCycles({ project_id: projectId }),
        ]);
        if (cancelled) return;
        setProject(proj);
        if (cancelled) return;
        setPlans(planList);
        setCycles(cycleList);

        // Load units for each plan
        const unitResults = await Promise.all(
          planList.map(p => api.listUnits({ plan_id: p.id }).then(units =>
            units.map(u => ({ ...u, planTitle: p.title, planStatus: p.status }))
          ))
        );
        if (cancelled) return;
        const allUnits = unitResults.flat();
        setUnits(allUnits);

        // Load tasks for each unit
        const taskResults = await Promise.all(
          allUnits.map(u => api.listTasks({ unit_id: u.id }))
        );
        if (cancelled) return;
        const allTasks = taskResults.flat();
        setTasks(allTasks);

        // in_progress task 우선 (open run 누락 방지) + 나머지에서 recent activity 채우기
        const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
        const otherTasks = allTasks
          .filter(t => t.status !== 'in_progress')
          .slice(0, Math.max(0, 20 - inProgressTasks.length));
        const runResults = await Promise.all(
          [...inProgressTasks, ...otherTasks].map(t => api.listRuns({ task_id: t.id }))
        );
        if (cancelled) return;
        setRuns(runResults.flat());
      } catch (err) {
        console.error('Failed to load summary:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted">
        Loading summary...
      </div>
    );
  }

  // Task stats
  const tasksByStatus = {
    done: tasks.filter(s => CLOSED_STATUSES.has(s.status)).length,
    in_progress: tasks.filter(s => s.status === 'in_progress').length,
    todo: tasks.filter(s => s.status === 'todo').length,
    blocked: tasks.filter(s => s.status === 'blocked').length,
  };
  const totalTasks = tasks.length;
  const completionPercent = totalTasks > 0
    ? (Math.floor((tasksByStatus.done * 10000) / totalTasks) / 100).toFixed(2)
    : '0.00';

  // Active sessions — open runs (Run.ended_at == null) 의 unique agent.
  // task.assignee 는 single-user 환경에서 NULL 이거나 'main' 단일값이라 유효 시그널이 아님.
  // LM-10829 (T6/D): defensive filter — only count runs whose task is actually
  // in_progress. Without this, daemon restarts / SubagentStop hook misses leak
  // runs as "open" indefinitely; the card then over-reports phantom sessions.
  const inProgressTaskIds = new Set(
    tasks.filter(t => t.status === 'in_progress').map(t => t.id)
  );
  const activeSessions = [...new Set(
    runs
      .filter(r => r.ended_at === null && inProgressTaskIds.has(r.task_id))
      .map(r => r.agent)
  )];

  // Active cycles
  const activeCycles = cycles.filter(b => b.status === 'active');

  // Recent activity (last 10 runs sorted by started_at desc)
  const recentRuns = [...runs]
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, 10);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Summary</h2>
        <p className="text-sm text-muted mt-1">
          {plans.length} plan{plans.length !== 1 ? 's' : ''} &middot; {units.length} unit{units.length !== 1 ? 's' : ''} &middot; {totalTasks} task{totalTasks !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Overall progress */}
      <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Overall Progress</span>
          <span className="text-sm font-bold text-primary">{completionPercent}%</span>
        </div>
        <ProgressBar
          done={tasksByStatus.done}
          inProgress={tasksByStatus.in_progress}
          todo={tasksByStatus.todo}
          blocked={tasksByStatus.blocked}
        />
        <div className="flex gap-4 text-xs text-muted flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> Closed {tasksByStatus.done}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning inline-block" /> Active {tasksByStatus.in_progress}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-surface-high inline-block" /> Todo {tasksByStatus.todo}</span>
          {tasksByStatus.blocked > 0 && (
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> Blocked {tasksByStatus.blocked}</span>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Tasks" value={totalTasks} color="text-foreground" />
        <StatCard label="Closed" value={tasksByStatus.done} color="text-success" />
        <StatCard label="In Progress" value={tasksByStatus.in_progress} color="text-warning" />
        <StatCard label="Blocked" value={tasksByStatus.blocked} color="text-danger" />
      </div>

      {/* Active sessions & cycles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Active Sessions */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Active Sessions</h3>
          {activeSessions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeSessions.map(agent => (
                <span key={agent} className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                  @{agent}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted">No active sessions</div>
          )}
        </div>

        {/* Active Cycles */}
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Active Cycles</h3>
          {activeCycles.length > 0 ? (
            <div className="space-y-2">
              {activeCycles.map(cycle => {
                const cycleTasks = tasks.filter(s => s.cycle_id === cycle.id);
                const cycleDone = cycleTasks.filter(s => CLOSED_STATUSES.has(s.status)).length;
                return (
                  <div key={cycle.id} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{cycle.title}</span>
                    <span className="text-xs text-muted">{cycleDone}/{cycleTasks.length}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-muted">No active cycles</div>
          )}
        </div>
      </div>

      <UnitsSection units={units} plans={plans} tasks={tasks} cycles={cycles} />

      {/* In-progress tasks */}
      {tasksByStatus.in_progress > 0 && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">In Progress</h3>
          <div className="space-y-1">
            {tasks.filter(s => s.status === 'in_progress').map(task => (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-surface-hover transition-colors flex items-center gap-2 cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">{task.title}</span>
                {task.assignee && (
                  <span className="text-xs text-muted">@{task.assignee}</span>
                )}
                {task.ticket_number && (
                  <span className="text-xs text-muted font-mono">{task.ticket_number}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {recentRuns.length > 0 && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Recent Activity</h3>
          <div className="space-y-1">
            {recentRuns.map(run => {
              const task = tasks.find(s => s.id === run.task_id);
              const isFinished = !!run.ended_at;
              return (
                <div key={run.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isFinished ? 'bg-success' : 'bg-warning'}`} />
                  <span className="text-foreground truncate flex-1">
                    {task?.title || run.task_id}
                  </span>
                  <span className="text-xs text-muted">@{run.agent}</span>
                  {run.result && (
                    <span className={`text-xs ${run.result === 'success' ? 'text-success' : 'text-muted'}`}>
                      {run.result}
                    </span>
                  )}
                  <span className="text-xs text-muted">
                    {(() => {
                      const d = new Date(run.started_at);
                      return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—';
                    })()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {project && <ProjectSettings project={project} projectId={projectId} onProjectChange={reloadProject} />}
    </div>
  );
}
