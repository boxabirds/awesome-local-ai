import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

describe('NavigationHint (nav.hint)', () => {
  it('shows the navigation hint text when visible and renders nothing otherwise', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeVisible();
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBe(
      screen.getByTestId('navigation-hint'),
    );
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    const second = render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
    second.unmount();
  });

  // TC-22
  it('TC-22 is visible on open, hidden after the first camera change and stays hidden', () => {
    vi.useFakeTimers();
    render(<BoardViewport />);
    flush();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    // first camera change: a zoom step through the control
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    flush();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();

    // second camera change: still hidden
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    flush();
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
