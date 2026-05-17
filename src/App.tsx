import { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router';
import type { Project, Task, Plan } from './types';
import api from './api';
import Sidebar from './components/Sidebar';
import { AppShell } from './components/shell/AppShell';
import TaskDetail from './components/TaskDetail';
import UnitDetail from './components/UnitDetail';
import PlanDetail from './components/PlanDetail';
import CreateUnitModal from './components/CreateUnitModal';
import CreateTaskModal from './components/CreateTaskModal';
import CreatePlanModal from './components/CreatePlanModal';
import ProjectCreateModal from './components/ProjectCreateModal';
import BoardView from './components/BoardView';
import BacklogView from './components/BacklogView';
import SummaryView from './components/SummaryView';
import TimelineView from './components/TimelineView';
import WikiView from './components/WikiView';
import { Topbar } from './components/shell/Topbar';
import CommandPalette, { type CommandItem } from './components/CommandPalette';
import HelpModal from './components/HelpModal';
import ToastContainer from './components/Toast';
import { useDaemonHealth } from './hooks/useDaemonHealth';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { initTheme, getStoredTheme, setTheme, getCurrentEffectiveTheme, type Theme } from './lib/theme';
import { toastError, toastSuccess } from './lib/toast';
import { daemonUrl } from './lib/daemonUrl';

type ViewType = 'summary' | 'board' | 'backlog' | 'timeline' | 'wiki';
type SelectedItem =
  | { type: 'plan'; id: string }
  | { type: 'unit'; id: string }
  | { type: 'task'; id: string };

/** Parse the current URL pathname into project + view + optional detail item.
 *  URL format: /{projectId}/{view}  or  /{projectId}/{view}/{type}/{id}
 *  Legacy:     /{view}  (no project — uses selected project)
 *  Examples: /PROJ-xxx/plans, /PROJ-xxx/board/task/TASK-xxx
 */
function parseLocation(pathname: string): { projectId: string | null; view: ViewType; item: SelectedItem | null } {
  const parts = pathname.split('/').filter(Boolean);
  const VIEWS = new Set<ViewType>(['summary', 'board', 'backlog', 'timeline', 'wiki']);

  // Check if first part is a project ID (starts with PROJ-)
  let projectId: string | null = null;
  let viewParts = parts;

  if (parts.length > 0 && parts[0].startsWith('PROJ-')) {
    projectId = parts[0];
    viewParts = parts.slice(1);
  }

  const view: ViewType = (VIEWS.has(viewParts[0] as ViewType) ? viewParts[0] : 'summary') as ViewType;

  // Detail: /{view}/{type}/{id}
  if (viewParts.length >= 3) {
    const [, type, id] = viewParts;
    if (type === 'task' || type === 'unit' || type === 'plan') {
      return { projectId, view, item: { type, id } };
    }
  }

  return { projectId, view, item: null };
}

// ---------------------------------------------------------------------------
// SSE incremental patch reducer (FIX-WEB-002)
// ---------------------------------------------------------------------------
//
// v3 SSE payload contract (US-CLAWKET-WEB-SSE-002 / WEB-PLAN-005 / WEB-CNT-003 /
// WEB-TIME-005). The daemon (FIX-DAEMON-102) injects four structured fields
// into every event payload regardless of `event:` name:
//
//   { entity_type: "task" | "cycle" | "unit" | "plan" | "knowledge" | "comment",
//     change_type: "created" | "updated" | "deleted" | "started" | ...,
//     event_id:    monotonic u64,           // pairs with the SSE `id:` field
//     ts:          unix-ms server timestamp,
//     ...entity-specific fields (id, status, …) }
//
// Some events also carry a `fields` array listing which columns changed; the
// reducer uses it to decide whether a task-level patch is enough or a structural
// re-render is required. When `fields` is absent (older daemons), we fall back
// to "any update is patchable for tasks, otherwise structural".

/** The minimal envelope we trust to be present on every SSE payload. */
interface SseEvent {
  entity_type?: string;
  change_type?: string;
  event_id?: number;
  ts?: number;
  fields?: string[];
  // Entity-specific keys are layered on top (id, status, unit_id, …).
  [key: string]: unknown;
}

type SseAction =
  | { type: 'task:patch'; payload: Task; fields?: string[] }
  | { type: 'task:delete'; payload: { id: string } }
  | { type: 'structural' };  // unit/plan/cycle/knowledge events → trigger refresh

interface SseState {
  /** Patch sequence for views: incremented on task-level events so views
   *  can decide if they need to re-fetch. Unlike treeKey (always full
   *  reload), task patches are applied in-place by PlanTree. */
  structuralSeq: number;
  /** Task-level delta buffer: keyed by task id, value = latest known task
   *  or null (deleted). Components read from here first, then fall back
   *  to their own fetch results. */
  taskPatches: Map<string, Task | null>;
  /** WEB-SSE-002 — last set of changed columns surfaced by the daemon's
   *  `fields[]` envelope. Views (BoardView, TimelineView) gate counter
   *  recomputation on this, e.g. only re-tally when status flipped. */
  lastFields: string[];
  /** Monotonic patch counter — bumped on every task:patch / task:delete.
   *  Views key their effects off this rather than `taskPatches.length`
   *  (which is misleading because the Map updates in place). */
  patchSeq: number;
}

const SSE_INITIAL: SseState = {
  structuralSeq: 0,
  taskPatches: new Map(),
  lastFields: [],
  patchSeq: 0,
};

function sseReducer(state: SseState, action: SseAction): SseState {
  switch (action.type) {
    case 'task:patch': {
      const patches = new Map(state.taskPatches);
      patches.set(action.payload.id, action.payload);
      return {
        ...state,
        taskPatches: patches,
        lastFields: action.fields ?? [],
        patchSeq: state.patchSeq + 1,
      };
    }
    case 'task:delete': {
      const patches = new Map(state.taskPatches);
      patches.set(action.payload.id, null);
      return {
        ...state,
        taskPatches: patches,
        lastFields: ['_deleted'],
        patchSeq: state.patchSeq + 1,
      };
    }
    case 'structural':
      return { ...state, structuralSeq: state.structuralSeq + 1 };
    default:
      return state;
  }
}

/** Last-Event-ID persistence — survives reloads and reconnects so the daemon
 *  replay endpoint can fill the gap (US-CLAWKET-WEB-SSE-002).
 *  Native EventSource exposes the last received id via `MessageEvent.lastEventId`
 *  but does not let callers send arbitrary headers; we therefore replay via the
 *  `?last=` query param the daemon honors. */
const LAST_EVENT_ID_KEY = 'clawket.sse.lastEventId';

function readLastEventId(): string | null {
  try {
    return localStorage.getItem(LAST_EVENT_ID_KEY);
  } catch {
    return null;
  }
}

function writeLastEventId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_EVENT_ID_KEY, id);
  } catch { /* storage quota / private mode — ignore */ }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sseState, dispatchSse] = useReducer(sseReducer, SSE_INITIAL);
  // Legacy key for views that still mount-fresh on structural change
  const treeKey = sseState.structuralSeq;

  // Derive project, view, and selected item from URL
  const { projectId: urlProjectId, view: activeView, item: selectedItem } = parseLocation(location.pathname);

  // Sync URL project with selected project (avoid setState in effect)
  if (urlProjectId && urlProjectId !== selectedProjectId) {
    setSelectedProjectId(urlProjectId);
  }

  // Build URL prefix with project
  const urlPrefix = selectedProjectId ? `/${selectedProjectId}` : '';

  // Navigation helpers
  const setActiveView = useCallback((view: ViewType) => {
    navigate(`${urlPrefix}/${view}`);
  }, [navigate, urlPrefix]);

  const setSelectedItem = useCallback((item: SelectedItem | null) => {
    if (!item) {
      navigate(`${urlPrefix}/${activeView}`);
    } else {
      navigate(`${urlPrefix}/${activeView}/${item.type}/${item.id}`);
    }
  }, [navigate, activeView, urlPrefix]);

  // Redirect root to /summary (or /:projectId/summary), and legacy /plans → /summary
  // (Plans view was promoted to the sidebar PlanTree in U3-T1; the URL segment is
  // preserved as a back-compat shim so bookmarks and the SSE-restored "last view"
  // localStorage value don't 404. Task/unit/plan drawer ids in the path tail
  // are preserved.)
  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/summary', { replace: true });
      return;
    }
    const parts = location.pathname.split('/').filter(Boolean);
    const viewIdx = parts[0]?.startsWith('PROJ-') ? 1 : 0;
    if (parts[viewIdx] === 'plans') {
      const rewritten = [...parts];
      rewritten[viewIdx] = 'summary';
      navigate('/' + rewritten.join('/'), { replace: true });
    }
  }, [location.pathname, navigate]);

  // Drawer resize state
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = localStorage.getItem('clawket-drawer-width');
    return saved ? parseInt(saved, 10) : 520;
  });
  const isResizing = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(360, Math.min(window.innerWidth * 0.9, window.innerWidth - e.clientX));
      setDrawerWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('clawket-drawer-width', String(drawerWidth));
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [drawerWidth]);

  function startResize() {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // Modal state
  const [createPlanForProject, setCreatePlanForProject] = useState<string | null>(null);
  const [createUnitForPlan, setCreateUnitForPlan] = useState<string | null>(null);
  const [createTaskForUnit, setCreateTaskForUnit] = useState<string | null>(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listProjects().then((list) => {
      if (cancelled) return;
      setProjects(list);
      if (list.length > 0) {
        setSelectedProjectId((prev) => prev ?? list[0].id);
      }
    }).catch((err) => {
      console.error('Failed to load projects:', err);
    });
    return () => { cancelled = true; };
  }, []);

  // Initialize theme listener on mount (FIX-WEB-001)
  useEffect(() => {
    return initTheme();
  }, []);

  // SSE: real-time updates — incremental patching (FIX-WEB-002, FIX-WEB-SSE-V3)
  // Replaces the old setTreeKey(k+1) full-reload pattern.
  const sseRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(readLastEventId());
  const sseHasConnectedRef = useRef(false);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [sseLastEventTs, setSseLastEventTs] = useState<number>(Date.now());

  /** Route a single decoded SSE event to the reducer. Branches on
   *  `entity_type` (the prefix daemon ships) — we no longer need an
   *  exhaustive listener per event name. */
  const routeEvent = useCallback((eventName: string, raw: string, lastEventId?: string) => {
    setSseLastEventTs(Date.now());
    if (lastEventId) {
      lastEventIdRef.current = lastEventId;
      writeLastEventId(lastEventId);
    }
    let payload: SseEvent;
    try { payload = JSON.parse(raw) as SseEvent; } catch { return; }

    // Daemon may not always inject entity_type/change_type (e.g. ping events,
    // older daemons). Fall back to splitting the event name on ':'.
    let entityType = payload.entity_type;
    let changeType = payload.change_type;
    if (!entityType || !changeType) {
      const colon = eventName.indexOf(':');
      if (colon > 0) {
        entityType = entityType ?? eventName.slice(0, colon);
        changeType = changeType ?? eventName.slice(colon + 1);
      }
    }
    if (!entityType) return;

    if (entityType === 'task') {
      // US-CLAWKET-WEB-SSE-002 — daemon may ship the canonical id under either
      // `id` (legacy) or `entity_id` (post-FIX-DAEMON-102). Accept both so the
      // reducer is robust during the rollout window.
      const eid = typeof payload.entity_id === 'string'
        ? payload.entity_id
        : (typeof payload.id === 'string' ? payload.id : undefined);

      if (changeType === 'deleted') {
        if (eid) dispatchSse({ type: 'task:delete', payload: { id: eid } });
        return;
      }
      // For task created/updated/started/done/cancelled, the daemon ships the
      // full Task row; treat any non-delete change as a patch. The reducer
      // overwrites the prior patch in PlanTree. We surface the daemon's
      // `fields[]` so downstream views (board/timeline) can decide whether
      // a counter recomputation is needed.
      const task = payload as unknown as Task;
      // Synthesize `id` from entity_id when only the alias was sent.
      if (!task.id && eid) (task as Task).id = eid;
      const fields = Array.isArray(payload.fields) ? payload.fields : undefined;
      if (typeof task.id === 'string' && typeof task.unit_id === 'string') {
        dispatchSse({ type: 'task:patch', payload: task, fields });
      } else {
        dispatchSse({ type: 'structural' });
      }
      return;
    }

    // Non-task entities (unit / plan / cycle / knowledge / comment) currently
    // require a structural refresh — we don't yet patch their subtrees in
    // place. Ping events (entity_type unknown) are ignored.
    if (entityType === 'unit' || entityType === 'plan' || entityType === 'cycle' ||
        entityType === 'knowledge' || entityType === 'comment') {
      dispatchSse({ type: 'structural' });
    }
  }, []);

  const connectSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    setSseStatus(sseHasConnectedRef.current ? 'reconnecting' : 'connecting');

    // Replay strategy (US-CLAWKET-WEB-SSE-002):
    // 1. The browser-native EventSource sends the `Last-Event-ID` header on
    //    auto-reconnect when the previous response set `id:` fields — and
    //    the daemon does set them (see daemon/src/routes/events.rs:69).
    // 2. We additionally persist the last event id to localStorage so a fresh
    //    page load can pass it via `?last_event_id=` for the daemon to seed
    //    its broadcast cursor (FIX-DAEMON-102 records but does not yet
    //    actively replay; preserves forward-compat as the daemon catches up).
    const last = lastEventIdRef.current;
    const path = last ? `/events?last_event_id=${encodeURIComponent(last)}` : '/events';
    // EventSource bypasses the Vite proxy by hitting the daemon origin
    // directly in dev (see lib/daemonUrl). Vite proxy buffers SSE chunks,
    // which would leave readyState stuck at CONNECTING.
    const es = new EventSource(daemonUrl(path));
    sseRef.current = es;

    es.onopen = () => {
      sseHasConnectedRef.current = true;
      setSseStatus('connected');
      setSseLastEventTs(Date.now());
    };

    // Generic listeners for every entity:change combination the daemon emits.
    // We can't `addEventListener('*')`, so register one per known event name
    // and dispatch through routeEvent.
    const events = [
      'task:created', 'task:updated', 'task:deleted',
      'task:started', 'task:done', 'task:cancelled',
      'unit:created', 'unit:updated', 'unit:deleted',
      'plan:created', 'plan:updated', 'plan:deleted',
      'cycle:created', 'cycle:updated', 'cycle:deleted',
      'knowledge:created', 'knowledge:updated', 'knowledge:deleted',
      'comment:created', 'comment:deleted',
    ];
    for (const name of events) {
      es.addEventListener(name, (e: MessageEvent) => routeEvent(name, e.data, e.lastEventId));
    }
    // Default `message` channel — fallback when daemon ships unnamed events
    es.onmessage = (e: MessageEvent) => routeEvent('message', e.data, e.lastEventId);
    // Daemon keepalive: a `ping` event fires every 30s while idle. It carries
    // no payload and is not a data update, but it proves the connection is
    // alive — refresh the lag clock so the header doesn't flap to "Lagging"
    // every 2 seconds while the user is just sitting on the page.
    es.addEventListener('ping', () => setSseLastEventTs(Date.now()));

    es.onerror = () => {
      // Browser will auto-reconnect. Surface degraded state to the Header.
      // After the first successful open, label this as "reconnecting" rather
      // than the initial "connecting".
      setSseStatus(sseHasConnectedRef.current ? 'reconnecting' : 'disconnected');
    };

    return es;
  }, [routeEvent]);

  useEffect(() => {
    connectSse();
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [connectSse]);

  // Daemon health (FIX-WEB-003)
  const { connected: daemonConnected, reconnect: reconnectDaemon } = useDaemonHealth({
    onStatusChange: (ok) => {
      if (!ok) toastError('Daemon disconnected. Trying to reconnect…');
      else toastSuccess('Daemon reconnected.');
    },
  });

  // Daemon "lagging" detection — flag the connection as stale when neither
  // a domain event nor a keepalive `ping` has arrived recently. Daemon
  // keepalive cadence is 30s (events.rs KeepAlive::interval), so the
  // threshold must clear that interval comfortably; otherwise the badge
  // flaps to "Lagging" between every ping while the daemon is idle.
  const LAG_THRESHOLD_MS = 35_000;
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => {
    if (sseStatus !== 'connected') return;
    const handle = setInterval(() => setHealthTick(t => t + 1), 5000);
    return () => clearInterval(handle);
  }, [sseStatus]);

  const lagging = useMemo(() => {
    if (sseStatus !== 'connected') return false;
    return Date.now() - sseLastEventTs > LAG_THRESHOLD_MS;
    // healthTick is intentionally referenced indirectly to retrigger the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sseStatus, sseLastEventTs, healthTick]);

  // Reconnect SSE when daemon comes back
  const prevConnectedRef = useRef(daemonConnected);
  useEffect(() => {
    if (!prevConnectedRef.current && daemonConnected) {
      connectSse();
    }
    prevConnectedRef.current = daemonConnected;
  }, [daemonConnected, connectSse]);

  function handleSelectProject(id: string) {
    setSelectedProjectId(id);
    navigate(`/${id}/${activeView}`);
  }

  function handleProjectCreated(project: Project) {
    setProjects((prev) => [...prev, project]);
    setSelectedProjectId(project.id);
    navigate(`/${project.id}/${activeView}`);
  }

  function handleProjectUpdated(project: Project) {
    setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
  }

  function handleCreated() {
    dispatchSse({ type: 'structural' });
  }

  const handleReconnect = useCallback(() => {
    reconnectDaemon();
    connectSse();
  }, [reconnectDaemon, connectSse]);

  // ---- Global keyboard shortcuts (US-CLAWKET-WEB-KEY-001 / KEY-002) -------
  // Cmd/Ctrl+K → command palette.
  // ?           → HelpModal cheatsheet.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen(o => !o), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useGlobalShortcuts({ onPalette: togglePalette, onHelp: openHelp });

  // Command palette built-in commands. Theme cycling is the single built-in
  // shipped with v3 (US-CLAWKET-WEB-KEY-001); domain commands are layered on
  // by view-specific components via extraCommands once that wiring lands.
  const [themePref, setThemePref] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    const update = () => setThemePref(getStoredTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    window.addEventListener('storage', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const cycleTheme = useCallback(() => {
    const order: Theme[] = ['system', 'dark', 'light'];
    const next = order[(order.indexOf(themePref) + 1) % order.length];
    setTheme(next);
    setThemePref(next);
  }, [themePref]);
  // Plans for the currently selected project — surfaced as palette nav targets.
  // Refreshed on project change and on SSE structural events (plan:created /
  // updated / deleted) so the palette never advertises stale entries.
  const [palettePlans, setPalettePlans] = useState<Plan[]>([]);
  useEffect(() => {
    if (!selectedProjectId) { setPalettePlans([]); return; }
    let cancelled = false;
    api.listPlans({ project_id: selectedProjectId })
      .then((plans) => { if (!cancelled) setPalettePlans(plans); })
      .catch(() => { if (!cancelled) setPalettePlans([]); });
    return () => { cancelled = true; };
  }, [selectedProjectId, sseState.structuralSeq]);

  const goToView = useCallback((view: ViewType) => {
    navigate(`${urlPrefix}/${view}`);
  }, [navigate, urlPrefix]);
  const goToPlan = useCallback((planId: string) => {
    navigate(`${urlPrefix}/${activeView}/plan/${planId}`);
  }, [navigate, urlPrefix, activeView]);

  const builtinCommands: CommandItem[] = useMemo(() => {
    const effective = getCurrentEffectiveTheme();
    const views: Array<{ id: ViewType; label: string; icon: string }> = [
      { id: 'summary',  label: 'Go to Summary',  icon: '◇' },
      { id: 'board',    label: 'Go to Board',    icon: '▦' },
      { id: 'backlog',  label: 'Go to Backlog',  icon: '☰' },
      { id: 'timeline', label: 'Go to Timeline', icon: '⌚' },
      { id: 'wiki',     label: 'Go to Wiki',     icon: '📖' },
    ];
    const viewCommands: CommandItem[] = views.map((v) => ({
      id: `view-${v.id}`,
      label: v.label,
      description: v.id === activeView ? 'Current view' : undefined,
      icon: v.icon,
      action: () => goToView(v.id),
    }));
    const planCommands: CommandItem[] = palettePlans.map((p) => ({
      id: `plan-${p.id}`,
      label: `Open plan: ${p.title}`,
      description: p.status === 'active' ? 'Active' : p.status,
      icon: '◎',
      action: () => goToPlan(p.id),
    }));
    return [
      {
        id: 'theme-cycle',
        label: 'Toggle theme',
        description: `Current: ${themePref} (${effective})`,
        icon: effective === 'dark' ? '◑' : '○',
        action: cycleTheme,
      },
      ...viewCommands,
      ...planCommands,
    ];
  }, [themePref, cycleTheme, activeView, goToView, palettePlans, goToPlan]);

  // Daemon-ok pill in Topbar reflects both HTTP health and SSE liveness.
  const daemonHealthy = daemonConnected && sseStatus === 'connected' && !lagging;

  return (
    <AppShell.Root>
      <Sidebar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={handleSelectProject}
        onOpenProjectCreate={() => setProjectCreateOpen(true)}
        onProjectUpdated={handleProjectUpdated}
        refreshKey={sseState.structuralSeq}
        selectedItem={selectedItem}
        onSelectItem={setSelectedItem}
        onCreatePlan={() => {
          if (selectedProjectId) setCreatePlanForProject(selectedProjectId);
        }}
        onCreateUnit={setCreateUnitForPlan}
        onCreateTask={setCreateTaskForUnit}
        taskPatches={sseState.taskPatches}
      />

      {/* Content column = topbar + main view */}
      <AppShell.Content>
        <Topbar
          activeView={activeView}
          onViewChange={setActiveView}
          onOpenPalette={togglePalette}
          daemonHealthy={daemonHealthy}
          onReconnect={handleReconnect}
        />
        <AppShell.Main>
          {/* US-CLAWKET-WEB-EMPTY-004 — daemon down: replace blank canvas
              with an explanatory empty state + reconnect CTA. Topbar's
              daemon-down pill stays visible so the reconnect signal is
              always present. */}
          {!daemonConnected ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-sm text-center px-6">
                <div className="text-3xl mb-3" aria-hidden="true">⚠</div>
                <h2 className="text-base font-semibold text-foreground mb-2">
                  Daemon offline
                </h2>
                <p className="text-sm text-muted leading-relaxed mb-4">
                  Clawket can't reach the local daemon. Start it with
                  {' '}<code className="font-mono text-foreground bg-surface-high px-1.5 py-0.5 rounded">clawket daemon start</code>
                  {' '}or click reconnect below.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={handleReconnect}
                    className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={openHelp}
                    className="text-xs px-2 py-1.5 text-muted hover:text-foreground cursor-pointer"
                    title="Show help"
                    aria-label="Show help"
                  >
                    ?
                  </button>
                </div>
              </div>
            </div>
          ) : selectedProjectId ? (
            <>
              {activeView === 'summary' && (
                <SummaryView
                  key={`summary-${selectedProjectId}-${treeKey}`}
                  projectId={selectedProjectId}
                  onSelectTask={(id) => setSelectedItem({ type: 'task', id })}
                />
              )}
              {activeView === 'board' && (
                <BoardView
                  // US-CLAWKET-WEB-CNT-003: re-render on every task patch so
                  // column counts recompute without waiting for a structural
                  // refresh. patchSeq increments on task:patch + task:delete.
                  key={`board-${selectedProjectId}-${treeKey}-${sseState.patchSeq}`}
                  projectId={selectedProjectId}
                  onSelectTask={(id) => setSelectedItem({ type: 'task', id })}
                  taskPatches={sseState.taskPatches}
                />
              )}
              {activeView === 'backlog' && (
                <BacklogView
                  key={`backlog-${selectedProjectId}-${treeKey}-${sseState.patchSeq}`}
                  projectId={selectedProjectId}
                  onSelectTask={(id) => setSelectedItem({ type: 'task', id })}
                />
              )}
              {activeView === 'timeline' && (
                <TimelineView
                  // US-CLAWKET-WEB-TIME-005: re-render on every task patch so
                  // the swimlane and activity stream pick up status flips
                  // without a full structural reload.
                  key={`timeline-${selectedProjectId}-${treeKey}-${sseState.patchSeq}`}
                  projectId={selectedProjectId}
                  onSelectTask={(id) => setSelectedItem({ type: 'task', id })}
                  taskPatches={sseState.taskPatches}
                />
              )}
              {activeView === 'wiki' && (
                <WikiView key={`wiki-${selectedProjectId}-${treeKey}`} projectId={selectedProjectId} />
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-muted">
              <div className="text-center">
                <div className="text-2xl mb-2">Clawket</div>
                <div className="text-sm">Select a project to get started</div>
              </div>
            </div>
          )}
        </AppShell.Main>
      </AppShell.Content>

      {/* Detail drawer (overlay) */}
      {selectedItem && (
        <>
          <div
            className="fixed inset-0 bg-overlay z-40 transition-opacity"
            onClick={() => setSelectedItem(null)}
          />
          <div
            className="fixed top-0 right-0 h-full max-w-[90vw] z-50 shadow-2xl border-l border-border animate-slide-in flex"
            style={{ width: `${drawerWidth}px` }}
          >
            {/* Resize handle */}
            <div
              className="w-1 hover:w-1.5 cursor-col-resize bg-transparent hover:bg-primary/30 transition-colors shrink-0"
              onMouseDown={startResize}
            />
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              {selectedItem.type === 'task' && (
                <TaskDetail
                  taskId={selectedItem.id}
                  projectId={selectedProjectId ?? undefined}
                  onClose={() => setSelectedItem(null)}
                  onSelectTask={(id) => setSelectedItem({ type: 'task', id })}
                  onSelectItem={(item) => setSelectedItem(item)}
                />
              )}
              {selectedItem.type === 'unit' && (
                <UnitDetail
                  unitId={selectedItem.id}
                  onClose={() => setSelectedItem(null)}
                  onSelectItem={(item) => setSelectedItem(item)}
                />
              )}
              {selectedItem.type === 'plan' && (
                <PlanDetail
                  planId={selectedItem.id}
                  onClose={() => setSelectedItem(null)}
                  onSelectItem={(item) => setSelectedItem(item)}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      {createPlanForProject && (
        <CreatePlanModal
          projectId={createPlanForProject}
          onClose={() => setCreatePlanForProject(null)}
          onCreated={handleCreated}
        />
      )}
      {createUnitForPlan && (
        <CreateUnitModal
          planId={createUnitForPlan}
          onClose={() => setCreateUnitForPlan(null)}
          onCreated={handleCreated}
        />
      )}
      {createTaskForUnit && (
        <CreateTaskModal
          unitId={createTaskForUnit}
          onClose={() => setCreateTaskForUnit(null)}
          onCreated={handleCreated}
        />
      )}
      {projectCreateOpen && (
        <ProjectCreateModal
          onClose={() => setProjectCreateOpen(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {/* Global toast container (FIX-WEB-001) */}
      <ToastContainer />

      {/* US-CLAWKET-WEB-KEY-001 — global help cheatsheet (toggled by '?'). */}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Command palette (Cmd+K) — global modal, mounted at root */}
      <CommandPalette
        commands={builtinCommands}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </AppShell.Root>
  );
}

export default App;
