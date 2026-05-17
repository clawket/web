export interface Project {
  id: string;
  name: string;
  description: string | null;
  /** Ticket prefix (e.g. `LM`, `MP`). Surfaced in TaskCard ticket numbers
   *  (`<key>-<idx>`). Daemon side: `models::Project::key`. */
  key: string | null;
  created_at: number;
  updated_at: number;
  cwds: string[];
  enabled: number;
  wiki_paths: string[];
}

export interface Cycle {
  id: string;
  project_id: string;
  title: string;
  goal: string | null;
  idx: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  status: 'planning' | 'active' | 'completed';
  unit_id?: string | null;
}

export interface Plan {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  source: string;
  source_path: string | null;
  created_at: number;
  approved_at: number | null;
  status: 'draft' | 'active' | 'completed';
}

export interface Unit {
  id: string;
  plan_id: string;
  idx: number;
  title: string;
  goal: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  status?: string; // Unit has no status in the workflow — kept for backward compat
  approval_required: number;
  approved_by: string | null;
  approved_at: number | null;
}

export interface Task {
  id: string;
  unit_id: string;
  idx: number;
  title: string;
  body: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
  assignee: string | null;
  depends_on: string[];
  ticket_number: string | null;
  parent_task_id: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  complexity: string | null;
  estimated_edits: number | null;
  cycle_id: string | null;
  labels: string[];
  reporter: string | null;
  type: 'task' | 'bug' | 'feature' | 'enhancement' | 'refactor' | 'docs' | 'test' | 'chore';
  /** US-CLAWKET-TIER-010 — declared model tier (FIX-DAEMON-001). The daemon
   *  ships `low | med | high` (or null for legacy rows). UI renders a small
   *  badge in TaskCard / BacklogView / BoardView. */
  tier?: 'low' | 'med' | 'high' | null;
  /** TIER-041 — actually-executed tier (may differ from `tier` after escalation). */
  tier_used?: 'low' | 'med' | 'high' | null;
  /** US-CKT-SCHEMA-008/009 — PDD v3.0 scenario traceability. Maps this task
   *  to the atomic scenario it implements (e.g. `US-CKT-SCHEMA-008`). NULL
   *  for legacy rows that predate schema v3.0. */
  scenario_id?: string | null;
  /** US-CKT-SCHEMA-013/014 — execution evidence. Free-form string; when it
   *  matches `^[\w./-]+:\d+$` (file:line) the UI renders it as a source
   *  reference link. NULL for legacy rows. */
  evidence?: string | null;
  /** US-CKT-SCHEMA-024 — sub-agent batch identifier. Groups tasks produced
   *  by the same sub-agent invocation for attention-drift audits. */
  batch_id?: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author: string;
  body: string;
  created_at: number;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  version: number;
  content: string | null;
  content_format: string | null;
  created_at: number;
  created_by: string | null;
}

export interface Artifact {
  id: string;
  task_id: string | null;
  unit_id: string | null;
  plan_id: string | null;
  type: string;
  title: string;
  content: string;
  content_format: string;
  created_at: number;
  /** FIX-DAEMON-008 — wiki ordering hint (sibling order within parent). */
  wiki_idx?: number;
  /** FIX-DAEMON-008 — depth in the wiki tree (root = 0). Used by WikiView
   *  for left-padding when the parent_id chain is unreliable (e.g. orphans
   *  whose parent isn't in scope). US-CLAWKET-WEB-WIKI-005. */
  wiki_depth?: number;
}

export interface Run {
  id: string;
  task_id: string;
  session_id: string | null;
  agent: string;
  started_at: number;
  ended_at: number | null;
  result: string | null;
  notes: string | null;
}

export type TimelineEventType =
  | 'status_change' | 'comment' | 'knowledge' | 'run_start' | 'run_end'
  | 'question' | 'created' | 'updated' | 'assignment';

export interface TimelineEvent {
  id: string;
  event_type: TimelineEventType;
  entity_type: 'task' | 'unit' | 'cycle' | 'plan';
  entity_id: string;
  entity_title: string;
  actor: string | null;
  created_at: number;
  detail: {
    field?: string;
    old_value?: string;
    new_value?: string;
    body?: string;
    artifact_type?: string;
    agent?: string;
    duration_ms?: number;
    result?: string;
  };
}

