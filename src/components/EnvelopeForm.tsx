import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ATOMIC_SIZE_HINTS,
  DECOMPOSITION_POLICIES,
  ENVELOPE_FIELDS,
  type AtomicSizeHint,
  type DecompositionPolicy,
  type EnvelopeField,
  type EnvelopeJson,
  type EnvelopeViolation,
} from '../types';
import api from '../api';
import { Button, Input, Label, Select, Textarea } from './ui';

/** Debounce window (ms) before re-running daemon validation on draft
 *  changes. 400ms per LM-151 prompt — long enough to avoid hammering
 *  the daemon during typing, short enough that errors feel live. */
const VALIDATION_DEBOUNCE_MS = 400;

/** Per-field widget kind. Drives both render dispatch and the value
 *  coercion path on submit (string → number, csv → array, etc.). The
 *  19 fields ADR-0001 mandates fall into seven shapes — keep this
 *  list exhaustive over `ENVELOPE_FIELDS`. */
type WidgetKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select-size'
  | 'select-policy'
  | 'list'
  | 'readonly';

const FIELD_WIDGETS: Record<EnvelopeField, WidgetKind> = {
  version: 'number',
  intent: 'textarea',
  target_repo: 'text',
  target_model: 'text',
  max_turns: 'number',
  prompt_template: 'textarea',
  context_refs: 'list',
  scope_boundary: 'list',
  atomic_size_hint: 'select-size',
  success_criteria: 'list',
  verification_cmd: 'textarea',
  depends_on: 'list',
  blocked_by: 'list',
  planned_sha: 'readonly',
  decomposition_policy: 'select-policy',
  checkpoint_interval: 'number',
  rollback_strategy: 'textarea',
  origin: 'text',
  assigned_model: 'text',
};

const FIELD_HELP: Partial<Record<EnvelopeField, string>> = {
  version: 'Envelope schema version (ADR-0001 = 1)',
  intent: 'One-line statement of why this task exists',
  target_repo: 'Git repo this task touches (e.g. cli, daemon, web)',
  prompt_template: 'Verbatim instructions handed to the executing agent',
  context_refs: 'Other task IDs the agent must read first (one per line)',
  scope_boundary: 'Files/paths the agent may modify (one glob per line)',
  success_criteria: 'Bullet list — task is done when all are true',
  verification_cmd: 'Single shell command that returns 0 on success',
  depends_on: 'Tasks that must reach `done` before this can start',
  blocked_by: 'Tasks blocking progress; cleared as they complete',
  planned_sha: 'Repo HEAD captured at plan time (read-only)',
  checkpoint_interval: 'Edits between auto-commits (0 = none)',
  rollback_strategy: 'How to undo this work if it fails post-merge',
  origin: 'Where this task came from (plan, manual, decompose)',
  assigned_model: 'Model that actually executed this task',
};

interface EnvelopeFormProps {
  taskId: string;
  /** Notified when the envelope was successfully signed so the parent
   *  can refresh `inheritance_chain` / version badges. */
  onSaved?: () => void;
}

/** LM-91 — per-field provenance derived by walking the inheritance
 *  chain. `kind: 'own'` means the value lives in *this task's* raw
 *  envelope (the form's editable surface). `kind: 'inherited'` means
 *  the value comes from an ancestor's raw envelope; closest-ancestor
 *  wins because resolution is a deep-merge from root-to-self. */
type FieldProvenance =
  | { kind: 'unset' }
  | { kind: 'own' }
  | { kind: 'inherited'; from: string; value: unknown };

