import { useState, useEffect, useRef, useCallback } from 'react';

/** Polls GET /health every `intervalMs` ms to surface daemon liveness.
 *  Returns { connected, reconnect } — `reconnect()` triggers an immediate
 *  re-poll and resets the SSE connection via the provided callback. */
export function useDaemonHealth(opts?: {
  intervalMs?: number;
  onStatusChange?: (connected: boolean) => void;
}) {
  const { intervalMs = 10_000, onStatusChange } = opts ?? {};
  const [connected, setConnected] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });

  // Track previous connected state in a ref so we can fire the status callback
  // *after* the setConnected update without putting side effects inside the
  // updater (React 18 surfaces that as "setState during render" warnings —
  // ToastContainer is the listener that gets caught in the act).
  const prevConnectedRef = useRef<boolean>(false);

  const poll = useCallback(async () => {
    let next: boolean;
    try {
      const res = await fetch('/health', { method: 'GET', signal: AbortSignal.timeout(3000) });
      next = res.ok;
    } catch {
      next = false;
    }
    setConnected(next);
    if (prevConnectedRef.current !== next) {
      onStatusChangeRef.current?.(next);
      prevConnectedRef.current = next;
    }
  }, []);

  useEffect(() => {
    // Defer the first poll past commit so setState lands outside the effect
    // body (react-hooks/set-state-in-effect is satisfied; UX-equivalent to
    // calling poll() synchronously since both resolve via async fetch).
    const initialTimer = setTimeout(() => { void poll(); }, 0);
    timerRef.current = setInterval(() => { void poll(); }, intervalMs);
    return () => {
      clearTimeout(initialTimer);
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [poll, intervalMs]);

  const reconnect = useCallback(() => {
    poll();
  }, [poll]);

  return { connected, reconnect };
}
