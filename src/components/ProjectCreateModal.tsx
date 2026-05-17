import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button, Input, Textarea } from './ui';
import { toastError, toastSuccess } from '../lib/toast';
import api, { type CreateProjectInput } from '../api';
import type { Project } from '../types';

export interface ProjectCreateModalProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

interface MultilineListInputProps {
  testId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}

function MultilineListInput({ testId, label, placeholder, value, onChange }: MultilineListInputProps) {
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

export function ProjectCreateModal({ onClose, onCreated }: ProjectCreateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [wikiPathsRaw, setWikiPathsRaw] = useState('');
  const [cwdsRaw, setCwdsRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const input: CreateProjectInput = { name: trimmedName };
      const trimmedDescription = description.trim();
      const trimmedKey = projectKey.trim();
      if (trimmedDescription.length > 0) input.description = trimmedDescription;
      if (trimmedKey.length > 0) input.key = trimmedKey;
      const wikiPaths = splitLines(wikiPathsRaw);
      const cwds = splitLines(cwdsRaw);
      if (wikiPaths.length > 0) input.wiki_paths = wikiPaths;
      if (cwds.length > 0) input.cwds = cwds;
      const created = await api.createProject(input);
      toastSuccess(`Project created: ${created.name}`);
      onCreated(created);
      onClose();
    } catch (e) {
      const message = (e as Error).message || 'Failed to create project';
      setErr(message);
      toastError(message);
      setSubmitting(false);
    }
  }

  return (
    <Modal.Overlay onClose={onClose}>
      <Modal.Content className="w-[520px] max-w-[calc(100vw-2rem)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create project"
          data-testid="project-create-modal"
        >
          <Modal.Header>
            <div className="flex items-center justify-between">
              <span>Create project</span>
              <button
                type="button"
                aria-label="Close"
                data-testid="project-create-close"
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
                data-testid="project-create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) handleSubmit();
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">
                Ticket prefix (key)
              </span>
              <Input
                size="sm"
                type="text"
                data-testid="project-create-key"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder="MP"
                className="font-mono uppercase"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted">Description</span>
              <Textarea
                size="sm"
                data-testid="project-create-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this project is for…"
              />
            </label>
            <MultilineListInput
              testId="project-create-wiki-paths"
              label="Wiki paths (one per line)"
              placeholder="docs"
              value={wikiPathsRaw}
              onChange={setWikiPathsRaw}
            />
            <MultilineListInput
              testId="project-create-cwds"
              label="Working directories (one per line, absolute)"
              placeholder="/Users/me/dev/my-project"
              value={cwdsRaw}
              onChange={setCwdsRaw}
            />
            {err && (
              <p
                role="alert"
                data-testid="project-create-error"
                className="text-sm text-danger"
              >
                {err}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="project-create-cancel"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="project-create-submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Overlay>
  );
}

export default ProjectCreateModal;
