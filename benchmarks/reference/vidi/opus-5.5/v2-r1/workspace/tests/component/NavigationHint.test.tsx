import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import { dispatchWheel, nextFrame, renderBoard, useFakeFrames } from './helpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('nav.hint_display', () => {
  it('renders the hint text when visible and nothing when hidden', () => {
    const { rerender, container } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('TC-22 visible → hidden after the first camera change → stays hidden', () => {
    useFakeFrames();
    const { viewport } = renderBoard();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeNull();

    fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 20, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    nextFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();

    dispatchWheel(viewport, { deltaY: 50 });
    nextFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    nextFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });
});
