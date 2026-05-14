import type {
  Project,
  Cycle,
  Plan,
  Unit,
  Task,
  Artifact,
  Run,
  Question,
  TaskComment,
  ArtifactVersion,
  TimelineEvent,
  EnvelopeJson,
  EnvelopeResponse,
  EnvelopeValidateResult,
  TaskTreeNode,
  DecompositionResult,
  EnvelopeHistoryEntry,
} from './types';
import { authHeaders } from './lib/auth';

const BASE = '';

class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`API ${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // LM-10833: send the HttpOnly `clawket_session` cookie the daemon issues
    // on the SPA index response. The cookie carries the same token the CLI
    // reads from `~/.cache/clawket/clawketd.token`, and it's the bootstrap
    // channel for browsers (which can't read the token file). `authHeaders()`
    // is kept as a fallback for the vite dev server (cross-port: 5174 → daemon
    // port) where the cookie may not flow without a proxy passthrough.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => null);
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body as string);
    } catch {
      // keep raw text
    }
    throw new ApiError(res.status, res.statusText, parsed);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

function patch<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

function del<T = void>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return get('/projects');
}

export function getProject(id: string): Promise<Project> {
  return get(`/projects/${encodeURIComponent(id)}`);
}

export function createProject(data: {
  name: string;
  description?: string;
  cwd?: string;
}): Promise<Project> {
  return post('/projects', data);
}

export function updateProject(
  id: string,
  data: Partial<Pick<Project, 'name' | 'description' | 'cwds' | 'enabled' | 'wiki_paths'>>,
): Promise<Project> {
  return patch(`/projects/${encodeURIComponent(id)}`, data);
}

export function deleteProject(id: string): Promise<void> {
  return del(`/projects/${encodeURIComponent(id)}`);
}

export function addProjectCwd(id: string, cwd: string): Promise<Project> {
  return post(`/projects/${encodeURIComponent(id)}/cwds`, { cwd });
}

export function removeProjectCwd(id: string, cwd: string): Promise<Project> {
  return request(`/projects/${encodeURIComponent(id)}/cwds`, {
    method: 'DELETE',
    body: JSON.stringify({ cwd }),
  });
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export function listPlans(params?: {
  project_id?: string;
  status?: string;
}): Promise<Plan[]> {
  return get(`/plans${qs(params)}`);
}

export function getPlan(id: string): Promise<Plan> {
  return get(`/plans/${encodeURIComponent(id)}`);
}

export function createPlan(data: {
  project_id: string;
  title: string;
  description?: string;
  source: string;
  source_path?: string;
}): Promise<Plan> {
  return post('/plans', data);
}

export function updatePlan(
  id: string,
  data: Partial<Pick<Plan, 'title' | 'description' | 'status'>>,
): Promise<Plan> {
  return patch(`/plans/${encodeURIComponent(id)}`, data);
}

export function deletePlan(id: string): Promise<void> {
  return del(`/plans/${encodeURIComponent(id)}`);
}

export function approvePlan(id: string): Promise<Plan> {
  return post(`/plans/${encodeURIComponent(id)}/approve`);
}

/** FIX-WEB-005 — LM-counts: aggregate task counts by unit for a plan.
 *  Backend endpoint: GET /plans/:id/counts
 *  Shape: Record<unit_id, { todo: number; in_progress: number; blocked: number; done: number; cancelled: number; total: number }>
 *  Note: if the daemon endpoint doesn't exist yet (FIX-DAEMON-016 in flight),
 *  callers should catch 404 and fall back to per-unit listTasks. */
export interface UnitTaskCounts {
  todo: number;
  in_progress: number;
  blocked: number;
  done: number;
  cancelled: number;
  total: number;
}

export async function getPlanCounts(planId: string): Promise<Record<string, UnitTaskCounts> | null> {
  try {
    return await get<Record<string, UnitTaskCounts>>(`/plans/${encodeURIComponent(planId)}/counts`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cycles (Sprint — time-boxed iteration, cross-cutting)
// ---------------------------------------------------------------------------

export function listCycles(params?: {
  project_id?: string;
  status?: string;
}): Promise<Cycle[]> {
  return get(`/cycles${qs(params)}`);
}

export function getCycle(id: string): Promise<Cycle> {
  return get(`/cycles/${encodeURIComponent(id)}`);
}

export function createCycle(data: {
  project_id: string;
  title: string;
  goal?: string;
  idx?: number;
}): Promise<Cycle> {
  return post('/cycles', data);
}

export function updateCycle(
  id: string,
  data: Partial<Pick<Cycle, 'title' | 'goal' | 'status'>>,
): Promise<Cycle> {
  return patch(`/cycles/${encodeURIComponent(id)}`, data);
}

export function deleteCycle(id: string): Promise<void> {
  return del(`/cycles/${encodeURIComponent(id)}`);
}

export function listCycleTasks(id: string): Promise<Task[]> {
  return get(`/cycles/${encodeURIComponent(id)}/tasks`);
}

export function listBacklog(project_id: string): Promise<Task[]> {
  return get(`/backlog${qs({ project_id })}`);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export function listUnits(params?: {
  plan_id?: string;
  status?: string;
}): Promise<Unit[]> {
  return get(`/units${qs(params)}`);
}

export function getUnit(id: string): Promise<Unit> {
  return get(`/units/${encodeURIComponent(id)}`);
}

export function createUnit(data: {
  plan_id: string;
  idx: number;
  title: string;
  goal?: string;
  approval_required?: number;
}): Promise<Unit> {
  return post('/units', data);
}

export function updateUnit(
  id: string,
  data: Partial<Pick<Unit, 'title' | 'goal'>>,
): Promise<Unit> {
  return patch(`/units/${encodeURIComponent(id)}`, data);
}

export function deleteUnit(id: string): Promise<void> {
  return del(`/units/${encodeURIComponent(id)}`);
}

export function approveUnit(id: string, by?: string): Promise<Unit> {
  return post(`/units/${encodeURIComponent(id)}/approve`, by ? { approved_by: by } : undefined);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function listTasks(params?: {
  unit_id?: string;
  plan_id?: string;
  status?: string;
  /** US-CKT-SCHEMA-023/025: filter tasks by batch_id (for sub-agent batch grouping) */
  batch_id?: string;
}): Promise<Task[]> {
  return get(`/tasks${qs(params)}`);
}

export function listChildTasks(parentTaskId: string): Promise<Task[]> {
  return get(`/tasks${qs({ parent_task_id: parentTaskId })}`);
}

export function getTask(id: string): Promise<Task> {
  return get(`/tasks/${encodeURIComponent(id)}`);
}

export function createTask(data: {
  unit_id: string;
  idx: number;
  title: string;
  body: string;
  assignee?: string;
  depends_on?: string[];
  parent_task_id?: string;
}): Promise<Task> {
  return post('/tasks', data);
}

export function updateTask(
  id: string,
  data: Partial<Pick<Task, 'title' | 'body' | 'status' | 'assignee' | 'depends_on' | 'cycle_id' | 'unit_id'>>,
): Promise<Task> {
  return patch(`/tasks/${encodeURIComponent(id)}`, data);
}

export function deleteTask(id: string): Promise<void> {
  return del(`/tasks/${encodeURIComponent(id)}`);
}

export function bulkUpdateTasks(
  ids: string[],
  fields: Partial<Pick<Task, 'status' | 'cycle_id' | 'unit_id' | 'assignee'>>,
): Promise<Task[]> {
  return post('/tasks/bulk-update', { ids, fields });
}

export function appendTaskBody(id: string, text: string): Promise<Task> {
  return post(`/tasks/${encodeURIComponent(id)}/append`, { text });
}

export function searchTasks(query: string, limit?: number): Promise<Task[]> {
  return get(`/tasks/search${qs({ q: query, limit })}`);
}

export function addTaskLabel(id: string, label: string): Promise<Task> {
  return post(`/tasks/${encodeURIComponent(id)}/labels`, { label });
}

export function removeTaskLabel(id: string, label: string): Promise<Task> {
  return del(`/tasks/${encodeURIComponent(id)}/labels/${encodeURIComponent(label)}`);
}

/** Fetch the active envelope. Resolves 404 (no envelope yet) to null
 *  so callers can render an empty form instead of treating a missing
 *  envelope as an error. */
export async function getTaskEnvelope(
  id: string,
  opts?: { resolve?: boolean; version?: number },
): Promise<EnvelopeResponse | null> {
  try {
    return await get<EnvelopeResponse>(
      `/tasks/${encodeURIComponent(id)}/envelope${qs({
        resolve: opts?.resolve ? '1' : undefined,
        version: opts?.version,
      })}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Sign a new envelope version on the task. Returns the updated task
 *  envelope wrapper; the active envelope is the one written here. */