export default function EnvelopeForm({ taskId, onSaved }: EnvelopeFormProps) {
  const [draft, setDraft] = useState<EnvelopeJson>({});
  const [original, setOriginal] = useState<EnvelopeJson>({});
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<EnvelopeField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [violations, setViolations] = useState<EnvelopeViolation[]>([]);
  const [validating, setValidating] = useState(false);
  const validationToken = useRef(0);
  /** chain root-to-self plus per-task raw envelopes used for provenance. */
  const [inheritanceChain, setInheritanceChain] = useState<string[]>([]);
  const [ancestorRaw, setAncestorRaw] = useState<Record<string, EnvelopeJson>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .getTaskEnvelope(taskId, { resolve: true })
      .then((env) => {
        if (cancelled) return;
        const raw = env?.raw_envelope ?? {};
        setDraft(raw);
        setOriginal(raw);
        setVersion(env?.version ?? null);
        setInheritanceChain(env?.inheritance_chain ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setDraft({});
        setOriginal({});
        setVersion(null);
        setInheritanceChain([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // LM-91: fetch each ancestor's *raw* envelope so we can compute
  // per-field provenance. The chain is root-to-self; we skip self
  // because draft already represents that. Failures degrade to empty
  // — the form still works, the badges just won't show "from XXX".
  useEffect(() => {
    let cancelled = false;
    const ancestors = inheritanceChain.filter((id) => id !== taskId);
    Promise.all(
      ancestors.map((id) =>
        api
          .getTaskEnvelope(id, { resolve: false })
          .then((res) => [id, res?.raw_envelope ?? {}] as const)
          .catch(() => [id, {} as EnvelopeJson] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, EnvelopeJson> = {};
      for (const [id, raw] of entries) map[id] = raw;
      setAncestorRaw(map);
    });
    return () => {
      cancelled = true;
    };
  }, [inheritanceChain, taskId]);

  /** Walk the chain from closest ancestor outward to find the
   *  defining task for each field. Returns 'unset' when no chain
   *  member declares the field. */
  const provenance = useMemo<Record<EnvelopeField, FieldProvenance>>(() => {
    const out = {} as Record<EnvelopeField, FieldProvenance>;
    // Reverse so the closest ancestor (immediate parent) is checked
    // first; matches the deep-merge semantics where the most-recent
    // override wins.
    const ancestors = inheritanceChain.filter((id) => id !== taskId).slice().reverse();
    for (const f of ENVELOPE_FIELDS) {
      const ownVal = draft[f];
      const ownPresent =
        ownVal !== undefined &&
        ownVal !== null &&
        !(typeof ownVal === 'string' && ownVal.length === 0) &&
        !(Array.isArray(ownVal) && ownVal.length === 0);
      if (ownPresent) {
        out[f] = { kind: 'own' };
        continue;
      }
      let resolved: FieldProvenance = { kind: 'unset' };
      for (const ancestorId of ancestors) {
        const aRaw = ancestorRaw[ancestorId];
        const aVal = aRaw?.[f];
        const aPresent =
          aVal !== undefined &&
          aVal !== null &&
          !(typeof aVal === 'string' && aVal.length === 0) &&
          !(Array.isArray(aVal) && aVal.length === 0);
        if (aPresent) {
          resolved = { kind: 'inherited', from: ancestorId, value: aVal };
          break;
        }
      }
      out[f] = resolved;
    }
    return out;
  }, [draft, inheritanceChain, ancestorRaw, taskId]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );

  // LM-151: debounced validation against POST /tasks/:id/envelope/validate.
  // Token-based race guard: if the user keeps typing, in-flight responses
  // for stale drafts are dropped instead of overwriting newer results.
  //
  // Suppression rule: a task with no active envelope (`version === null`)
  // AND no in-progress edit is a legitimately envelope-less task per
  // ADR-0001 §Backwards Compatibility — validating an empty draft would
  // surface "required field missing" warnings for a contract the user
  // never opted into, restating the lying-UI bug from the inverse angle.
  // Validation kicks in the moment the draft becomes dirty (user begins
  // authoring) or once an envelope exists.
  const shouldValidate = !loading && (version !== null || dirty);
  useEffect(() => {
    if (!shouldValidate) return;
    const handle = window.setTimeout(() => {
      const token = ++validationToken.current;
      setValidating(true);
      api
        .validateTaskEnvelope(taskId, { envelope: draft, strict: true })
        .then((result) => {
          if (token !== validationToken.current) return;
          setViolations(result?.violations ?? []);
        })
        .catch(() => {
          if (token !== validationToken.current) return;
          // Surface the failure as an empty violation list — caller
          // can still save; the daemon will re-validate on PATCH.
          setViolations([]);
        })
        .finally(() => {
          if (token === validationToken.current) setValidating(false);
        });
    }, VALIDATION_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, taskId, shouldValidate]);

  const violationsByField = useMemo(() => {
    const map = new Map<string, EnvelopeViolation[]>();
    // When the suppression gate is closed (envelope-less + clean draft),
    // hide any stale violations from a prior validate cycle.
    if (!shouldValidate) return map;
    for (const v of violations) {
      // Per-field violations bucket under the field name; nested-field
      // violations (e.g. preconditions[0]) bucket under their array
      // root for inline display next to the right input.
      const key = v.field.split(/[.[]/)[0];
      const bucket = map.get(key) ?? [];
      bucket.push(v);
      map.set(key, bucket);
    }
    return map;
  }, [violations, shouldValidate]);

  function setField(field: EnvelopeField, value: unknown) {
    setDraft((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        delete next[field];
      } else {
        next[field] = value;
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors: Partial<Record<EnvelopeField, string>> = {};
    for (const f of ENVELOPE_FIELDS) {
      const widget = FIELD_WIDGETS[f];
      if (widget === 'number') {
        const v = draft[f];
        if (v !== undefined && v !== null && typeof v !== 'number') {
          fieldErrors[f] = 'must be a number';
        }
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setSubmitError('Some fields are invalid; see inline errors.');
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSaving(true);
    api
      .updateTaskEnvelope(taskId, draft)
      .then(() => api.getTaskEnvelope(taskId, { resolve: true }))
      .then((env) => {
        const raw = env?.raw_envelope ?? {};
        setDraft(raw);
        setOriginal(raw);
        setVersion(env?.version ?? null);
        setInheritanceChain(env?.inheritance_chain ?? []);
        onSaved?.();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setSubmitError(msg);
      })
      .finally(() => setSaving(false));
  }

  if (loading) {
    return (
      <div className="text-xs text-muted py-2" aria-busy="true">
        Loading envelope...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="envelope-form">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {version !== null
            ? `Active version: v${version}`
            : dirty
              ? 'Draft envelope (unsigned)'
              : 'No envelope — optional; start editing to draft one'}
        </span>
        <span className="flex items-center gap-2">
          {shouldValidate && validating && <span className="text-muted">validating...</span>}
          {dirty && <span className="text-warning">unsaved changes</span>}
        </span>
      </div>
      {inheritanceChain.length > 1 && (
        <div
          className="text-xs text-muted"
          aria-label="inheritance-chain"
          title={inheritanceChain.join(' → ')}
        >
          inherits from{' '}
          {inheritanceChain
            .filter((id) => id !== taskId)
            .map((id, i, arr) => (
              <span key={id} className="font-mono" data-testid={`inheritance-chain-${id}`}>
                {`...${id.slice(-6)}`}
                {i < arr.length - 1 ? ' → ' : ''}
              </span>
            ))}
        </div>
      )}
      {ENVELOPE_FIELDS.map((field) => (
        <FieldRow
          key={field}
          field={field}
          value={draft[field]}
          error={errors[field]}
          violations={violationsByField.get(field) ?? []}
          provenance={provenance[field] ?? { kind: 'unset' }}
          onChange={(v) => setField(field, v)}
        />
      ))}
      {submitError && (
        <div role="alert" className="text-xs text-danger">
          {submitError}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(original);
            setErrors({});
            setSubmitError(null);
          }}
        >
          Reset
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving ? 'Saving...' : 'Save envelope'}
        </Button>
      </div>
    </form>
  );
}

interface FieldRowProps {
  field: EnvelopeField;
  value: unknown;
  error?: string;
  violations: EnvelopeViolation[];
  provenance: FieldProvenance;
  onChange: (v: unknown) => void;
}

function formatInheritedValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(String).join(', ');
  return JSON.stringify(v);
}

function FieldRow({ field, value, error, violations, provenance, onChange }: FieldRowProps) {
  const widget = FIELD_WIDGETS[field];
  const help = FIELD_HELP[field];
  const labelId = `env-field-${field}`;
  const hasError = violations.some((v) => v.severity === 'error') || !!error;
  const hasWarning = violations.some((v) => v.severity === 'warning');

  // Border class: red on error, amber on warning-only, default otherwise.
  // The widget renderer accepts a `className` via spread for inputs/
  // textareas/selects that participate in this state visually.
  const stateClass = hasError
    ? 'border-danger focus:border-danger focus:ring-danger'
    : hasWarning
      ? 'border-warning focus:border-warning focus:ring-warning'
      : '';

  return (
    <div data-provenance={provenance.kind} data-field-row={field}>
      <Label htmlFor={labelId}>
        <span
          className={`font-mono text-xs ${provenance.kind === 'own' ? 'font-bold text-foreground' : 'text-muted'}`}
        >
          {field}
        </span>
        {provenance.kind === 'inherited' && (
          <span
            className="ml-2 text-[10px] uppercase tracking-wide bg-secondary/20 text-secondary px-1.5 py-0.5 rounded font-mono"
            data-testid={`provenance-${field}`}
            title={`Inherited from ${provenance.from}`}
          >
            inherited from ...{provenance.from.slice(-6)}
          </span>
        )}
        {provenance.kind === 'own' && (
          <span
            className="ml-2 text-[10px] uppercase tracking-wide bg-primary/15 text-primary px-1.5 py-0.5 rounded font-mono"
            data-testid={`provenance-${field}`}
          >
            override
          </span>
        )}
      </Label>
      {provenance.kind === 'inherited' && (
        <div
          className="text-xs text-muted italic mb-1"
          data-testid={`inherited-value-${field}`}
        >
          inherited value: {formatInheritedValue(provenance.value)}
        </div>
      )}
      {renderWidget(widget, field, labelId, value, onChange, stateClass)}
      {help && <div className="text-xs text-muted mt-0.5">{help}</div>}
      {error && (
        <div role="alert" className="text-xs text-danger mt-0.5">
          {error}
        </div>
      )}
      {violations.map((v, i) => (
        <div
          key={`${v.field}-${i}`}
          role="alert"
          className={`text-xs mt-0.5 ${v.severity === 'error' ? 'text-danger' : 'text-warning'}`}
          data-severity={v.severity}
          data-field={v.field}
        >
          {v.field !== field && <span className="font-mono">{v.field}: </span>}
          {v.message}
        </div>
      ))}
    </div>
  );
}

function renderWidget(
  widget: WidgetKind,
  field: EnvelopeField,
  id: string,
  value: unknown,
  onChange: (v: unknown) => void,
  stateClass: string,
) {
  switch (widget) {
    case 'text':
      return (
        <Input
          id={id}
          size="sm"
          className={stateClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          id={id}
          size="sm"
          className={stateClass}
          rows={field === 'prompt_template' ? 6 : 3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number': {
      const numericValue =
        typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
      return (
        <Input
          id={id}
          size="sm"
          type="number"
          className={stateClass}
          value={numericValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }}
        />
      );
    }
    case 'select-size': {
      const v = typeof value === 'string' ? value : '';
      return (
        <Select
          id={id}
          size="sm"
          className={stateClass}
          value={v}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">(unset — defaults to small)</option>
          {ATOMIC_SIZE_HINTS.map((h: AtomicSizeHint) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
      );
    }
    case 'select-policy': {
      const v = typeof value === 'string' ? value : '';
      return (
        <Select
          id={id}
          size="sm"
          className={stateClass}
          value={v}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">(unset — defaults to auto)</option>
          {DECOMPOSITION_POLICIES.map((p: DecompositionPolicy) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      );
    }
    case 'list': {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return (
        <Textarea
          id={id}
          size="sm"
          className={stateClass}
          rows={3}
          placeholder="one entry per line"
          value={arr.join('\n')}
          onChange={(e) => {
            const next = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            onChange(next);
          }}
        />
      );
    }
    case 'readonly': {
      const display =
        value === undefined || value === null
          ? '(unset)'
          : typeof value === 'string'
            ? value
            : JSON.stringify(value);
      return (
        <div
          id={id}
          className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs font-mono text-muted"
        >
          {display}
        </div>
      );
    }
  }
}
