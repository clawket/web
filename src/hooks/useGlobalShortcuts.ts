import { useEffect } from 'react';

/** US-CLAWKET-WEB-KEY-001 / KEY-002 — global keyboard shortcut binder.
 *  Centralises the key handling that was previously scattered across Header
 *  (Cmd+K palette) and ad-hoc inline listeners. Each handler may opt out by
 *  passing `undefined`; this lets call-sites mount the hook unconditionally
 *  while still gating individual chords.
 *
 *  Default chords:
 *    - Cmd/Ctrl+K → command palette
 *    - ?           → help modal (shortcut cheatsheet)
 *
 *  Suppressed when the active element is a text input (input, textarea, or
 *  contenteditable) so users can type "?" inside fields normally. */
export interface GlobalShortcutHandlers {
  onPalette?: () => void;
  onHelp?: () => void;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Cmd/Ctrl+K — palette
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        if (handlers.onPalette) {
          e.preventDefault();
          handlers.onPalette();
        }
        return;
      }
      // "?" — help (Shift+/ on US layouts). Skip when typing.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTextInput(e.target)) return;
        if (handlers.onHelp) {
          e.preventDefault();
          handlers.onHelp();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
