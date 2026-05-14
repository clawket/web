/**
 * LM-92 / RL-U6-09 — useRunEvents verification.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * useRunEvents`):
 *
 *  1. Hook subscribes to the daemon `/events` stream once on mount
 *     and closes it on unmount. A single render pass cannot leak more
 *     than one EventSource.
 *  2. `run:created` / `run:updated` events whose payload survives JSON
 *     parsing surface as `lastEvent` and via the `onEvent` callback.
 *  3. When `taskId` is supplied, events whose payload `task_id` does
 *     not match are silently dropped — they must NOT update state and
 *     must NOT call onEvent. This is the filter that lets per-task
 *     panels subscribe to a global stream without thrashing on
 *     unrelated activity.
 *  4. `connected` flips with `open` / `error` and `reconnects`
 *     increments on every error. The browser auto-reconnects, so the
 *     UI's responsibility is just to surface the degraded window —
 *     not to reconnect manually.
 *  5. Malformed payloads (non-JSON or missing fields) must not crash
 *     the hook nor advance state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunEvents } from './useRunEvents';

interface MockListenerMap {
  [type: string]: Set<(e: MessageEvent | Event) => void>;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  private listeners: MockListenerMap = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (e: MessageEvent | Event) => void) {
    if (!this.listeners[type]) this.listeners[type] = new Set();
    this.listeners[type].add(listener);
  }

  removeEventListener(type: string, listener: (e: MessageEvent | Event) => void) {
    this.listeners[type]?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  /** Test helper: dispatch a typed SSE message event. */
  dispatch(type: string, data: unknown) {
    const ev = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    this.listeners[type]?.forEach((l) => l(ev));
  }

  dispatchOpen() {
    this.listeners.open?.forEach((l) => l(new Event('open')));
  }

  dispatchError() {
    this.listeners.error?.forEach((l) => l(new Event('error')));
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // jsdom lacks EventSource; install a typed mock on the global.
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRunEvents (LM-92)', () => {
  it('subscribes once and closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useRunEvents());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/events');
    expect(MockEventSource.instances[0].closed).toBe(false);

    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('surfaces run:updated events and invokes onEvent', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRunEvents({ onEvent }));

    act(() => {
      MockEventSource.instances[0].dispatch('run:updated', {
        id: 'RUN-1',
        task_id: 'TASK-A',
        status: 'running',
      });
    });

    expect(result.current.lastEvent).toEqual({
      type: 'run:updated',
      runId: 'RUN-1',
      taskId: 'TASK-A',
      status: 'running',
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'run:updated',
      runId: 'RUN-1',
      taskId: 'TASK-A',
      status: 'running',
    });
  });

  it('filters out events whose task_id does not match the subscriber', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRunEvents({ taskId: 'TASK-A', onEvent }));

    act(() => {
      MockEventSource.instances[0].dispatch('run:created', {
        id: 'RUN-X',
        task_id: 'TASK-OTHER',
        status: 'pending',
      });
    });

    expect(result.current.lastEvent).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();

    // Matching task — should pass.
    act(() => {
      MockEventSource.instances[0].dispatch('run:created', {
        id: 'RUN-Y',
        task_id: 'TASK-A',
        status: 'pending',
      });
    });

    expect(result.current.lastEvent?.runId).toBe('RUN-Y');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('tracks connected state and counts reconnects on error', () => {
    const { result } = renderHook(() => useRunEvents());

    expect(result.current.connected).toBe(false);
    expect(result.current.reconnects).toBe(0);

    act(() => MockEventSource.instances[0].dispatchOpen());
    expect(result.current.connected).toBe(true);

    act(() => MockEventSource.instances[0].dispatchError());
    expect(result.current.connected).toBe(false);
    expect(result.current.reconnects).toBe(1);

    // Browser auto-reconnects; another open flips connected back.
    act(() => MockEventSource.instances[0].dispatchOpen());
    expect(result.current.connected).toBe(true);
    expect(result.current.reconnects).toBe(1);

    act(() => MockEventSource.instances[0].dispatchError());
    expect(result.current.reconnects).toBe(2);
  });

  it('ignores malformed payloads without crashing', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRunEvents({ onEvent }));

    act(() => {
      MockEventSource.instances[0].dispatch('run:updated', 'not-json');
    });
    expect(result.current.lastEvent).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();

    // Valid event after malformed one still works.
    act(() => {
      MockEventSource.instances[0].dispatch('run:updated', {
        id: 'RUN-Z',
        task_id: 'TASK-A',
      });
    });
    expect(result.current.lastEvent?.runId).toBe('RUN-Z');
  });
});
