/**
 * LM-91 / RL-U6-08 — EnvelopeForm inheritance chain visualization.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * EnvelopeForm.inheritance`):
 *
 *  1. The form fetches the active envelope with `resolve=true` so the
 *     `inheritance_chain` is available, then loads each ancestor's
 *     raw envelope to compute per-field provenance.
 *  2. A 2-depth chain (parent + self) labels every field with one of:
 *     - "override" — value lives in this task's raw envelope
 *     - "inherited from ...XXXXXX" — value comes from the closest
 *       ancestor that defines it
 *     - (no badge) — unset everywhere on the chain
 *  3. The closest ancestor wins under deep-merge semantics, even when
 *     a more distant ancestor also defines the same field.
 *  4. Inherited values are rendered (greyed, formatted) so the user
 *     can see what they would inherit before deciding to override.
 *  5. The chain summary at the top of the form lists every ancestor
 *     for the current task.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import EnvelopeForm from './EnvelopeForm';

vi.mock('../api', () => {
  const getTaskEnvelope = vi.fn();
  const updateTaskEnvelope = vi.fn();
  const clearTaskEnvelope = vi.fn();
  const validateTaskEnvelope = vi.fn();
  const namespace = { getTaskEnvelope, updateTaskEnvelope, clearTaskEnvelope, validateTaskEnvelope };
  return { default: namespace, ...namespace };
});

import api from '../api';

const mockedApi = api as unknown as {
  getTaskEnvelope: ReturnType<typeof vi.fn>;
  updateTaskEnvelope: ReturnType<typeof vi.fn>;
  clearTaskEnvelope: ReturnType<typeof vi.fn>;
  validateTaskEnvelope: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockedApi.getTaskEnvelope.mockReset();
  mockedApi.updateTaskEnvelope.mockReset();
  mockedApi.clearTaskEnvelope.mockReset();
  mockedApi.validateTaskEnvelope.mockReset();
  mockedApi.validateTaskEnvelope.mockResolvedValue({
    valid: true,
    strict: true,
    violations: [],
    evaluated_envelope: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EnvelopeForm — inheritance (LM-91)', () => {
  it('renders provenance badges for own and inherited fields in a 2-depth chain', async () => {
    // Self has only `intent` and `target_repo` overrides; rest comes
    // from parent. inheritance_chain is root-to-self.
    mockedApi.getTaskEnvelope.mockImplementation((id: string, opts?: { resolve?: boolean }) => {
      if (id === 'TASK-CHILD' && opts?.resolve) {
        return Promise.resolve({
          raw_envelope: {
            intent: 'child intent',
            target_repo: 'web',
          },
          resolved_envelope: {
            intent: 'child intent',
            target_repo: 'web',
            target_model: 'sonnet',
            verification_cmd: 'pnpm test',
            success_criteria: ['ok', 'fast'],
          },
          inheritance_chain: ['TASK-PARENT', 'TASK-CHILD'],
          version: 2,
          superseded: false,
        });
      }
      if (id === 'TASK-PARENT') {
        return Promise.resolve({
          raw_envelope: {
            intent: 'parent intent (overridden)',
            target_model: 'sonnet',
            verification_cmd: 'pnpm test',
            success_criteria: ['ok', 'fast'],
          },
          resolved_envelope: {},
          inheritance_chain: ['TASK-PARENT'],
          version: 1,
          superseded: false,
        });
      }
      return Promise.resolve(null);
    });

    render(<EnvelopeForm taskId="TASK-CHILD" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // Parent fetch is the second call to surface in-flight ancestors.
    await waitFor(() => {
      expect(mockedApi.getTaskEnvelope).toHaveBeenCalledWith('TASK-PARENT', { resolve: false });
    });

    // Inheritance chain summary shows the parent (excluding self).
    const chainBar = await screen.findByLabelText('inheritance-chain');
    expect(within(chainBar).getByText(/PARENT/)).toBeInTheDocument();

    // intent + target_repo are own (overridden by child).
    await waitFor(() => {
      expect(screen.getByTestId('provenance-intent')).toHaveTextContent('override');
    });
    expect(screen.getByTestId('provenance-target_repo')).toHaveTextContent('override');

    // target_model + verification_cmd + success_criteria inherited from parent.
    expect(screen.getByTestId('provenance-target_model')).toHaveTextContent(/inherited from \.\.\.PARENT/);
    expect(screen.getByTestId('provenance-verification_cmd')).toHaveTextContent(/inherited from \.\.\.PARENT/);
    expect(screen.getByTestId('provenance-success_criteria')).toHaveTextContent(/inherited from \.\.\.PARENT/);

    // Inherited value is shown so the user can see what they'd get.
    expect(screen.getByTestId('inherited-value-target_model')).toHaveTextContent('sonnet');
    expect(screen.getByTestId('inherited-value-success_criteria')).toHaveTextContent('ok, fast');

    // Fields neither task defines have no provenance badge.
    expect(screen.queryByTestId('provenance-rollback_strategy')).not.toBeInTheDocument();
  });

  it('the closest ancestor wins when multiple ancestors define the same field', async () => {
    // Chain: GRANDPARENT → PARENT → SELF. PARENT and GRANDPARENT both
    // define `target_model`; PARENT must win because deep-merge applies
    // root-to-self with last-write-wins.
    mockedApi.getTaskEnvelope.mockImplementation((id: string, opts?: { resolve?: boolean }) => {
      if (id === 'TASK-SELF' && opts?.resolve) {
        return Promise.resolve({
          raw_envelope: {},
          resolved_envelope: { target_model: 'sonnet' },
          inheritance_chain: ['TASK-GRAND', 'TASK-PARENT', 'TASK-SELF'],
          version: 1,
          superseded: false,
        });
      }
      if (id === 'TASK-PARENT') {
        return Promise.resolve({
          raw_envelope: { target_model: 'sonnet' },
          resolved_envelope: {},
          inheritance_chain: ['TASK-PARENT'],
          version: 1,
          superseded: false,
        });
      }
      if (id === 'TASK-GRAND') {
        return Promise.resolve({
          raw_envelope: { target_model: 'opus', intent: 'grand intent' },
          resolved_envelope: {},
          inheritance_chain: ['TASK-GRAND'],
          version: 1,
          superseded: false,
        });
      }
      return Promise.resolve(null);
    });

    render(<EnvelopeForm taskId="TASK-SELF" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // target_model attributed to PARENT (closest).
    await waitFor(() => {
      expect(screen.getByTestId('provenance-target_model')).toHaveTextContent(/inherited from \.\.\.PARENT/);
    });
    // intent only in GRANDPARENT — that wins.
    expect(screen.getByTestId('provenance-intent')).toHaveTextContent(/inherited from \.\.\.-GRAND/);
  });

  it('shows no inheritance chain bar when the task is itself a root', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue({
      raw_envelope: { intent: 'root intent' },
      resolved_envelope: { intent: 'root intent' },
      inheritance_chain: ['TASK-ROOT'],
      version: 1,
      superseded: false,
    });

    render(<EnvelopeForm taskId="TASK-ROOT" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    expect(screen.queryByLabelText('inheritance-chain')).not.toBeInTheDocument();
    // intent is own; no inherited badges anywhere.
    expect(screen.getByTestId('provenance-intent')).toHaveTextContent('override');
  });

  it('falls back gracefully when an ancestor envelope fetch fails', async () => {
    mockedApi.getTaskEnvelope.mockImplementation((id: string, opts?: { resolve?: boolean }) => {
      if (id === 'TASK-CHILD' && opts?.resolve) {
        return Promise.resolve({
          raw_envelope: { intent: 'child' },
          resolved_envelope: { intent: 'child', target_model: 'sonnet' },
          inheritance_chain: ['TASK-PARENT', 'TASK-CHILD'],
          version: 1,
          superseded: false,
        });
      }
      // Parent fetch fails — should not break the form.
      if (id === 'TASK-PARENT') return Promise.reject(new Error('parent fetch failed'));
      return Promise.resolve(null);
    });

    render(<EnvelopeForm taskId="TASK-CHILD" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // Own intent still shows; target_model can't be attributed (parent
    // raw missing) so it stays unset rather than crashing.
    await waitFor(() => {
      expect(screen.getByTestId('provenance-intent')).toHaveTextContent('override');
    });
    expect(screen.queryByTestId('provenance-target_model')).not.toBeInTheDocument();
  });
});
