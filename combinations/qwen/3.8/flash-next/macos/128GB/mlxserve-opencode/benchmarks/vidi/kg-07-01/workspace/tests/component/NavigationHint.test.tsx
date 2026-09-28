import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ZOOM_MAX } from '../../src/shared/config';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { nextFrame, pointer, renderBoard } from './helpers';

describe('NavigationHint (nav.hint_display)', () => {
  it('renders the hint text when visible and nothing when not', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeInTheDocument();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
  });

  it('TC-22 visible → hidden after the first camera change → stays hidden after another', () => {
    const { viewport } = renderBoard();
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
    pointer(viewport, 'down', 0, 0);
    pointer(viewport, 'move', 30, 0);
    pointer(viewport, 'up', 30, 0);
    nextFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
    pointer(viewport, 'down', 0, 0);
    pointer(viewport, 'move', 0, 30);
    pointer(viewport, 'up', 0, 30);
    nextFrame();
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
  });

  it('a no-op zoom at a limit does not dismiss the hint', () => {
    renderBoard();
    act(() => window.__vidi6!.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX }));
    act(() => screen.getByRole('button', { name: 'Zoom in' }).click());
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();
  });
});
