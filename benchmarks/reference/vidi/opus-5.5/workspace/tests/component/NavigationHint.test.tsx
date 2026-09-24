import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';

const FRAME_MS = 20;
const DRAG = { dx: 200, dy: 100 } as const;
const START = { x: 400, y: 300 } as const;

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

describe('nav.hint_display', () => {
  it('shows the exact hint text when visible and nothing when hidden', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
  });

  it('TC-22 visible → hidden after first camera change → stays hidden after another', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout'] });
    render(<App />);
    const board = screen.getByTestId('board-viewport');
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeNull();

    fireEvent.pointerDown(board, { pointerId: 1, button: 0, clientX: START.x, clientY: START.y });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    fireEvent.pointerUp(board, { pointerId: 1, clientX: START.x + DRAG.dx, clientY: START.y + DRAG.dy });
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });
});
