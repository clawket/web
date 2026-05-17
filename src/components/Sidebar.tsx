import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Project, Plan, Cycle, Unit, Task } from '../types';
import api from '../api';
import { AppShell } from './shell/AppShell';
import { BrandMark } from './shell/BrandMark';
import { ProjectSwitcher } from './shell/ProjectSwitcher';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { cn } from '../lib/cn';
import PlanTree from './PlanTree';

type SelectedItem =
  | { type: 'plan'; id: string }
  | { type: 'unit'; id: string }
  | { type: 'task'; id: string };

const SIDEBAR_WIDTH_KEY = 'clawket.sidebarWidth';
const SIDEBAR_COLLAPSED_KEY = 'clawket.sidebarCollapsed';
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;
const COLLAPSED_WIDTH = 48;

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  if (n < MIN_WIDTH) return MIN_WIDTH;
  if (n > MAX_WIDTH) return MAX_WIDTH;
  return Math.round(n);
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_WIDTH;
    return clampWidth(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_WIDTH;
  }
}

function writeStoredWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // storage unavailable — ignore
  }
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // storage unavailable — ignore
  }
}

function pickActivePlan(plans: Plan[]): Plan | null {
  return plans.find((p) => p.status === 'active') ?? plans[0] ?? null;
}

function pickActiveCycle(
  cycles: Cycle[],
  units: Unit[],
  plan: Plan | null,
): Cycle | null {
  if (!plan) {
    return cycles.find((c) => c.status === 'active') ?? null;
  }
  const planUnitIds = new Set(
    units.filter((u) => u.plan_id === plan.id).map((u) => u.id),
  );
  return (
    cycles.find(
      (c) =>
        c.status === 'active' &&
        c.unit_id != null &&
        planUnitIds.has(c.unit_id),
    ) ?? cycles.find((c) => c.status === 'active') ?? null
  );
}

interface SidebarProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Opens the ProjectCreateModal owned by App. */
  onOpenProjectCreate: () => void;
  /** Fired after the active project is edited via ProjectSettingsModal. App
   *  uses this to refresh the projects[] state in place. */
  onProjectUpdated: (project: Project) => void;
  /** Bumps when SSE structural events fire so the active context refreshes. */
  refreshKey?: number;
  /** PlanTree selection — currently focused plan / unit / task in the tree. */
  selectedItem: SelectedItem | null;
  onSelectItem: (item: SelectedItem | null) => void;
  onCreatePlan: () => void;
  onCreateUnit: (planId: string) => void;
  onCreateTask: (unitId: string) => void;
  /** SSE delta buffer forwarded to PlanTree for in-place row patching. */
  taskPatches?: Map<string, Task | null>;
}

