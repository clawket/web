import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DetailBreadcrumb from './DetailBreadcrumb';

describe('DetailBreadcrumb', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<DetailBreadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single current plan crumb without separators', () => {
    render(
      <DetailBreadcrumb
        items={[
          {
            type: 'plan',
            id: 'PLAN-1',
            label: 'v3.0 release',
            ticket: 'CK-1',
            status: 'active',
          },
        ]}
      />,
    );
    const current = screen.getByTestId('detail-breadcrumb-plan');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.textContent).toContain('v3.0 release');
    expect(current.textContent).toContain('CK-1');
    // No clickable button when current
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders Plan > Unit chain with the unit as current', () => {
    render(
      <DetailBreadcrumb
        items={[
          { type: 'plan', id: 'PLAN-1', label: 'Parent plan' },
          { type: 'unit', id: 'UNIT-1', label: 'Phase A' },
        ]}
      />,
    );
    const plan = screen.getByTestId('detail-breadcrumb-plan');
    const unit = screen.getByTestId('detail-breadcrumb-unit');
    expect(plan).not.toHaveAttribute('aria-current');
    expect(unit).toHaveAttribute('aria-current', 'page');
    expect(plan.querySelector('button')).not.toBeNull();
    expect(unit.querySelector('button')).toBeNull();
  });

  it('renders Plan > Unit > Task chain with the task as current', () => {
    render(
      <DetailBreadcrumb
        items={[
          { type: 'plan', id: 'PLAN-1', label: 'Plan A' },
          { type: 'unit', id: 'UNIT-1', label: 'Unit A' },
          { type: 'task', id: 'TASK-1', label: 'Task A', ticket: 'LM-1' },
        ]}
      />,
    );
    expect(screen.getByTestId('detail-breadcrumb-plan').querySelector('button')).not.toBeNull();
    expect(screen.getByTestId('detail-breadcrumb-unit').querySelector('button')).not.toBeNull();
    const task = screen.getByTestId('detail-breadcrumb-task');
    expect(task).toHaveAttribute('aria-current', 'page');
    expect(task.textContent).toContain('LM-1');
  });

  it('fires onSelectItem with the clicked crumb identity', () => {
    const onSelectItem = vi.fn();
    render(
      <DetailBreadcrumb
        onSelectItem={onSelectItem}
        items={[
          { type: 'plan', id: 'PLAN-1', label: 'Plan A' },
          { type: 'unit', id: 'UNIT-1', label: 'Unit A' },
          { type: 'task', id: 'TASK-1', label: 'Task A' },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByTestId('detail-breadcrumb-plan').querySelector('button') as HTMLElement,
    );
    expect(onSelectItem).toHaveBeenCalledWith({ type: 'plan', id: 'PLAN-1' });
    fireEvent.click(
      screen.getByTestId('detail-breadcrumb-unit').querySelector('button') as HTMLElement,
    );
    expect(onSelectItem).toHaveBeenLastCalledWith({ type: 'unit', id: 'UNIT-1' });
  });

  it('disables crumbs when onSelectItem is omitted', () => {
    render(
      <DetailBreadcrumb
        items={[
          { type: 'plan', id: 'PLAN-1', label: 'Plan A' },
          { type: 'unit', id: 'UNIT-1', label: 'Unit A' },
        ]}
      />,
    );
    const planBtn = screen.getByTestId('detail-breadcrumb-plan').querySelector('button');
    expect(planBtn).toBeDisabled();
  });
});
