import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint';
import { firePointer, fireWheel, renderBoard, settle } from './helpers';

afterEach(cleanup);

describe('NavigationHint', () => {
  it('renders the exact navigation hint text when visible and nothing otherwise', () => {
    const { rerender } = render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint.textContent).toBe('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');
    expect(hint.textContent).toBe(NAVIGATION_HINT_TEXT);

    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  // TC-22
  it('TC-22 is visible on open, hidden by the first camera change and stays hidden', async () => {
    const board = renderBoard();
    expect(board.hint()).not.toBeNull();
    expect(board.hasNavigated()).toBe(false);

    fireWheel(board.viewport, { deltaY: 100 });
    await settle();
    expect(board.hint()).toBeNull();
    expect(board.hasNavigated()).toBe(true);

    // A second navigation does not bring it back for this visit.
    fireWheel(board.viewport, { deltaY: -100 });
    await settle();
    expect(board.hint()).toBeNull();
    expect(board.hasNavigated()).toBe(true);
  });

  // TC-29 (hint half): a click that does not move the camera keeps the hint.
  it('keeps the hint for a click without movement', async () => {
    const board = renderBoard();

    firePointer(board.viewport, 'pointerdown', 400, 400);
    firePointer(board.viewport, 'pointerup', 400, 400);
    await settle();

    expect(board.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(board.hint()).not.toBeNull();
    expect(board.hasNavigated()).toBe(false);
  });

  it('hides for a zoom and keeps the zoom controls reading the same value', async () => {
    const board = renderBoard();

    fireWheel(board.viewport, { metaKey: true, deltaY: -100, clientX: 600, clientY: 400 });
    await settle();

    expect(board.hasNavigated()).toBe(true);
    expect(board.hint()).toBeNull();
    // The percentage the label shows follows the camera (PRD zoom.indicator).
    expect(board.zoomLabel()).toBe(`${Math.round(board.camera().zoom * 100)}%`);
  });
});
