/** Theme management — persists to localStorage, syncs data-theme attribute.
 *  Listens to OS prefers-color-scheme to set initial value when unset.
 *
 *  v3 contract (US-CLAWKET-WEB-NAV-009 / KEY-001):
 *  - localStorage key: `clawket.theme`
 *  - values: `light` | `dark` | `system`
 *  - default when unset: `system`
 *  Legacy `clawket-theme` (dash) is migrated on first read. */

export type Theme = 'dark' | 'light' | 'system';

const KEY = 'clawket.theme';
const LEGACY_KEY = 'clawket-theme';

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(KEY) as Theme | null;
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  // Migrate legacy key (clawket-theme → clawket.theme). The legacy implementation
  // only stored 'dark' | 'light'; 'system' was never persisted there.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy === 'dark' || legacy === 'light') {
    localStorage.setItem(KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
    return legacy;
  }
  return 'system';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/** Call once on app mount. Returns a cleanup fn that removes the OS listener. */
export function initTheme(): () => void {
  const theme = getStoredTheme();
  applyTheme(theme);

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handleChange);
  return () => mq.removeEventListener('change', handleChange);
}

export function getCurrentEffectiveTheme(): 'dark' | 'light' {
  const stored = getStoredTheme();
  if (stored !== 'system') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
