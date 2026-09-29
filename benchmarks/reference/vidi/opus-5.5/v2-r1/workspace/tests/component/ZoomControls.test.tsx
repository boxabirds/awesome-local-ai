import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { type Camera, canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

afterEach(cleanup);

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

const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
const label = () => screen.getByRole('status');

describe('zoom.controls', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect(zoomOut().disabled).toBe(true);
    expect(zoomIn().disabled).toBe(false);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(label().textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect(zoomIn().disabled).toBe(true);
    expect(zoomOut().disabled).toBe(false);
    expect(label().textContent).toBe('400%');
  });

  it('TC-21 mid zoom 1.5625 shows a rounded whole percentage', () => {
    renderFor({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR });
    expect(label().textContent).toBe('156%');
  });

  it('label is an output announced politely', () => {
    renderFor({ x: 0, y: 0, zoom: 1 });
    expect(label().tagName).toBe('OUTPUT');
    expect(label().getAttribute('aria-live')).toBe('polite');
  });

  it('enabled buttons call their callbacks and are keyboard focusable', async () => {
    const user = userEvent.setup();
    const handlers = renderFor({ x: 0, y: 0, zoom: 1 });
    await user.click(zoomIn());
    await user.click(zoomOut());
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(document.activeElement).toBe(zoomOut());
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const atMin = renderFor({ x: 0, y: 0, zoom: ZOOM_MIN });
    await user.click(zoomOut());
    fireEvent.click(zoomOut());
    expect(atMin.onZoomOut).not.toHaveBeenCalled();
    cleanup();
    const atMax = renderFor({ x: 0, y: 0, zoom: ZOOM_MAX });
    await user.click(zoomIn());
    fireEvent.click(zoomIn());
    expect(atMax.onZoomIn).not.toHaveBeenCalled();
  });
});

describe('zoom.controls wired to the board', async () => {
  const { renderBoard, cameraFromDom, nextFrame, useFakeFrames } = await import('./helpers');

  afterEach(() => vi.useRealTimers());

  it('stepping through the buttons disables at the limits and reset returns to 100%', () => {
    useFakeFrames();
    renderBoard();
    for (let i = 0; i < 30; i++) {
      fireEvent.click(zoomIn());
      nextFrame();
    }
    expect(label().textContent).toBe('400%');
    expect(zoomIn().disabled).toBe(true);
    fireEvent.click(zoomOut());
    nextFrame();
    expect(zoomIn().disabled).toBe(false);
    for (let i = 0; i < 40; i++) {
      fireEvent.click(zoomOut());
      nextFrame();
    }
    expect(label().textContent).toBe('10%');
    expect(zoomOut().disabled).toBe(true);
    const before = cameraFromDom();
    fireEvent.click(zoomOut());
    nextFrame();
    expect(cameraFromDom()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    nextFrame();
    expect(label().textContent).toBe('100%');
    expect(cameraFromDom()).toEqual({ x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 });
  });
});
