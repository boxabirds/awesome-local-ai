import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZOOM_MAX } from '../../src/shared/config';
import { flushFrame, renderApp } from './helpers';

describe('nav.hint_display', () => {
  it('renders the hint text only when visible', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeTruthy();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });

  it('TC-22 visible → hidden after the first camera change → stays hidden', () => {
    const { viewport } = renderApp();
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
    fireEvent.wheel(viewport(), { deltaY: 50 });
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
    fireEvent.wheel(viewport(), { deltaY: -50 });
    flushFrame();
    screen.getByRole('button', { name: 'Reset view' }).click();
    flushFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
  });

  it('a no-op zoom at a limit does not dismiss the hint', () => {
    renderApp();
    act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX }));
    flushFrame();
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    fireEvent.wheel(screen.getByTestId('board-viewport'), { deltaY: -100, ctrlKey: true });
    flushFrame();
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });
});
