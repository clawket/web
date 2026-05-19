import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverallProgressCard } from './SummaryView';

describe('OverallProgressCard', () => {
  it('counts done + cancelled together as Closed and reaches 100% when no active work remains', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={2}
        inProgress={0}
        todo={0}
        blocked={0}
        total={3}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('100.00%');
    expect(screen.getByText('Closed 3')).toBeTruthy();
  });

  it('counts only done toward Closed when no cancelled tasks exist', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={0}
        inProgress={1}
        todo={2}
        blocked={0}
        total={4}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('25.00%');
    expect(screen.getByText('Closed 1')).toBeTruthy();
    expect(screen.getByText('Active 1')).toBeTruthy();
    expect(screen.getByText('Todo 2')).toBeTruthy();
  });

  it('truncates percent to two decimal places (floor, not round)', () => {
    render(
      <OverallProgressCard
        done={1}
        cancelled={0}
        inProgress={0}
        todo={2}
        blocked={0}
        total={3}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('33.33%');
  });

  it('renders 0.00% with no tasks (zero total)', () => {
    render(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={0}
        todo={0}
        blocked={0}
        total={0}
      />,
    );
    expect(screen.getByTestId('overall-progress-percent').textContent).toBe('0.00%');
    expect(screen.getByText('Closed 0')).toBeTruthy();
  });

  it('shows Blocked legend entry only when blocked > 0', () => {
    const { rerender } = render(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={1}
        todo={1}
        blocked={0}
        total={2}
      />,
    );
    expect(screen.queryByText(/^Blocked/)).toBeNull();

    rerender(
      <OverallProgressCard
        done={0}
        cancelled={0}
        inProgress={1}
        todo={1}
        blocked={2}
        total={4}
      />,
    );
    expect(screen.getByText('Blocked 2')).toBeTruthy();
  });

  it('proportions bar segments against total (not segTotal minus cancelled)', () => {
    const { container } = render(
      <OverallProgressCard
        done={1}
        cancelled={1}
        inProgress={1}
        todo={0}
        blocked={1}
        total={4}
      />,
    );
    const bar = container.querySelector('[aria-hidden].rounded-full')!;
    const segments = Array.from(bar.querySelectorAll('div')) as HTMLDivElement[];
    expect(segments).toHaveLength(3);
    // closed = 2 / 4 = 50%, in_progress = 1 / 4 = 25%, blocked = 1 / 4 = 25%
    expect(segments[0].style.width).toBe('50%');
    expect(segments[1].style.width).toBe('25%');
    expect(segments[2].style.width).toBe('25%');
  });
});