/** Terminal statuses — tasks that count as "closed" for progress calculations */
export const CLOSED_STATUSES: ReadonlySet<Task['status']> = new Set(['done', 'cancelled']);

export function isClosedTask(task: Pick<Task, 'status'>): boolean {
  return CLOSED_STATUSES.has(task.status);
}

export interface Question {
  id: string;
  plan_id: string | null;
  unit_id: string | null;
  task_id: string | null;
  kind: string;
  origin: string;
  body: string;
  asked_by: string;
  created_at: number;
  answer: string | null;
  answered_by: string | null;
  answered_at: number | null;
}

/** ADR-0001 envelope: 19 canonical fields, in render order. Mirrors
 *  `cli::commands::plan::export::ENVELOPE_FIELDS`. The form renders
 *  these and *only* these — extra keys round-trip through JSON but
 *  are not surfaced as inputs. */
export const ENVELOPE_FIELDS = [
  'version',
  'intent',
  'target_repo',
  'target_model',
  'max_turns',
  'prompt_template',
  'context_refs',
  'scope_boundary',
  'atomic_size_hint',
  'success_criteria',
  'verification_cmd',
  'depends_on',
  'blocked_by',
  'planned_sha',
  'decomposition_policy',
  'checkpoint_interval',
  'rollback_strategy',
  'origin',
  'assigned_model',
] as const;

export type EnvelopeField = (typeof ENVELOPE_FIELDS)[number];

export const ATOMIC_SIZE_HINTS = ['tiny', 'small', 'medium', 'large'] as const;
export type AtomicSizeHint = (typeof ATOMIC_SIZE_HINTS)[number];

export const DECOMPOSITION_POLICIES = ['auto', 'manual', 'atomic'] as const;
export type DecompositionPolicy = (typeof DECOMPOSITION_POLICIES)[number];

/** Untyped JSON for envelope values — daemon stores arbitrary shapes
 *  per field (string / number / array / object). The form coerces
 *  per-field on submit. */
export type EnvelopeJson = Record<string, unknown>;

export interface EnvelopeResponse {
  raw_envelope: EnvelopeJson;
  resolved_envelope: EnvelopeJson;
  inheritance_chain: string[];
  version: number;
  superseded: boolean;
}

export type EnvelopeViolationSeverity = 'error' | 'warning';

export interface EnvelopeViolation {
  field: string;
  severity: EnvelopeViolationSeverity;
  message: string;
}

export interface EnvelopeValidateResult {
  valid: boolean;
  strict: boolean;
  violations: EnvelopeViolation[];
  evaluated_envelope: EnvelopeJson;
}

/** Daemon tree node — the wire shape from `/tasks/:id/{ancestors,
 *  descendants,subtree}`. The Task fields are flattened at the top
 *  level, then `depth` (root = 0) and an optional pre-resolved
 *  envelope are appended. Mirrors `daemon::routes::tasks::TreeNode`. */
export type TaskTreeNode = Task & {
  depth: number;
  resolved_envelope?: EnvelopeJson;
};

/** LM-87 — daemon decomposition response from POST /tasks/:id/decompose.
 *  Mirrors `daemon::decomposition::suggest::DecompositionResult`'s
 *  JSON shape. */
export interface DecompositionSuggestion {
  idx: number;
  title: string;
  rationale: string;
  scope_hint: string;
  inherited_envelope_keys: string[];
}

export interface DecompositionPolicyViolation {
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

/** LM-89 / RL-U6-06 — daemon envelope history entry from
 *  `GET /tasks/:id/envelope/history`. The latest version (`superseded_at`
 *  null) is the currently-active envelope; older versions form the
 *  replay timeline along with `Run` events. */
export interface EnvelopeHistoryEntry {
  id: string;
  version: number;
  created_at: number;
  signed_by: string;
  superseded_at?: number;
  envelope: EnvelopeJson;
}

export interface DecompositionResult {
  parent: { id: string; ticket_number: string | null; title: string };
  strategy: string;
  max_depth: number;
  existing_children_count: number;
  suggested_subtasks: DecompositionSuggestion[];
  policy_violations: DecompositionPolicyViolation[];
}
