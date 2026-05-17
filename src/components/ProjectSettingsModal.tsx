import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api, { type UpdateProjectPatch } from '../api';
import type { Project } from '../types';

export interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

interface MultilineListInputProps {
  testId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}

function MultilineListInput({
  testId,
  label,
  placeholder,
  value,
  onChange,
}: MultilineListInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <Textarea
        size="sm"
        data-testid={testId}
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
    </label>
  );
}

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function ProjectSettingsModal({
  project,
  onClose,
  onUpdated,
}: ProjectSettingsModalProps) {
  const initial = useMemo(
    () => ({
      name: project.name,
      key: project.key ?? '',
      description: project.description ?? '',
      wikiPathsRaw: project.wiki_paths.join('\n'),
      cwdsRaw: project.cwds.join('\n'),
      enabled: project.enabled !== 0,
    }),
    [project],
  );

  const [name, setName] = useState(initial.name);
  const [projectKey, setProjectKey] = useState(initial.key);
  const [description, setDescription] = useState(initial.description);
  const [wikiPathsRaw, setWikiPathsRaw] = useState(initial.wikiPathsRaw);
  const [cwdsRaw, setCwdsRaw] = useState(initial.cwdsRaw);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmedName = name.trim();

  function buildPatch(): UpdateProjectPatch {
    const patch: UpdateProjectPatch = {};
    if (trimmedName !== initial.name) patch.name = trimmedName;
    const trimmedKey = projectKey.trim();
    if (trimmedKey !== initial.key) {
      patch.key = trimmedKey.length > 0 ? trimmedKey : null;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription !== initial.description) {
      patch.description = trimmedDescription.length > 0 ? trimmedDescription : null;
    }
    const wikiPaths = splitLines(wikiPathsRaw);
    if (!arraysEqual(wikiPaths, project.wiki_paths)) {
      patch.wiki_paths = wikiPaths;
    }
    const cwds = splitLines(cwdsRaw);
    if (!arraysEqual(cwds, project.cwds)) {
      patch.cwds = cwds;
    }
    if (enabled !== initial.enabled) {
      patch.enabled = enabled ? 1 : 0;
    }
    return patch;
  }

  const patch = buildPatch();
  const hasChanges = Object.keys(patch).length > 0;
  const canSubmit = trimmedName.length > 0 && hasChanges && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const updated = await api.updateProject(project.id, patch);
      toastSuccess(`Project updated: ${updated.name}`);
      onUpdated(updated);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to update project';
      setErr(message);
      toastError(message);
      setSubmitting(false);
    }
  }

  return (
    <Modal.Overlay onClose={onClose}>
      <Modal.Content className="w-[560px] max-w-[calc(100vw-2rem)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Project settings"
          data-testid="project-settings-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex flex-col">
                <span>Project settings</span>
                <span
                  data-testid="project-settings-id"
                  className="font-mono text-xs text-muted truncate"
                >
                  {project.id}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close"
                data-testid="project-settings-close"
                onClick={onClose}
                className="rounded p-1 text-muted hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
          </Modal.Header>
          <Modal.Body className="p-5 space-y-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Name <span className="text-danger">*</span>
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="project-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Ticket prefix (key)
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="project-settings-key"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder="MP"
                className="font-mono uppercase"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Description
              </span>
              <Textarea
                size="sm"
                data-testid="project-settings-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this project is for…"
              />
            </label>
            <MultilineListInput
              testId="project-settings-wiki-paths"
              label="Wiki paths (one per line)"
              placeholder="docs"
              value={wikiPathsRaw}
              onChange={setWikiPathsRaw}
            />
            <MultilineListInput
              testId="project-settings-cwds"
              label="Working directories (one per line, absolute)"
              placeholder="/Users/me/dev/my-project"
              value={cwdsRaw}
              onChange={setCwdsRaw}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="project-settings-enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-foreground">
                Enabled (surfaces in the active project switcher)
              </span>
            </label>
            {err && (
              <p
                role="alert"
                data-testid="project-settings-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="project-settings-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="project-settings-submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Overlay>
  );
}

export default ProjectSettingsModal;
