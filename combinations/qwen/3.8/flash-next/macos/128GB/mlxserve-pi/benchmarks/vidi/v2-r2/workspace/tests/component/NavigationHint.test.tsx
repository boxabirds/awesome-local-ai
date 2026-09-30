// nav.hint_display: the first-use navigation hint, shown until the user's first
// pan or zoom and hidden for the rest of the visit. Cases TC-22, TC-29.

import { describe, expect, it } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  dragTo,
  flushFrames,
  hintVisible,
  hintText,
  pressKey,
  readCamera,
  renderBoard,
  useBoardTestLifecycle,
  wheelAt,
} from './helpers';

useBoardTestLifecycle();

describe('navigation hint', () => {
  it('renders the exact hint text when visible', () => {
    render(<NavigationHint visible />);
    expect(screen.getByTestId('nav-hint').textContent).toBe(
      'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom',
    );
    expect(NAVIGATION_HINT_TEXT).toBe('Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom');
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('nav-hint')).toBeNull();
  });

  describe('in the board', () => {
    useBoardTestLifecycle();

    // TC-22: visible on open, hidden by the first camera change, and it stays
    // hidden for the rest of the visit.
    it('TC-22 hides after the first pan and stays hidden', () => {
      renderBoard();
      expect(hintVisible()).toBe(true);
      expect(hintText()).toBe('Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom');

      dragTo({ x: 400, y: 400 }, { x: 300, y: 350 });
      expect(hintVisible()).toBe(false);

      // further navigation does not bring it back
      dragTo({ x: 500, y: 500 }, { x: 700, y: 600 });
      wheelAt(screen.getByTestId('board-viewport'), { deltaY: 120, clientX: 400, clientY: 400 });
      flushFrames();
      expect(hintVisible()).toBe(false);
      expect(screen.queryByText(NAVIGATION_HINT_TEXT)).toBeNull();
    });

    it('TC-22b hides for a zoom as well as a pan', () => {
      renderBoard();
      expect(hintVisible()).toBe(true);
      pressKey('=', { ctrlKey: true });
      flushFrames();
      expect(hintVisible()).toBe(false);
      expect(readCamera().zoom).toBe(1.25);
    });

    it('TC-29 keeps the hint for a press that never moved the board', () => {
      renderBoard();
      const before = readCamera();
      dragTo({ x: 500, y: 400 }, { x: 500, y: 400 });
      expect(readCamera()).toEqual(before);
      expect(hintVisible()).toBe(true);
    });

    it('TC-22c hides when the zoom buttons are used', () => {
      renderBoard();
      expect(hintVisible()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      flushFrames();
      expect(hintVisible()).toBe(false);
      expect(readCamera().zoom).toBe(1.25);
    });
  });
});