export function updateTaskEnvelope(
  id: string,
  envelope: EnvelopeJson,
): Promise<{ task: Task; active_envelope: unknown }> {
  return patch(`/tasks/${encodeURIComponent(id)}`, { envelope });
}

export function clearTaskEnvelope(id: string): Promise<{ task_id: string; cleared: boolean }> {
  return del(`/tasks/${encodeURIComponent(id)}/envelope`);
}

/** Envelope version history for a task, newest-first. The active
 *  envelope is the only entry without `superseded_at`. Used by the
 *  Timeline Replay view (LM-89) as one of the two event streams. */
export function getEnvelopeHistory(
  id: string,
  opts?: { limit?: number; offset?: number },
): Promise<EnvelopeHistoryEntry[]> {
  return get<EnvelopeHistoryEntry[]>(
    `/tasks/${encodeURIComponent(id)}/envelope/history${qs({
      limit: opts?.limit,
      offset: opts?.offset,
    })}`,
  );
}

/** Ask the daemon to suggest subtasks for `id`, derived from the
 *  resolved envelope's `success_criteria`. Returns the same shape the
 *  CLI MCP `clawket_decompose_task` tool exposes — daemon is the
 *  single source of truth (LM-87). */
export function decomposeTask(
  id: string,
  args: { strategy?: 'auto' | 'scoped' | 'by-repo'; max_depth?: number } = {},
): Promise<DecompositionResult> {
  return post<DecompositionResult>(
    `/tasks/${encodeURIComponent(id)}/decompose`,
    args,
  );
}

