import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, Plan, Cycle } from '../types';
import { getStoredTheme, setTheme, getCurrentEffectiveTheme, type Theme } from '../lib/theme';
import { getStoredToken } from '../lib/auth';
import CommandPalette, { type CommandItem } from './CommandPalette';

/** SSE connection state — distinct from daemon HTTP health.
 *  - connecting:    initial attempt, never opened yet
 *  - connected:     stream open, events flowing
 *  - reconnecting:  was connected, now retrying
 *  - disconnected:  initial attempt failed and never recovered */
export type SseStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface HeaderProps {
  /** Daemon HTTP /health roundtrip — orthogonal to SSE liveness. */
  daemonConnected: boolean;
  /** Live SSE stream state surfaced by App.tsx's connectSse machinery. */
  sseStatus: SseStatus;
  /** True when SSE is open but no event has arrived in >2s — daemon may be
   *  pinned, the broadcaster is starved, or a proxy is buffering. */
  lagging: boolean;
  onReconnect?: () => void;
  activeProject?: Project | null;
  activePlan?: Plan | null;
  activeCycle?: Cycle | null;
  extraCommands?: CommandItem[];
  /** US-CLAWKET-WEB-KEY-002 — when provided, the palette state is controlled
   *  by App.tsx via `useGlobalShortcuts`. Header still owns the toolbar
   *  button; clicking it calls `onPaletteOpen()`. Falls back to internal
   *  state when these props are omitted (kept for unit-test back-compat). */
  paletteOpen?: boolean;
  onPaletteOpenChange?: (open: boolean) => void;
}

const THEME_LABELS: Record<Theme, string> = {
  dark: '◑ Dark',
  light: '○ Light',
  system: '◐ System',
};

/** Derive the (color, label, title) tuple for the connection indicator.
 *  Three colors in v3 (US-CLAWKET-WEB-NAV-009):
 *  - green:  daemon ok + SSE connected and not lagging
 *  - yellow: daemon ok + SSE connected but lagging (>2s no events) OR reconnecting
 *  - red:    daemon disconnected OR SSE disconnected */
function connectionIndicator(daemonConnected: boolean, sseStatus: SseStatus, lagging: boolean): {
  tone: 'green' | 'yellow' | 'red';
  label: string;
  title: string;
} {
  if (!daemonConnected) {
    return { tone: 'red', label: 'reconnecting…', title: 'Daemon offline — click to reconnect' };
  }
  if (sseStatus === 'disconnected') {
    return { tone: 'red', label: 'reconnecting…', title: 'SSE stream offline — click to reconnect' };
  }
  if (sseStatus === 'connecting') {
    return { tone: 'yellow', label: 'Connecting…', title: 'Establishing SSE stream' };
  }
  if (sseStatus === 'reconnecting') {
    return { tone: 'yellow', label: 'Reconnecting…', title: 'SSE stream dropped — auto-retrying' };
  }
  if (lagging) {
    return { tone: 'yellow', label: 'Lagging', title: 'No SSE events received in >2s' };
  }
  return { tone: 'green', label: 'Connected', title: 'Daemon connected, SSE live' };
}

const TONE_CLASSES: Record<'green' | 'yellow' | 'red', { wrap: string; dot: string }> = {
  green:  { wrap: 'border-success/30 text-success bg-success/5 cursor-default',
            dot:  'bg-success animate-pulse' },
  yellow: { wrap: 'border-warning/40 text-warning bg-warning/5',
            dot:  'bg-warning animate-pulse' },
  red:    { wrap: 'border-danger/40 text-danger bg-danger/5 hover:bg-danger/10',
            dot:  'bg-danger animate-pulse' },
};

