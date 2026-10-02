import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { Harness } from './harness';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

describe('nav.hint_display (NavigationHint)', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(NAVIGATION_HINT_TEXT);
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22 visible -> hidden after first camera change -> stays hidden after a second', () => {
    render(<Harness withHint />);
    const vp = screen.getByTestId('board-viewport');

    // Visible on first use.
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();

    // First pan dismisses it.
    act(() => {
      fireEvent.pointerDown(vp, { clientX: 640, clientY: 400, button: 0, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerMove(vp, { clientX: 740, clientY: 450, button: 0, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(vp, { clientX: 740, clientY: 450, button: 0, pointerId: 1, pointerType: 'mouse' });
    });
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // A second navigation keeps it hidden for the rest of the visit.
    act(() => {
      fireEvent.wheel(vp, {
        clientX: 100,
        clientY: 100,
        deltaX: 50,
        deltaY: 0,
        deltaMode: 0,
      });
    });
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
