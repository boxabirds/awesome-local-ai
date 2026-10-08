import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { renderBoard } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

describe('nav.hint_display (NavigationHint)', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22: the hint is visible at first, hides after the first camera change and stays hidden after further changes', () => {
    vi.useFakeTimers();
    const { getByTestId } = renderBoard({ withHint: true });
    const viewport = getByTestId('board-viewport');

    // Visible on the first visit.
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    // First navigation (a scroll pan) hides it.
    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 100 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Further navigation does not bring it back.
    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 100 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    vi.useRealTimers();
  });
});
