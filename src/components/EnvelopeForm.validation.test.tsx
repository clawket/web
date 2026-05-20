/**
 * LM-151 / RL-U6-02 — Real-time envelope validation feedback.
 *
 * Contract under test (per task verification_cmd `pnpm test
 * EnvelopeForm.validation`):
 *
 *  1. Daemon violations render inline next to the offending field with
 *     `data-severity` so red/amber styling is observable in the DOM.
 *  2. The validation effect debounces — a burst of edits within the
 *     400ms window collapses to a single validate call. (Without this,
 *     the daemon would be hammered on every keystroke.)
 *  3. The race guard drops stale responses: a slow first request that
 *     resolves AFTER a fast second request must not overwrite the
 *     newer violations. (Token-based guard in EnvelopeForm.tsx.)
 *  4. Field-keyed bucketing surfaces nested-path violations under the
 *     array root (e.g. `preconditions[0]` shown next to preconditions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const SEED_EMPTY = {
  raw_envelope: {},
  resolved_envelope: {},
  inheritance_chain: ['TASK-V'],
  version: 1,
  superseded: false,
};

beforeEach(() => {
  mockedApi.getTaskEnvelope.mockReset();
  mockedApi.updateTaskEnvelope.mockReset();
  mockedApi.clearTaskEnvelope.mockReset();
  mockedApi.validateTaskEnvelope.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EnvelopeForm — real-time validation (LM-151)', () => {
  it('renders daemon violations inline with severity attributes', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED_EMPTY);
    mockedApi.validateTaskEnvelope.mockResolvedValue({
      valid: false,
      strict: true,
      violations: [
        { field: 'intent', severity: 'error', message: 'intent is required' },
        { field: 'prompt_template', severity: 'error', message: 'prompt_template is required' },
        { field: 'success_criteria', severity: 'error', message: 'success_criteria is required' },
        { field: 'target_model', severity: 'warning', message: 'recommended in strict mode' },
      ],
      evaluated_envelope: {},
    });

    render(<EnvelopeForm taskId="TASK-V" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // The 400ms debounce fires once after mount — wait for the violations
    // to appear in the DOM rather than racing the timer ourselves.
    const intentViolation = await screen.findByText('intent is required');
    expect(intentViolation).toHaveAttribute('data-severity', 'error');
    expect(intentViolation).toHaveAttribute('data-field', 'intent');

    const warning = screen.getByText('recommended in strict mode');
    expect(warning).toHaveAttribute('data-severity', 'warning');
    expect(warning).toHaveAttribute('data-field', 'target_model');
  });

  it('debounces validation across rapid edits', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED_EMPTY);
    mockedApi.validateTaskEnvelope.mockResolvedValue({
      valid: true,
      strict: true,
      violations: [],
      evaluated_envelope: {},
    });

    render(<EnvelopeForm taskId="TASK-V" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // Initial mount-load fires one validate after the debounce window.
    await waitFor(() => {
      expect(mockedApi.validateTaskEnvelope).toHaveBeenCalledTimes(1);
    });

    const intentInput = document.getElementById('env-field-intent') as HTMLTextAreaElement;
    // Three rapid keystrokes within the same debounce window should
    // collapse to a single additional call once the timer fires.
    fireEvent.change(intentInput, { target: { value: 'a' } });
    fireEvent.change(intentInput, { target: { value: 'ab' } });
    fireEvent.change(intentInput, { target: { value: 'abc' } });

    await waitFor(() => {
      expect(mockedApi.validateTaskEnvelope).toHaveBeenCalledTimes(2);
    });

    const lastCall = mockedApi.validateTaskEnvelope.mock.calls.at(-1)!;
    expect(lastCall[1].envelope).toMatchObject({ intent: 'abc' });
    expect(lastCall[1].strict).toBe(true);
  });

  it('drops stale validation responses (race guard)', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED_EMPTY);

    // First call resolves *late* with a stale violation; second call
    // resolves *early* with a clean draft. The form must show the
    // newer (clean) result, not the older (stale) one.
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockedApi.validateTaskEnvelope
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({
        valid: true,
        strict: true,
        violations: [],
        evaluated_envelope: {},
      });

    render(<EnvelopeForm taskId="TASK-V" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    // Wait for the in-flight call to register.
    await waitFor(() => {
      expect(mockedApi.validateTaskEnvelope).toHaveBeenCalledTimes(1);
    });

    // Second edit triggers a second debounced validate; the second
    // call resolves clean (no violations).
    const intentInput = document.getElementById('env-field-intent') as HTMLTextAreaElement;
    fireEvent.change(intentInput, { target: { value: 'fresh value' } });

    await waitFor(() => {
      expect(mockedApi.validateTaskEnvelope).toHaveBeenCalledTimes(2);
    });

    // No violations should be visible.
    expect(screen.queryByText('STALE — should not appear')).not.toBeInTheDocument();

    // Now resolve the stale first promise. The token guard must
    // prevent it from clobbering the clean state.
    resolveFirst({
      valid: false,
      strict: true,
      violations: [
        { field: 'intent', severity: 'error', message: 'STALE — should not appear' },
      ],
      evaluated_envelope: {},
    });

    // Give microtasks a chance to flush, then re-check.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('STALE — should not appear')).not.toBeInTheDocument();
  });

  it('buckets nested-path violations under their array root', async () => {
    mockedApi.getTaskEnvelope.mockResolvedValue(SEED_EMPTY);
    mockedApi.validateTaskEnvelope.mockResolvedValue({
      valid: false,
      strict: true,
      violations: [
        // Nested-field shape produced by the daemon validator for
        // arrays — the form must surface them next to the array input,
        // not silently drop them under an unknown root key.
        {
          field: 'success_criteria[0]',
          severity: 'error',
          message: 'success_criteria[0] must be a non-empty string',
        },
      ],
      evaluated_envelope: {},
    });

    render(<EnvelopeForm taskId="TASK-V" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading envelope...')).not.toBeInTheDocument();
    });

    const violation = await screen.findByText(/success_criteria\[0\] must be a non-empty string/);
    expect(violation).toHaveAttribute('data-severity', 'error');
    expect(violation).toHaveAttribute('data-field', 'success_criteria[0]');
  });

  it('suppresses validation when no envelope exists and draft is clean (LM-11028)', async () => {
    // ADR-0001 §Backwards Compatibility: a task with no active envelope
    // is legitimately envelope-less; running validation on an empty
    // draft would surface false "required field missing" warnings for a
    // contract the user never opted into. Validation is gated on
    // `version !== null || dirty` — clean envelope-less forms must not
    // call the daemon at all.
    mockedApi.getTaskEnvelope.mockResolvedValue(null);
    mockedApi.validateTaskEnvelope.mockResolvedValue(null);

    render(<EnvelopeForm taskId="TASK-NONE" />);

    await waitFor(() => {
      expect(
        screen.getByText('No envelope — optional; start editing to draft one'),
      ).toBeInTheDocument();
    });

    // Give the debounced validation effect ample time to fire — it must
    // not, because the gate suppresses validation in this state.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockedApi.validateTaskEnvelope).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-severity]').length).toBe(0);
  });
});
