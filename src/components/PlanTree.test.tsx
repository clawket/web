import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlanTree from './PlanTree';

vi.mock('../api', () => {
  const namespace = {
    listPlans: vi.fn(async () => []),
    listUnits: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    listCycles: vi.fn(async () => []),
    getPlanCounts: vi.fn(async () => null),
    updateTask: vi.fn(),
    ApiError: class ApiError extends Error {},
  };
  return { default: namespace, ...namespace };
});

describe('PlanTree empty state — web↔desktop parity (LM-10991)', () => {
  it("shows 'No plans yet' empty state with create CTA when project has no plans", async () => {
    const onCreatePlan = vi.fn();
    render(
      <PlanTree
        projectId="PROJ-1"
        selectedItem={null}
        onSelectItem={() => {}}
        onCreatePlan={onCreatePlan}
        onCreateUnit={() => {}}
        onCreateTask={() => {}}
      />,
    );
    const empty = await screen.findByTestId('sidebar-plans-empty');
    expect(empty).toHaveTextContent('No plans yet');
    expect(empty).toHaveTextContent('Create a plan to get started');
    const cta = screen.getByTestId('sidebar-empty-new-plan');
    expect(cta).toHaveTextContent('+ New Plan');
    expect(cta.tagName).toBe('BUTTON');
  });

  it('fires onCreatePlan when the empty-state CTA is clicked', async () => {
    const onCreatePlan = vi.fn();
    render(
      <PlanTree
        projectId="PROJ-1"
        selectedItem={null}
        onSelectItem={() => {}}
        onCreatePlan={onCreatePlan}
        onCreateUnit={() => {}}
        onCreateTask={() => {}}
      />,
    );
    const cta = await screen.findByTestId('sidebar-empty-new-plan');
    fireEvent.click(cta);
    await waitFor(() => expect(onCreatePlan).toHaveBeenCalledTimes(1));
  });
});