/** Create a child task under `parentId`. Inherits envelope from the
 *  parent unless overrides are supplied. Used by the SuggestionPanel
 *  to materialize accepted suggestions. */
export function createSubtask(
  parentId: string,
  body: {
    title: string;
    body?: string;
    idx?: number;
    priority?: Task['priority'];
    type?: Task['type'];
    envelope_overrides?: EnvelopeJson;
  },
): Promise<{ task: Task } | Task> {
  return post(`/tasks/${encodeURIComponent(parentId)}/subtasks`, body);
}

/** Subtree rooted at `id` in pre-order (DFS by default, BFS via
 *  `order: 'bfs'`). The first element is always the root. The daemon
 *  caps the result at 1024 nodes. `include_envelope` defaults to true
 *  on the daemon — pass `include_envelope: false` to skip the per-node
 *  envelope resolve cost when the caller only needs structure. */
export function getTaskSubtree(
  id: string,
  opts?: { depth?: number; order?: 'dfs' | 'bfs'; include_envelope?: boolean },
): Promise<TaskTreeNode[]> {
  return get<TaskTreeNode[]>(
    `/tasks/${encodeURIComponent(id)}/subtree${qs({
      depth: opts?.depth,
      order: opts?.order,
      include_envelope: opts?.include_envelope === undefined ? undefined : String(opts.include_envelope),
    })}`,
  );
}

/** Parent chain rooted at the closest ancestor and ending with the
 *  immediate parent. `depth=1` yields just the parent; the daemon
 *  caps at TREE_NODE_CAP. The current task is **not** included —
 *  callers prepend it themselves for breadcrumb rendering. */
export function getTaskAncestors(
  id: string,
  opts?: { depth?: number; include_envelope?: boolean },
): Promise<TaskTreeNode[]> {
  return get<TaskTreeNode[]>(
    `/tasks/${encodeURIComponent(id)}/ancestors${qs({
      depth: opts?.depth,
      include_envelope: opts?.include_envelope === undefined ? undefined : String(opts.include_envelope),
    })}`,
  );
}

