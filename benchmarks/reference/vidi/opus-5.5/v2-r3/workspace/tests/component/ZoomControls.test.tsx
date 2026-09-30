import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { flushFrame, readCamera, renderApp, useFakeFrames } from './helpers';

function renderFor(cam: Camera) {
  const handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ZoomControls (zoom.controls)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('400%');
  });

  it('TC-21 mid zoom 1.5625: label 156%', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR });
    expect(screen.getByRole('status')).toHaveTextContent('156%');
  });

  it('label is a polite live region; Reset view is a focusable button', () => {
    renderFor({ x: 0, y: 0, zoom: 1 });
    const label = screen.getByRole('status');
    expect(label.tagName).toBe('OUTPUT');
    expect(label).toHaveAttribute('aria-live', 'polite');
    const reset = screen.getByRole('button', { name: 'Reset view' });
    reset.focus();
    expect(reset).toHaveFocus();
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const min = renderFor({ x: 0, y: 0, zoom: ZOOM_MIN });
    await user.click(screen.getAllByRole('button', { name: 'Zoom out' })[0]);
    expect(min.onZoomOut).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', async () => {
    const user = userEvent.setup();
    const h = renderFor({ x: 0, y: 0, zoom: 1 });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);
    expect(h.onZoomOut).toHaveBeenCalledTimes(1);
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });
});

describe('ZoomControls wired to the board', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('+ then − returns 100% → 125% → 100%; limits disable buttons; Reset returns to 100%', () => {
    const { viewport } = renderApp();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    const label = screen.getByRole('status', { name: 'Zoom level' });
    expect(label).toHaveTextContent('100%');

    zoomIn.click();
    flushFrame();
    expect(label).toHaveTextContent('125%');
    zoomOut.click();
    flushFrame();
    expect(label).toHaveTextContent('100%');

    for (let i = 0; i < 20; i++) {
      zoomIn.click();
      flushFrame();
    }
    expect(label).toHaveTextContent('400%');
    expect(zoomIn).toBeDisabled();
    const atMax = readCamera(viewport);
    zoomIn.click(); // TC-32: disabled button leaves camera unchanged
    flushFrame();
    expect(readCamera(viewport)).toEqual(atMax);

    zoomOut.click();
    flushFrame();
    expect(zoomIn).toBeEnabled();

    for (let i = 0; i < 30; i++) {
      zoomOut.click();
      flushFrame();
    }
    expect(label).toHaveTextContent('10%');
    expect(zoomOut).toBeDisabled();

    screen.getByRole('button', { name: 'Reset view' }).click();
    flushFrame();
    expect(label).toHaveTextContent('100%');
    expect(readCamera(viewport)).toEqual({
      x: -window.innerWidth / 2,
      y: -window.innerHeight / 2,
      zoom: 1,
    });
  });
});
