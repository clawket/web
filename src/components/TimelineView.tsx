import { useState, useEffect, useMemo, useRef } from 'react';
import type { Cycle, Task, Run, TimelineEvent, TimelineEventType } from '../types';
import { CLOSED_STATUSES } from '../types';
import api from '../api';

interface TimelineViewProps {
  projectId: string;
  onSelectTask: (taskId: string) => void;
  /** US-CLAWKET-WEB-TIME-005 — SSE task delta buffer from App.tsx. Re-render
   *  is currently driven by the App-level mount key (keyed off patchSeq);
   *  the prop is accepted for the contract and for future incremental updates. */
  taskPatches?: Map<string, Task | null>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Daemon serializes timestamps as ISO strings (ts_iso) but TS types still say
// `number`. Convert defensively for arithmetic and Date construction.
function toMs(ts: number | string | null | undefined): number {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? NaN : parsed;
}

// A run with no ended_at can be either currently running (recent start) or
// orphaned (started long ago, never closed by daemon). Treat orphans as
// session_ended snapshots so they don't paint a giant "running" bar across
// the whole swimlane and hide every completed run below.
const STALE_RUN_MS = 60 * 60 * 1000; // 1h

function effectiveEnd(run: Run, now: number): { endMs: number; result: string } {
  const endMs = toMs(run.ended_at);
  if (Number.isFinite(endMs)) {
    return { endMs, result: run.result || 'session_ended' };
  }
  const startedMs = toMs(run.started_at);
  if (Number.isFinite(startedMs) && now - startedMs > STALE_RUN_MS) {
    return { endMs: startedMs, result: 'session_ended' };
  }
  return { endMs: now, result: run.result || 'running' };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function formatTime(ts: number | string): string {
  const ms = toMs(ts);
  if (!Number.isFinite(ms)) return '--:--';
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDate(ts: number | string): string {
  const ms = toMs(ts);
  if (!Number.isFinite(ms)) return '--';
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const RESULT_COLORS: Record<string, string> = {
  success: 'bg-success/70',
  fail: 'bg-danger/70',
  session_ended: 'bg-muted/50',
  running: 'bg-warning/70 animate-pulse',
};

// ── Swimlane types ──────────────────────────────────────────────────────────

interface SwimlaneRun extends Run {
  taskTitle: string;
  taskTicket?: string;
}

type ViewTab = 'swimlane' | 'activity';

// ── Activity Stream (existing, simplified) ──────────────────────────────────

const EVENT_CONFIG: Record<TimelineEventType, { icon: string; color: string; dotColor: string }> = {
  status_change: { icon: '●', color: 'text-primary', dotColor: 'bg-primary' },
  assignment:    { icon: '→', color: 'text-foreground', dotColor: 'bg-foreground' },
  comment:       { icon: '◇', color: 'text-foreground', dotColor: 'bg-muted' },
  knowledge:     { icon: '□', color: 'text-foreground', dotColor: 'bg-accent' },
  run_start:     { icon: '▶', color: 'text-warning', dotColor: 'bg-warning' },
  run_end:       { icon: '■', color: 'text-success', dotColor: 'bg-success' },
  question:      { icon: '◇', color: 'text-warning', dotColor: 'bg-warning' },
  created:       { icon: '+', color: 'text-success', dotColor: 'bg-success' },
  updated:       { icon: '~', color: 'text-foreground', dotColor: 'bg-muted' },
};

function describeEvent(ev: TimelineEvent): { action: string; target: string; detail?: string } {
  const title = ev.entity_title || ev.entity_id;
  const actor = ev.actor ? `@${ev.actor}` : 'System';
  const d = ev.detail;
  switch (ev.event_type) {
    case 'status_change': return { action: `${actor} changed status`, target: title, detail: `${d.old_value || '?'} → ${d.new_value || '?'}` };
    case 'assignment': return { action: d.new_value ? `Assigned to @${d.new_value}` : `${actor} unassigned`, target: title };
    case 'comment': return { action: `${actor} commented`, target: title, detail: d.body?.slice(0, 80) };
    case 'knowledge': return { action: `${d.artifact_type || 'Knowledge'} added`, target: title };
    case 'run_start': return { action: `${actor} started`, target: title };
    case 'run_end': return { action: `${actor} finished`, target: title, detail: [d.result, d.duration_ms != null ? formatDuration(d.duration_ms) : null].filter(Boolean).join(' · ') };
    case 'question': return { action: `${actor} asked`, target: title, detail: d.body?.slice(0, 80) };
    case 'created': return { action: `${actor} created`, target: title };
    case 'updated': return { action: `${actor} updated ${d.field || ''}`, target: title, detail: d.field ? `${d.old_value || '?'} → ${d.new_value || '?'}` : undefined };
    default: return { action: actor, target: title };
  }
}

// ── Main component ──────────────────────────────────────────────────────────

interface CycleProgress {
  cycle: Cycle;
  tasks: Task[];
  done: number;
  inProgress: number;
  blocked: number;
  total: number;
}

export default function TimelineView({ projectId, onSelectTask, taskPatches: _taskPatches }: TimelineViewProps) {
  // See BoardView: TimelineView re-mounts via the App-level key, so the prop
  // is intentionally unread here but kept for future incremental patching.
  void _taskPatches;
  const [runs, setRuns] = useState<SwimlaneRun[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cycleProgress, setCycleProgress] = useState<CycleProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ViewTab>('swimlane');
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [runData, eventData, cycleList] = await Promise.all([
          api.listRuns({ project_id: projectId }),
          api.listProjectTimeline(projectId, { limit: 100 }),
          api.listCycles({ project_id: projectId }),
        ]);
        if (cancelled) return;

        // Active cycle progress
        const activeCycle = cycleList.find(b => b.status === 'active');
        if (activeCycle) {
          const cycleTasks = await api.listCycleTasks(activeCycle.id);
          if (!cancelled) {
            setCycleProgress({
              cycle: activeCycle,
              tasks: cycleTasks,
              done: cycleTasks.filter(s => CLOSED_STATUSES.has(s.status)).length,
              inProgress: cycleTasks.filter(s => s.status === 'in_progress').length,
              blocked: cycleTasks.filter(s => s.status === 'blocked').length,
              total: cycleTasks.length,
            });
          }
        }

        // Resolve task titles for runs
        const taskIds = [...new Set(runData.map(r => r.task_id))];
        const taskMap: Record<string, { title: string; ticket?: string }> = {};
        await Promise.all(
          taskIds.slice(0, 50).map(async id => {
            try { const s = await api.getTask(id); taskMap[id] = { title: s.title, ticket: s.ticket_number || undefined }; } catch { /* skip */ }
          })
        );

        setRuns(runData.map(r => ({
          ...r,
          taskTitle: taskMap[r.task_id]?.title || r.task_id,
          taskTicket: taskMap[r.task_id]?.ticket,
        })));
        setEvents(eventData);
      } catch (err) {
        console.error('Failed to load timeline:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ── Swimlane data ───────────────────────────────────────────────────────

  const agents = useMemo(() => {
    const map: Record<string, SwimlaneRun[]> = {};
    for (const r of runs) {
      (map[r.agent] ||= []).push(r);
    }
    // Sort agents: most runs first
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [runs]);

  const timeRange = useMemo(() => {
    if (runs.length === 0) return { min: Date.now() - 3600000, max: Date.now(), range: 3600000 };
    const now = Date.now();
    const starts = runs.map(r => toMs(r.started_at)).filter(Number.isFinite);
    const ends = runs.map(r => effectiveEnd(r, now).endMs).filter(Number.isFinite);
    const min = starts.length ? Math.min(...starts) : now - 3600000;
    const max = ends.length ? Math.max(...ends) : now;
    const range = max - min || 1;
    return { min, max, range };
  }, [runs]);

  // ── Activity stream data ────────────────────────────────────────────────

  const dayGroups = useMemo(() => {
    const groups: Record<string, TimelineEvent[]> = {};
    for (const ev of events) {
      const key = formatDate(ev.created_at);
      (groups[key] ||= []).push(ev);
    }
    return groups;
  }, [events]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted">Loading timeline...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Header + Tab switcher */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Timeline</h2>
        <div className="flex gap-1 bg-surface-high rounded-lg p-0.5">
          {(['swimlane', 'activity'] as ViewTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                tab === t ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'
              }`}
            >
              {t === 'swimlane' ? 'Swimlane' : 'Activity'}
            </button>
          ))}
        </div>
      </div>

      {/* Cycle Progress Meter */}
      {cycleProgress && (
        <div className="bg-surface rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">{cycleProgress.cycle.title}</span>
            <span className="text-xs text-muted">
              {cycleProgress.done}/{cycleProgress.total} done
              {cycleProgress.inProgress > 0 && ` · ${cycleProgress.inProgress} active`}
              {cycleProgress.blocked > 0 && ` · ${cycleProgress.blocked} blocked`}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-high overflow-hidden flex">
            {cycleProgress.done > 0 && (
              <div className="bg-success h-full" style={{ width: `${(cycleProgress.done / cycleProgress.total) * 100}%` }} />
            )}
            {cycleProgress.inProgress > 0 && (
              <div className="bg-warning h-full" style={{ width: `${(cycleProgress.inProgress / cycleProgress.total) * 100}%` }} />
            )}
            {cycleProgress.blocked > 0 && (
              <div className="bg-danger h-full" style={{ width: `${(cycleProgress.blocked / cycleProgress.total) * 100}%` }} />
            )}
          </div>
          {cycleProgress.cycle.started_at && (
            <div className="text-[10px] text-muted mt-1">
              {(Math.floor((cycleProgress.done * 10000) / cycleProgress.total) / 100).toFixed(2)}% complete
              {' · '}started {formatDate(cycleProgress.cycle.started_at)}
              {cycleProgress.done > 0 && ` · ~${formatDuration((Date.now() - toMs(cycleProgress.cycle.started_at)) / cycleProgress.done * (cycleProgress.total - cycleProgress.done))} remaining`}
            </div>
          )}
        </div>
      )}

      {/* ── Swimlane Tab ─────────────────────────────────────────────────── */}
      {tab === 'swimlane' && (
        <>
          {runs.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">No runs yet. Agent executions will appear here.</div>
          ) : (
            <div ref={containerRef} className="space-y-3">
              <div className="overflow-x-auto">
                <div className="min-w-fit">
                  {/* Agent label header row */}
                <div className="flex gap-2 mb-2">
                  <div className="w-24 shrink-0" />
                  {agents.map(([agent, agentRuns]) => (
                    <div key={agent} className="w-24 shrink-0 text-center">
                      <span className="text-xs font-medium text-foreground truncate block">@{agent}</span>
                      <span className="text-[10px] text-muted">{agentRuns.length} runs</span>
                    </div>
                  ))}
                </div>

                {/* Time axis + agent vertical tracks */}
                <div className="flex gap-2" style={{ height: '600px' }}>
                  {/* Time axis (vertical) */}
                  <div className="w-24 shrink-0 relative">
                    {[0, 0.25, 0.5, 0.75, 1].map(p => {
                      const ts = timeRange.min + p * timeRange.range;
                      return (
                        <div
                          key={p}
                          className="absolute right-2 text-[10px] text-muted whitespace-nowrap"
                          style={{ top: `${p * 100}%`, transform: p === 1 ? 'translateY(-100%)' : p === 0 ? 'translateY(0)' : 'translateY(-50%)' }}
                        >
                          {formatDate(ts)} {formatTime(ts)}
                        </div>
                      );
                    })}
                  </div>

                  {/* Agent vertical tracks */}
                  {agents.map(([agent, agentRuns]) => {
                    const now = Date.now();
                    // Pre-compute per-run derived values once (avoid O(N²) Math.max inside .map).
                    const decorated = agentRuns.map(run => {
                      const startedMs = toMs(run.started_at);
                      const eff = effectiveEnd(run, now);
                      return { run, startedMs, endMs: eff.endMs, result: eff.result, duration: eff.endMs - startedMs };
                    });
                    let longest = 0;
                    for (const d of decorated) if (d.duration > longest) longest = d.duration;
                    return (
                      <div key={agent} className="w-24 shrink-0 relative bg-surface-high/50 rounded">
                        {decorated.map(({ run, startedMs, endMs, result, duration }) => {
                          const top = ((startedMs - timeRange.min) / timeRange.range) * 100;
                          const height = Math.max(((endMs - startedMs) / timeRange.range) * 100, 0.5);
                          const colorClass = RESULT_COLORS[result] || 'bg-muted/50';
                          const isHovered = hoveredRunId === run.id;
                          const isLongest = duration === longest;

                          return (
                            <button
                              key={run.id}
                              onClick={() => onSelectTask(run.task_id)}
                              onMouseEnter={() => setHoveredRunId(run.id)}
                              onMouseLeave={() => setHoveredRunId(null)}
                              className={`absolute left-1 right-1 rounded cursor-pointer transition-all ${colorClass} ${
                                isHovered ? 'ring-2 ring-primary z-10' : ''
                              } ${isLongest && !isHovered ? 'ring-1 ring-foreground/20' : ''}`}
                              style={{ top: `${top}%`, height: `${Math.min(height, 100 - top)}%` }}
                              title={`${run.taskTitle}\n@${run.agent} · ${formatDuration(duration)} · ${result}`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>

              {/* Dependency / Blocked tasks */}
              {cycleProgress && (() => {
                const blocked = cycleProgress.tasks.filter(s => s.status === 'blocked');
                const withDeps = cycleProgress.tasks.filter(s => s.depends_on && s.depends_on.length > 0);
                if (blocked.length === 0 && withDeps.length === 0) return null;
                return (
                  <div className="mt-3 p-3 bg-surface border border-border rounded-lg">
                    {blocked.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-danger">Blocked ({blocked.length})</span>
                        {blocked.map(s => {
                          const blockers = cycleProgress.tasks.filter(b => (s.depends_on || []).includes(b.id));
                          return (
                            <div key={s.id} className="flex items-center gap-2 mt-1 text-xs">
                              <span className="text-danger">⊘</span>
                              <button onClick={() => onSelectTask(s.id)} className="text-foreground hover:text-primary cursor-pointer">
                                {s.ticket_number} {s.title}
                              </button>
                              {blockers.length > 0 && (
                                <span className="text-muted">← blocked by {blockers.map(b => b.ticket_number || b.id.slice(-6)).join(', ')}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {withDeps.length > 0 && blocked.length === 0 && (
                      <div>
                        <span className="text-xs font-medium text-muted">Dependencies ({withDeps.length} tasks with depends_on)</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Legend */}
              <div className="flex items-center gap-4 pt-3 text-[10px] text-muted">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-success/70 inline-block" /> success</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-warning/70 inline-block" /> running</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-danger/70 inline-block" /> fail</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-muted/50 inline-block" /> ended</span>
              </div>

              {/* Hovered run detail */}
              {hoveredRunId && (() => {
                const run = runs.find(r => r.id === hoveredRunId);
                if (!run) return null;
                const duration = effectiveEnd(run, Date.now()).endMs - toMs(run.started_at);
                return (
                  <div className="mt-2 p-3 bg-surface border border-border rounded-lg text-sm">
                    <div className="flex items-center gap-2">
                      {run.taskTicket && <span className="text-xs font-mono text-primary">{run.taskTicket}</span>}
                      <span className="font-medium text-foreground">{run.taskTitle}</span>
                      <span className="text-xs text-muted">@{run.agent}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                      <span>{formatDate(run.started_at)} {formatTime(run.started_at)}</span>
                      <span>→</span>
                      <span>{run.ended_at ? `${formatDate(run.ended_at)} ${formatTime(run.ended_at)}` : 'running'}</span>
                      <span>·</span>
                      <span className="font-medium">{formatDuration(duration)}</span>
                      {run.result && <span className={run.result === 'success' ? 'text-success' : 'text-muted'}>{run.result}</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* ── Activity Tab ─────────────────────────────────────────────────── */}
      {tab === 'activity' && (
        <>
          {events.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">No activity yet.</div>
          ) : (
            <div className="relative">
              <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />
              {Object.entries(dayGroups).map(([day, dayEvents]) => (
                <div key={day} className="mb-4">
                  <div className="flex items-center gap-2 mb-2 relative">
                    <div className="w-[23px] h-[23px] rounded-full bg-surface-high border border-border flex items-center justify-center z-10">
                      <span className="text-[9px] text-muted font-medium">
                        {day === 'Today' ? 'T' : day === 'Yesterday' ? 'Y' : day}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-muted">{day}</span>
                    <span className="text-[10px] text-muted">({dayEvents.length})</span>
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.map(ev => {
                      const config = EVENT_CONFIG[ev.event_type] || EVENT_CONFIG.updated;
                      const desc = describeEvent(ev);
                      return (
                        <button
                          key={ev.id}
                          onClick={() => ev.entity_type === 'task' && onSelectTask(ev.entity_id)}
                          className="w-full text-left flex items-start gap-2.5 pl-1 pr-3 py-1.5 rounded-md transition-colors hover:bg-surface-hover cursor-pointer"
                        >
                          <div className="w-[23px] flex items-center justify-center shrink-0 pt-0.5 relative z-10">
                            <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs ${config.color}`}>{config.icon}</span>
                              <span className="text-xs text-muted">{desc.action}</span>
                              <span className="text-sm text-foreground truncate">{desc.target}</span>
                            </div>
                            {desc.detail && <p className="text-xs text-muted truncate mt-0.5">{desc.detail}</p>}
                          </div>
                          <div className="shrink-0 pt-0.5">
                            <span className="text-[10px] text-muted">{formatTime(ev.created_at)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
