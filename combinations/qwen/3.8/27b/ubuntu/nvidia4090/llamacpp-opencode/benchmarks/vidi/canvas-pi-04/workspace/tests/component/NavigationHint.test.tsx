import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BoardHarness,
  cleanup,
  flushFrame,
  makeEvent,
  resetBoardForTests,
} from './helpers';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';

beforeEach(() => {
  vi.useFakeTimers();
  resetBoardForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('nav.hint_display (TC-22)', () => {
  it('TC-22 the hint is visible at first, hidden after the first camera change, and stays hidden', () => {
    render(<BoardHarness />);

    // Visible on load.
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe(NAVIGATION_HINT_TEXT);

    // First change: a drag.
    const vp = screen.getByTestId('board-viewport');
    act(() => {
      vp.dispatchEvent(
        makeEvent('pointerdown', {
          button: 0,
          pointerType: 'mouse',
          pointerId: 1,
          clientX: 100,
          clientY: 50,
        }),
      );
    });
    act(() => {
      vp.dispatchEvent(makeEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 100 }));
    });
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Second change: a zoom step. The hint does not come back.
    act(() => {
      screen.getByRole('button', { name: 'Zoom in' }).click();
    });
    flushFrame();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});
