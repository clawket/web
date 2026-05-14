/** Global toast event bus — emits CustomEvents on document.
 *  ToastContainer subscribes and renders toasts. No React context needed. */

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastPayload {
  id: string;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss timeout in ms. 0 = sticky (manual dismiss). Default 4000.
   *  TOAST-002: severity=error defaults to sticky (0). */
  duration?: number;
  /** TOAST-003 dedup hash — `${kind}:${message}`. ToastContainer collapses
   *  identical payloads into a single visible toast with a count. */
  hash?: string;
}

const EVENT_NAME = 'clawket:toast';

let _seq = 0;

export function toast(message: string, kind: ToastKind = 'info', duration?: number): void {
  // TOAST-002: error toasts are sticky by default (duration = 0). Other
  // kinds keep a 4s auto-dismiss unless the caller passes an explicit value.
  // info also keeps the 4s default; the explicit toastInfo() helper below
  // overrides to the documented 6s for symmetry with prior behaviour.
  const resolved = duration ?? (kind === 'error' ? 0 : 4000);
  const payload: ToastPayload = {
    id: `toast-${++_seq}`,
    kind,
    message,
    duration: resolved,
    hash: `${kind}:${message}`,
  };
  document.dispatchEvent(new CustomEvent<ToastPayload>(EVENT_NAME, { detail: payload }));
}

export function toastSuccess(message: string): void { toast(message, 'success'); }
/** TOAST-002: errors are sticky by default — caller must dismiss explicitly. */
export function toastError(message: string): void { toast(message, 'error'); }
export function toastWarning(message: string): void { toast(message, 'warning'); }
/** Info uses the 6s spec default. */
export function toastInfo(message: string): void { toast(message, 'info', 6000); }

export function onToast(handler: (payload: ToastPayload) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ToastPayload>).detail);
  document.addEventListener(EVENT_NAME, listener);
  return () => document.removeEventListener(EVENT_NAME, listener);
}