/** Descendant tree of `id` (excluding self). `depth=1` returns only
 *  the immediate children, which is what the children panel uses. */
export function getTaskDescendants(
  id: string,
  opts?: { depth?: number; order?: 'dfs' | 'bfs'; include_envelope?: boolean },
): Promise<TaskTreeNode[]> {
  return get<TaskTreeNode[]>(
    `/tasks/${encodeURIComponent(id)}/descendants${qs({
      depth: opts?.depth,
      order: opts?.order,
      include_envelope: opts?.include_envelope === undefined ? undefined : String(opts.include_envelope),
    })}`,
  );
}

/** Validate a *draft* envelope (un-saved) against the daemon's
 *  structural rules. Returns 404 if `envelope` is omitted and the task
 *  has no active envelope yet — in that case the caller should treat
 *  it as "no validation surface yet" rather than an error. */
export async function validateTaskEnvelope(
  id: string,
  args: { envelope?: EnvelopeJson; strict?: boolean; resolve?: boolean } = {},
): Promise<EnvelopeValidateResult | null> {
  try {
    return await post<EnvelopeValidateResult>(
      `/tasks/${encodeURIComponent(id)}/envelope/validate`,
      args,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wiki Files (project cwd file scanner)
// ---------------------------------------------------------------------------

export interface WikiFile {
  path: string;
  name: string;
  title?: string;
  size: number;
  modified_at: number;
  content?: string;
  content_format?: string;
  wiki_root?: string;
}

export function listWikiFiles(cwd: string, projectId?: string): Promise<WikiFile[]> {
  return get(`/wiki/files${qs({ cwd, project_id: projectId })}`);
}

export function getWikiFile(cwd: string, path: string, projectId?: string): Promise<WikiFile> {
  return get(`/wiki/file${qs({ cwd, path, project_id: projectId })}`);
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------
//
// HTTP path: /artifacts. Daemons post-migration-024 also expose /knowledge as
// the canonical name, but /artifacts remains a permanent backwards-compat
// alias (router-level alias + SQL view), so the web stays on the older spelling
// to keep working against any deployed daemon binary.

export function listArtifacts(params?: {
  task_id?: string;
  unit_id?: string;
  plan_id?: string;
  type?: string;
}): Promise<Artifact[]> {
  return get(`/knowledge${qs(params)}`);
}

export function getArtifact(id: string): Promise<Artifact> {
  return get(`/knowledge/${encodeURIComponent(id)}`);
}

export function createArtifact(data: {
  task_id?: string;
  unit_id?: string;
  plan_id?: string;
  type: string;
  title: string;
  content: string;
  content_format: string;
  parent_id?: string;
}): Promise<Artifact> {
  return post('/knowledge', data);
}

export function updateArtifact(
  id: string,
  data: { title?: string; content?: string; content_format?: string; created_by?: string },
): Promise<Artifact> {
  return patch(`/knowledge/${encodeURIComponent(id)}`, data);
}

export function deleteArtifact(id: string): Promise<void> {
  return del(`/knowledge/${encodeURIComponent(id)}`);
}

/** Server-side BM25 + vector hybrid search.
 *  Default mode: `hybrid` (BM25 + sqlite-vec embedding). When sqlite-vec is
 *  unavailable the daemon falls back to keyword-only and only `bm25_score`
 *  is populated.
 *
 *  Returns null on 404/501 — daemons predating FIX-DAEMON-010 don't expose
 *  this route, callers should fall back to client-side filter. */
export interface ArtifactHit extends Artifact {
  bm25_score?: number;
  vector_score?: number;
  hybrid_score?: number;
  truncated?: boolean;
}

export interface ArtifactSearchResponse {
  hits: ArtifactHit[];
  total_returned: number;
  limit: number;
  truncated: boolean;
}

export async function searchArtifacts(params: {
  q: string;
  limit?: number;
  mode?: 'hybrid' | 'semantic' | 'keyword';
  project_id?: string;
}): Promise<ArtifactSearchResponse | null> {
  try {
    return await get<ArtifactSearchResponse>(`/knowledge/search${qs(params)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function listRuns(params?: {
  task_id?: string;
  session_id?: string;
  project_id?: string;
}): Promise<Run[]> {
  return get(`/runs${qs(params)}`);
}

export function getRun(id: string): Promise<Run> {
  return get(`/runs/${encodeURIComponent(id)}`);
}

export function startRun(data: {
  task_id: string;
  session_id?: string;
  agent?: string;
}): Promise<Run> {
  return post('/runs', data);
}

export function finishRun(
  id: string,
  data: { result: string; notes?: string },
): Promise<Run> {
  return post(`/runs/${encodeURIComponent(id)}/finish`, data);
}

// ---------------------------------------------------------------------------
// Project Timeline
// ---------------------------------------------------------------------------

export function listProjectTimeline(
  projectId: string,
  params?: { limit?: number; offset?: number; types?: string },
): Promise<TimelineEvent[]> {
  return get(`/projects/${encodeURIComponent(projectId)}/timeline${qs(params)}`);
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export function listQuestions(params?: {
  plan_id?: string;
  unit_id?: string;
  task_id?: string;
  kind?: string;
  unanswered?: string;
}): Promise<Question[]> {
  return get(`/questions${qs(params)}`);
}

export function getQuestion(id: string): Promise<Question> {
  return get(`/questions/${encodeURIComponent(id)}`);
}

export function createQuestion(data: {
  plan_id?: string;
  unit_id?: string;
  task_id?: string;
  kind: string;
  origin: string;
  body: string;
  asked_by: string;
}): Promise<Question> {
  return post('/questions', data);
}

export function answerQuestion(
  id: string,
  data: { answer: string; answered_by?: string },
): Promise<Question> {
  return post(`/questions/${encodeURIComponent(id)}/answer`, data);
}

// ---------------------------------------------------------------------------
// Task Comments
// ---------------------------------------------------------------------------

export function fetchTaskComments(taskId: string): Promise<TaskComment[]> {
  return get(`/tasks/${encodeURIComponent(taskId)}/comments`);
}

export function createTaskComment(
  taskId: string,
  author: string,
  body: string,
): Promise<TaskComment> {
  return post(`/tasks/${encodeURIComponent(taskId)}/comments`, { author, body });
}

export function deleteTaskComment(id: string): Promise<void> {
  return del(`/comments/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Knowledge Versions
// ---------------------------------------------------------------------------

export function fetchArtifactVersions(artifactId: string): Promise<ArtifactVersion[]> {
  return get(`/knowledge/${encodeURIComponent(artifactId)}/versions`);
}

// ---------------------------------------------------------------------------
// Convenience namespace re-export
// ---------------------------------------------------------------------------

const api = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addProjectCwd,
  removeProjectCwd,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  approvePlan,
  listUnits,
  getUnit,
  createUnit,
  updateUnit,
  deleteUnit,
  approveUnit,
  listTasks,
  listChildTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  bulkUpdateTasks,
  appendTaskBody,
  searchTasks,
  addTaskLabel,
  removeTaskLabel,
  listArtifacts,
  getArtifact,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  searchArtifacts,
  listRuns,
  getRun,
  startRun,
  finishRun,
  listProjectTimeline,
  listQuestions,
  getQuestion,
  createQuestion,
  answerQuestion,
  fetchTaskComments,
  createTaskComment,
  deleteTaskComment,
  fetchArtifactVersions,
  listCycles,
  getCycle,
  createCycle,
  updateCycle,
  deleteCycle,
  listCycleTasks,
  listBacklog,
  listWikiFiles,
  getWikiFile,
  getTaskEnvelope,
  updateTaskEnvelope,
  clearTaskEnvelope,
  validateTaskEnvelope,
  getTaskSubtree,
  getTaskAncestors,
  getTaskDescendants,
  getEnvelopeHistory,
  decomposeTask,
  createSubtask,
  getPlanCounts,
} as const;

export default api;
export { ApiError };
