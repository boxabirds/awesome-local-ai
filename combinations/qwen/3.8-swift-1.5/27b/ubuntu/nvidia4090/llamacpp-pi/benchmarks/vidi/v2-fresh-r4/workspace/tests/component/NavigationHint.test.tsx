import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';

/**
 * nav.hint_display component tests: TC-22 (and the null case).
 */

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nav.hint_display (NavigationHint)', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)); // found (getByText throws otherwise)
    unmount();
    render(<NavigationHint visible={false} />);
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });

  it('TC-22 the hint is visible, hidden after the first camera change, and stays hidden after a second', () => {
    render(<App />);

    // Visible on first use.
    expect(screen.getByText(NAVIGATION_HINT_TEXT)); // found (getByText throws otherwise)

    // First navigation: a plain wheel pan.
    const vp = document.querySelector<HTMLElement>('[data-vidi6="board-viewport"]')!;
    vp.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, cancelable: true, bubbles: true }));
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();

    // Second navigation: a zoom step from the control; the hint does not come back.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });
});
