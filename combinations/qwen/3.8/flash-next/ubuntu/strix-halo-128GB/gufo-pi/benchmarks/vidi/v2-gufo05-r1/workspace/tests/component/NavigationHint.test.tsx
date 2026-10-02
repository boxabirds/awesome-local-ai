import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { ZOOM_MIN } from '../../src/shared/config';
import { advanceFrames, renderBoard } from './harness';

describe('first-use navigation hint (nav.hint)', () => {
  // TC-22
  it('TC-22 shows the hint, hides it on the first camera change and stays hidden', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: 1 });
    expect(screen.getByTestId('navigation-hint')).toHaveTextContent(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    // First pan: hidden for the rest of the visit.
    const viewport = board.viewport();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 25, clientY: 25 });
    await advanceFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();

    // Second pan: still hidden.
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: -80, clientY: 40 });
    await advanceFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('is dismissed by a zoom as well as a pan', async () => {
    await renderBoard({ x: 0, y: 0, zoom: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await advanceFrames();
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('stays visible when a zoom attempt is a no-op at the limit', async () => {
    const board = await renderBoard({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    // A keyboard zoom-out at ZOOM_MIN does not change the camera, so the hint
    // is not dismissed.
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    await advanceFrames();
    expect(board.camera().zoom).toBe(ZOOM_MIN);
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
  });

  it('shows the exact product copy', () => {
    expect(NAVIGATION_HINT_TEXT).toBe(
      'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom',
    );
  });
});