export default function Sidebar({
  projects,
  selectedId,
  onSelect,
  onOpenProjectCreate,
  onProjectUpdated,
  refreshKey = 0,
  selectedItem,
  onSelectItem,
  onCreatePlan,
  onCreateUnit,
  onCreateTask,
  taskPatches,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed);
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [activeContext, setActiveContext] = useState<{
    projectId: string;
    plan: Plan | null;
    cycle: Cycle | null;
  } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    Promise.all([
      api.listPlans({ project_id: selectedId }),
      api.listCycles({ project_id: selectedId }),
      api.listUnits(),
    ])
      .then(([plans, cycles, units]) => {
        if (cancelled) return;
        const plan = pickActivePlan(plans);
        const planUnits = units.filter(
          (u) => plan && u.plan_id === plan.id,
        );
        setActiveContext({
          projectId: selectedId,
          plan,
          cycle: pickActiveCycle(cycles, planUnits, plan),
        });
      })
      .catch((err) => {
        console.error('Sidebar: failed to load active context:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  const contextMatches =
    activeContext !== null && activeContext.projectId === selectedId;
  const activePlan = contextMatches ? activeContext.plan : null;
  const activeCycle = contextMatches ? activeContext.cycle : null;

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('pointermove', moveHandlerRef.current);
        moveHandlerRef.current = null;
      }
      if (upHandlerRef.current) {
        window.removeEventListener('pointerup', upHandlerRef.current);
        upHandlerRef.current = null;
      }
    };
  }, []);

  function onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setWidth(clampWidth(drag.startWidth + (ev.clientX - drag.startX)));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (moveHandlerRef.current) {
        window.removeEventListener('pointermove', moveHandlerRef.current);
        moveHandlerRef.current = null;
      }
      if (upHandlerRef.current) {
        window.removeEventListener('pointerup', upHandlerRef.current);
        upHandlerRef.current = null;
      }
      setWidth((w) => {
        writeStoredWidth(w);
        return w;
      });
    };

    moveHandlerRef.current = onMove;
    upHandlerRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  if (collapsed) {
    return (
      <AppShell.Sidebar
        data-testid="app-sidebar"
        data-collapsed="true"
        className="overflow-visible"
        style={{ width: `${COLLAPSED_WIDTH}px` }}
      >
        <div className="h-12 shrink-0 flex items-center justify-center border-b border-border">
          <button
            type="button"
            onClick={toggleCollapse}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="p-1 text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <BrandMark size={20} />
          </button>
        </div>
        <nav
          aria-label="Projects"
          className="flex-1 overflow-y-auto py-2 space-y-1"
        >
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              title={p.name}
              className={cn(
                'w-full flex justify-center py-2 transition-colors cursor-pointer',
                selectedId === p.id
                  ? 'text-primary bg-primary/15'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover',
              )}
            >
              <span className="text-xs font-bold">
                {p.name.charAt(0).toUpperCase()}
              </span>
            </button>
          ))}
        </nav>
      </AppShell.Sidebar>
    );
  }

  return (
    <AppShell.Sidebar
      data-testid="app-sidebar"
      data-width={width}
      className="relative overflow-visible"
      style={{ width: `${width}px` }}
    >
      <header
        className={cn(
          'shrink-0',
          'flex flex-col',
          'border-b border-border',
        )}
      >
        <div className="h-12 shrink-0 flex items-center gap-2 px-3">
          <BrandMark size={24} className="shrink-0" />
          <span
            data-testid="sidebar-brand-name"
            className="shrink-0 text-sm font-semibold text-foreground"
          >
            Clawket
          </span>
          <span className="flex-1" />
          <span className="shrink-0 text-xs text-muted">v3.0</span>
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="shrink-0 text-xs text-muted hover:text-foreground transition-colors cursor-pointer px-1"
          >
            {'◀'}
          </button>
        </div>
        <div className="h-10 shrink-0 flex items-center gap-1 px-3 pb-2">
          <ProjectSwitcher
            projects={projects}
            activeProjectId={selectedId}
            onSelect={onSelect}
            onCreateProject={onOpenProjectCreate}
            fallbackLabel={activeProject ? activeProject.name : 'Select project'}
          />
          {activeProject && (
            <button
              type="button"
              data-testid="sidebar-project-settings"
              onClick={() => setSettingsOpen(true)}
              title="Project settings"
              aria-label="Project settings"
              className="shrink-0 text-xs text-muted hover:text-foreground transition-colors cursor-pointer px-1"
            >
              ⚙
            </button>
          )}
        </div>
      </header>

      <section
        className="flex flex-col gap-1 border-b border-border px-4 py-3"
        aria-label="Active context"
      >
        <p className="text-xs uppercase tracking-wide text-muted">Active</p>
        {activePlan ? (
          <>
            <p
              data-testid="sidebar-active-plan"
              className="text-sm font-medium text-foreground truncate"
              title={activePlan.title}
            >
              {activePlan.title}
            </p>
            <p
              data-testid="sidebar-active-cycle"
              className="text-xs text-muted truncate"
              title={activeCycle?.title}
            >
              {activeCycle ? `Cycle: ${activeCycle.title}` : 'No active cycle'}
            </p>
          </>
        ) : (
          <p
            data-testid="sidebar-active-plan"
            className="text-sm text-muted italic"
          >
            {selectedId ? 'No active plan' : 'Select a project'}
          </p>
        )}
      </section>

      <nav
        aria-label="Plan tree"
        className="min-h-0 flex-1 overflow-auto"
      >
        {selectedId ? (
          <PlanTree
            key={`plantree-${selectedId}-${refreshKey}`}
            projectId={selectedId}
            selectedItem={selectedItem}
            onSelectItem={onSelectItem}
            onCreatePlan={onCreatePlan}
            onCreateUnit={onCreateUnit}
            onCreateTask={onCreateTask}
            taskPatches={taskPatches}
          />
        ) : (
          <div className="px-4 py-6 text-center text-muted text-sm">
            {projects.length === 0 ? 'No projects yet' : 'Select a project'}
          </div>
        )}
      </nav>

      <div
        data-testid="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onHandlePointerDown}
        className={cn(
          'absolute right-0 top-0 h-full w-1.5 translate-x-1/2 z-10',
          'cursor-col-resize',
          'hover:bg-primary/40',
        )}
      />
      {settingsOpen && activeProject && (
        <ProjectSettingsModal
          project={activeProject}
          onClose={() => setSettingsOpen(false)}
          onUpdated={(next) => {
            onProjectUpdated(next);
            setSettingsOpen(false);
          }}
        />
      )}
    </AppShell.Sidebar>
  );
}
