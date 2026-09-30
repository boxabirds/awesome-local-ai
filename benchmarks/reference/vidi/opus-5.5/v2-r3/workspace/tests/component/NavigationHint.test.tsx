import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import { flushFrame, renderApp, useFakeFrames } from './helpers';

describe('NavigationHint (nav.hint_display)', () => {
  it('renders the hint text when visible and nothing when hidden', () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeInTheDocument();
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
  });

  describe('in the app', () => {
    beforeEach(() => useFakeFrames());
    afterEach(() => vi.useRealTimers());

    it('TC-22 visible → hidden after first camera change → stays hidden after another', () => {
      const { viewport } = renderApp();
      expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeInTheDocument();

      fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 60, clientY: 40 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });
      flushFrame();
      expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();

      screen.getByRole('button', { name: 'Reset view' }).click();
      flushFrame();
      screen.getByRole('button', { name: 'Zoom in' }).click();
      flushFrame();
      expect(screen.queryByText(NAVIGATION_HINT_TEXT)).not.toBeInTheDocument();
    });
  });
});