export default function Header({
  daemonConnected,
  sseStatus,
  lagging,
  onReconnect,
  activeProject,
  activePlan,
  activeCycle,
  extraCommands = [],
  paletteOpen: paletteOpenProp,
  onPaletteOpenChange,
}: HeaderProps) {
  const [paletteOpenInternal, setPaletteOpenInternal] = useState(false);
  // Controlled when both props are supplied; otherwise fall back to internal.
  const isControlled = paletteOpenProp !== undefined && onPaletteOpenChange !== undefined;
  const paletteOpen = isControlled ? paletteOpenProp : paletteOpenInternal;
  const setPaletteOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(paletteOpen) : next;
    if (isControlled) onPaletteOpenChange!(resolved);
    else setPaletteOpenInternal(resolved);
  }, [isControlled, onPaletteOpenChange, paletteOpen]);
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>(getCurrentEffectiveTheme);

  // Sync effective theme label when OS preference changes or stored theme changes
  useEffect(() => {
    const update = () => {
      setThemeState(getStoredTheme());
      setEffectiveTheme(getCurrentEffectiveTheme());
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    // Cross-tab / Sidebar toggles also write to localStorage
    window.addEventListener('storage', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('storage', update);
    };
  }, []);

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ['system', 'dark', 'light'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    setThemeState(next);
    setEffectiveTheme(getCurrentEffectiveTheme());
  }, [theme]);

  // Cmd+K / Ctrl+K to open palette — only when uncontrolled.
  // (KEY-002: controlled callers wire this through `useGlobalShortcuts` so
  // the same chord doesn't fire twice.)
  useEffect(() => {
    if (isControlled) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpenInternal(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isControlled]);

  const builtinCommands: CommandItem[] = [
    {
      id: 'theme-cycle',
      label: 'Toggle theme',
      description: `Current: ${THEME_LABELS[theme]} (${effectiveTheme})`,
      icon: effectiveTheme === 'dark' ? '◑' : '○',
      action: cycleTheme,
    },
    ...extraCommands,
  ];

  const indicator = useMemo(
    () => connectionIndicator(daemonConnected, sseStatus, lagging),
    [daemonConnected, sseStatus, lagging],
  );
  const toneCls = TONE_CLASSES[indicator.tone];

  // ---- Active plan / cycle text -------------------------------------------
  // The badge shows two-line text: line 1 = plan title (truncated), line 2 =
  // "cycle <idx> · round <n>" derived from the active cycle. The cycle index
  // is always present (idx is daemon-side). "Round" is decoded from the cycle
  // title when authors follow the convention "(round N)" — we surface the raw
  // cycle title fallback when the convention is absent (US-CLAWKET-WEB-NAV-009
  // expects the badge to be informative, not lossy).
  const planBadge = useMemo(() => {
    if (!activePlan) return null;
    const cyc = activeCycle;
    let cycleLabel = '';
    if (cyc) {
      const roundMatch = cyc.title.match(/round\s*(\d+)/i);
      cycleLabel = roundMatch
        ? `cycle ${cyc.idx} · round ${roundMatch[1]}`
        : `cycle ${cyc.idx}`;
    }
    return { title: activePlan.title, cycle: cycleLabel };
  }, [activePlan, activeCycle]);

  // ---- Token authentication state badge -----------------------------------
  // Shown only when X-Clawket-Token is configured for this session. The token
  // itself never leaves localStorage; the header just reflects "auth on".
  const token = getStoredToken();

  return (
    <>
      <header className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-border bg-surface-low">
        {/* Left: branding + active project + active plan */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-foreground tracking-tight select-none">Clawket</span>

          {activeProject && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-high text-muted shrink-0"
              title={activeProject.name}
            >
              {activeProject.id}
            </span>
          )}

          {planBadge && (
            <span
              className="hidden sm:flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/5 max-w-[40vw] min-w-0"
              title={planBadge.cycle ? `${planBadge.title} — ${planBadge.cycle}` : planBadge.title}
            >
              <span className="truncate min-w-0">{planBadge.title}</span>
              {planBadge.cycle && (
                <span className="text-muted shrink-0">· {planBadge.cycle}</span>
              )}
            </span>
          )}
        </div>

        {/* Right: status + controls */}
        <div className="flex items-center gap-2">
          {/* Token auth badge — only when configured */}
          {token && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border border-success/30 text-success bg-success/5"
              title="X-Clawket-Token configured for this session"
            >
              auth
            </span>
          )}

          {/* Daemon + SSE indicator (3 tones) */}
          <button
            onClick={indicator.tone === 'red' ? onReconnect : undefined}
            className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${toneCls.wrap}`}
            title={indicator.title}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${toneCls.dot}`} />
            {indicator.label}
          </button>

          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            title={`Theme: ${THEME_LABELS[theme]}`}
            className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-surface-hover"
          >
            {THEME_LABELS[theme]}
          </button>

          {/* Command palette trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-hover cursor-pointer"
            title="Open command palette (Cmd+K)"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <kbd className="text-[10px] font-mono">⌘K</kbd>
          </button>
        </div>
      </header>

      <CommandPalette
        commands={builtinCommands}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
