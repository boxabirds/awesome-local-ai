import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint';
import { resetCamera } from '../../src/client/canvas/camera';
import {
  dragBoard,
  fireKey,
  fireWheel,
  flushFrames,
  hint,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';
import { TEST_VIEWPORT } from './setup';

const START = resetCamera(TEST_VIEWPORT);

describe('NavigationHint', () => {
  it('renders the exact copy when visible and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(screen.getByTestId('navigation-hint').textContent).toBe(NAVIGATION_HINT_TEXT);
    unmount();

    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-22: shows on open, hides after the first camera change and stays hidden', () => {
    renderBoard();
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    // First camera change: a plain scroll.
    fireWheel(surface(), { deltaY: 100 });
    flushFrames();
    expect(readCamera()).not.toEqual(START);
    expect(hint()).toBeNull();

    // Second change: still hidden.
    fireWheel(surface(), { deltaX: 40 });
    flushFrames();
    expect(hint()).toBeNull();
  });

  it.each([
    ['drag', () => dragBoard({ x: 300, y: 300 }, { x: 420, y: 360 })],
    ['zoom button key', () => fireKey('=', { ctrl: true })],
    ['zoom out key', () => fireKey('-', { ctrl: true })],
  ] as const)('hides on the first %s', (_name, navigate) => {
    renderBoard();
    expect(hint()).not.toBeNull();
    navigate();
    flushFrames();
    expect(hint()).toBeNull();
  });

  it('stays visible for interaction that does not change the camera', () => {
    renderBoard();
    // Ctrl+0 when the board is already at the standard view is a no-op.
    fireKey('0', { ctrl: true });
    flushFrames();
    expect(readCamera()).toEqual(START);
    expect(hint()).not.toBeNull();
  });
});
