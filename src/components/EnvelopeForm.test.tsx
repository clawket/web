/**
 * LM-150 / RL-U6-01 — EnvelopeForm renders the 19 ADR-0001 envelope
 * fields and round-trips PATCH /tasks/:id { envelope } through the
 * api module. The contract under test:
 *
 *  1. All 19 canonical fields render labelled inputs (the form is the
 *     only authoring surface for envelopes in the dashboard).
 *  2. List fields parse newline-separated input into string arrays.
 *  3. Submit calls api.updateTaskEnvelope with the *current draft* —
 *     no field rename, no key drop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnvelopeForm from './EnvelopeForm';
import { ENVELOPE_FIELDS } from '../types';

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

const SEED = {
  raw_envelope: {
    version: 1,
    intent: 'seed intent',
    target_repo: 'web',
    target_model: 'sonnet',
    max_turns: 40,
    prompt_template: 'do the thing',
    context_refs: ['LM-1', 'LM-2'],
    scope_boundary: ['web/src/**'],
    atomic_size_hint: 'small',
    success_criteria: ['form renders', 'patch wired'],
    verification_cmd: 'pnpm test',
    depends_on: [],
    blocked_by: [],
    planned_sha: 'web@HEAD',
    decomposition_policy: 'auto',
    checkpoint_interval: 5,
    rollback_strategy: 'git revert',
    origin: 'plan',
    assigned_model: 'sonnet',
  },
  resolved_envelope: {},
  inheritance_chain: ['TASK-X'],
  version: 3,
  superseded: false,
};

beforeEach(() => {
  mockedApi.getTaskEnvelope.mockReset();
  mockedApi.updateTaskEnvelope.mockReset();
  mockedApi.clearTaskEnvelope.mockReset();
  mockedApi.validateTaskEnvelope.mockReset();
  // Validation effect fires after 400ms debounce — these LM-150 round-trip
  // tests don't assert on it, so a clean default keeps them quiet.
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

describe('EnvelopeForm', () => {
  it('renders a labelled input for every ADR-0001 envelope field', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED);

    render(<EnvelopeForm taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    for (const field of ENVELOPE_FIELDS) {
      const labels = screen.getAllByText(field, { exact: true });
      expect(labels.length, `expected a label for ${field}`).toBeGreaterThan(0);
    }
  });

  it('renders empty form when daemon has no active envelope (404)', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(null);

    render(<EnvelopeForm taskId="TASK-EMPTY" />);

    await waitFor(() => {
      expect(screen.getByText('No envelope yet')).toBeInTheDocument();
    });

    // List inputs should be present and empty.
    const intentInput = document.getElementById('env-field-intent') as HTMLTextAreaElement | null;
    expect(intentInput).not.toBeNull();
    expect(intentInput!.value).toBe('');
  });

  it('PATCHes the edited envelope and re-syncs from the daemon response', async () => {
    mockedApi.getTaskEnvelope
      .mockResolvedValueOnce(SEED) // initial load
      .mockResolvedValueOnce({ ...SEED, raw_envelope: { ...SEED.raw_envelope, intent: 'edited intent' }, version: 4 });
    mockedApi.updateTaskEnvelope.mockResolvedValue({ task: { id: 'TASK-X' }, active_envelope: {} });

    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<EnvelopeForm taskId="TASK-X" onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    const intentInput = document.getElementById('env-field-intent') as HTMLTextAreaElement;
    await user.clear(intentInput);
    await user.type(intentInput, 'edited intent');

    expect(screen.getByText('unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save envelope/i }));

    await waitFor(() => expect(mockedApi.updateTaskEnvelope).toHaveBeenCalledTimes(1));

    const [taskId, envelope] = mockedApi.updateTaskEnvelope.mock.calls[0];
    expect(taskId).toBe('TASK-X');
    expect((envelope as { intent: string }).intent).toBe('edited intent');
    // Field list preserved verbatim — 19 canonical keys plus only the
    // edits the user made, no silent drops.
    const keys = Object.keys(envelope as object);
    for (const f of ENVELOPE_FIELDS) {
      // Empty arrays are dropped by setField; the seed has empty
      // `depends_on` and `blocked_by`, so allow those to be absent.
      if (f === 'depends_on' || f === 'blocked_by') continue;
      expect(keys, `expected ${f} in submitted envelope`).toContain(f);
    }

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText(/Active version: v4/)).toBeInTheDocument();
    });
  });

  it('parses newline-separated list fields into string arrays', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue({ ...SEED, raw_envelope: {} });
    mockedApi.updateTaskEnvelope.mockResolvedValue({ task: { id: 'TASK-X' }, active_envelope: {} });
    // Second load after submit so the form re-syncs without throwing.
    mockedApi.getTaskEnvelope.mockResolvedValueOnce({ ...SEED, raw_envelope: {} });

    const user = userEvent.setup();
    render(<EnvelopeForm taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    const refsInput = document.getElementById('env-field-context_refs') as HTMLTextAreaElement;
    fireEvent.change(refsInput, { target: { value: 'LM-10\nLM-20\nLM-30' } });

    await user.click(screen.getByRole('button', { name: /save envelope/i }));

    await waitFor(() => expect(mockedApi.updateTaskEnvelope).toHaveBeenCalled());
    const [, envelope] = mockedApi.updateTaskEnvelope.mock.calls[0];
    expect((envelope as { context_refs: string[] }).context_refs).toEqual(['LM-10', 'LM-20', 'LM-30']);
  });

  it('blocks submit when no fields are dirty', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED);

    render(<EnvelopeForm taskId="TASK-X" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    const form = screen.getByRole('form', { name: /envelope-form/i });
    const submitButton = within(form).getByRole('button', { name: /save envelope/i });
    expect(submitButton).toBeDisabled();
  });
});
