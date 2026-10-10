import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';
import {
  dispatchWheel,
  flushFrame,
  hintElement,
  pointerEvent,
  renderBoard,
  viewportElement,
} from './helpers/board';

afterEach(cleanup);

describe('NavigationHint', () => {
  // TC-22
  it('TC-22 is visible initially, hides on the first camera change and stays hidden', async () => {
    renderBoard();
    expect(hintElement()).not.toBeNull();
    expect(hintElement()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    // First camera change: a pan.
    pointerEvent('pointerDown', viewportElement(), { x: 0, y: 0 });
    pointerEvent('pointerMove', viewportElement(), { x: 40, y: 20 });
    pointerEvent('pointerUp', viewportElement(), { x: 40, y: 20 });
    await flushFrame();
    expect(hintElement()).toBeNull();

    // Further navigation does not bring it back during this visit.
    dispatchWheel(viewportElement(), { deltaY: 100 });
    await flushFrame();
    expect(hintElement()).toBeNull();

    dispatchWheel(viewportElement(), { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(hintElement()).toBeNull();
  });

  it('hides on a zoom that never pans', async () => {
    renderBoard();
    dispatchWheel(viewportElement(), { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(hintElement()).toBeNull();
  });

  it('renders nothing when not visible, and shows the exact copy when visible', () => {
    const { rerender } = render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
