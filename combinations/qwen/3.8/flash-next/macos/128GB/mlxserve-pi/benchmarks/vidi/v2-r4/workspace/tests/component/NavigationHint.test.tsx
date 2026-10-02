import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';

const hint = () => screen.queryByTestId('navigation-hint');
const camera = () => {
  const hook = window.__vidi6;
  if (!hook) throw new Error('expected the test camera hook to be installed in test mode');
  return hook.getCamera();
};

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('nav.hint_display — through the board', () => {
  it('TC-22 shows on open, hides after the first navigation and stays hidden', () => {
    render(<App />);
    flushFrame();
    expect(hint()?.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    // first navigation: one zoom step
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    flushFrame();
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);
    expect(hint()).toBeNull();

    // further navigation does not bring it back
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    flushFrame();
    expect(camera().zoom).toBe(1);
    expect(hint()).toBeNull();
  });

  it('hides on the first pan by dragging too', () => {
    render(<App />);
    flushFrame();

    fireEvent.pointerDown(screen.getByTestId('board-viewport'), {
      clientX: 50,
      clientY: 50,
      button: 0,
      pointerId: 7,
    });
    fireEvent.pointerMove(screen.getByTestId('board-viewport'), { clientX: 70, clientY: 50, pointerId: 7 });
    flushFrame();

    expect(hint()).toBeNull();
  });

  it('hides on a plain scroll and on a wheel zoom', () => {
    render(<App />);
    flushFrame();

    act(() => {
      screen
        .getByTestId('board-viewport')
        .dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    });
    flushFrame();

    expect(hint()).toBeNull();
  });

  it('stays visible while nothing actually moves the camera', () => {
    render(<App />);
    flushFrame();
    const board = screen.getByTestId('board-viewport');

    // a click with no movement
    fireEvent.pointerDown(board, { clientX: 10, clientY: 10, button: 0, pointerId: 8 });
    fireEvent.pointerUp(board, { clientX: 10, clientY: 10, pointerId: 8 });
    flushFrame();
    expect(hint()).not.toBeNull();

    // a wheel event with no delta
    act(() => {
      board.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 0, bubbles: true, cancelable: true }));
    });
    flushFrame();
    expect(hint()).not.toBeNull();

    // the very first move does dismiss it
    act(() => {
      window.__vidi6?.setCamera({ x: 1, y: 0, zoom: 1 });
    });
    flushFrame();
    expect(hint()).toBeNull();
  });
});

describe('nav.hint_display — component contract', () => {
  it('renders the exact hint text when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    unmount();

    const { container } = render(<NavigationHint visible={false} />);
    expect(container.innerHTML).toBe('');
  });
});
