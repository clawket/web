/**
 * LM-92 / RL-U6-09 — Live run-state subscription via daemon SSE.
 *
 * Subscribes to the daemon's `/events` SSE stream and surfaces
 * `run:created` / `run:updated` events so callers can refresh
 * run-bound UI without polling. The browser's `EventSource` already
 * reconnects on transport drop; we expose `connected` and the
 * `reconnects` counter so the UI can show a degraded state when the
 * stream is bouncing.
 *
 * Filter semantics: when `taskId` is provided, only events whose
 * payload `task_id` matches are surfaced. If the daemon ever emits
 * an event without `task_id` (e.g. legacy payloads), it is dropped
 * by the filter — we never speculate.
 */
import { useEffect, useRef, useState } from 'react';
import { daemonUrl } from '../lib/daemonUrl';

export type RunEventType = 'run:created' | 'run:updated';

export interface RunEvent {
  type: RunEventType;
  /** Run id from the SSE payload, if present. */
  runId: string | null;
  /** Task id from the SSE payload, if present. */
  taskId: string | null;
  /** Best-effort status (pending/running/success/fail/...) when daemon includes it. */
  status: string | null;
}

export interface UseRunEventsOptions {
  /** Filter to events whose payload `task_id` matches. */
  taskId?: string;
  /** Invoked once per matching event. */
  onEvent?: (event: RunEvent) => void;
  /** Override the SSE endpoint (test seam). */
  url?: string;
}

export interface UseRunEventsState {
  /** True when the EventSource has fired `open` since the last `error`. */
  connected: boolean;
  /** Most recent matching event, useful for declarative refresh keys. */
  lastEvent: RunEvent | null;
  /** Count of `error` transitions — i.e. how many times the stream dropped. */
  reconnects: number;
}

const RUN_EVENT_TYPES: RunEventType[] = ['run:created', 'run:updated'];

function parsePayload(type: RunEventType, raw: string): RunEvent | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const runId = typeof obj.id === 'string' ? obj.id : null;
    const taskId = typeof obj.task_id === 'string' ? obj.task_id : null;
    const status = typeof obj.status === 'string' ? obj.status : null;
    return { type, runId, taskId, status };
  } catch {
    return null;
  }
}

export function useRunEvents(opts: UseRunEventsOptions = {}): UseRunEventsState {
  const { taskId, onEvent, url = '/events' } = opts;
  const [state, setState] = useState<UseRunEventsState>({
    connected: false,
    lastEvent: null,
    reconnects: 0,
  });
  // Keep callback in a ref so an onEvent identity change does not
  // tear down the stream — callers commonly re-define it inline.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    // Bypass Vite proxy for SSE in dev (proxy buffers text/event-stream).
    // Production uses same-origin so daemonUrl() returns `url` unchanged.
    const es = new EventSource(daemonUrl(url));

    const handleOpen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };
    const handleError = () => {
      setState((prev) => ({
        ...prev,
        connected: false,
        reconnects: prev.reconnects + 1,
      }));
    };

    const listeners: Array<[RunEventType, (e: MessageEvent) => void]> = [];
    for (const type of RUN_EVENT_TYPES) {
      const listener = (e: MessageEvent) => {
        const parsed = parsePayload(type, typeof e.data === 'string' ? e.data : '');
        if (!parsed) return;
        if (taskId && parsed.taskId !== taskId) return;
        setState((prev) => ({ ...prev, lastEvent: parsed }));
        onEventRef.current?.(parsed);
      };
      es.addEventListener(type, listener as EventListener);
      listeners.push([type, listener]);
    }
    es.addEventListener('open', handleOpen);
    es.addEventListener('error', handleError);

    return () => {
      for (const [type, listener] of listeners) {
        es.removeEventListener(type, listener as EventListener);
      }
      es.removeEventListener('open', handleOpen);
      es.removeEventListener('error', handleError);
      es.close();
    };
  }, [url, taskId]);

  return state;
}
