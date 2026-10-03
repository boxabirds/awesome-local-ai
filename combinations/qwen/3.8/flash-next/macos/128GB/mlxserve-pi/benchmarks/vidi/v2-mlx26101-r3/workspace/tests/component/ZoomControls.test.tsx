import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

/** user-event has to be able to advance the faked animation-frame timers. */
function user() {
  return userEvent.setup({
    advanceTimers: (ms?: number) => {
      void vi.advanceTimersByTimeAsync(ms ?? 0);
    },
  });
}

interface Handlers {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

function cameraAt(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function renderControls(zoom: number, canZoomIn: boolean, canZoomOut: boolean): Handlers {
  const handlers: Handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cameraAt(zoom))}
      canZoomIn={canZoomIn}
      canZoomOut={canZoomOut}
      onZoomIn={handlers.onZoomIn}
      onZoomOut={handlers.onZoomOut}
      onReset={handlers.onReset}
    />,
  );
  return handlers;
}

function zoomIn(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom in' });
}

function zoomOut(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom out' });
}

function resetView(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Reset view' });
}

function percentLabel(): HTMLElement {
  return screen.getByTestId('zoom-percent');
}

describe('zoom controls', () => {
  it('TC-19: at ZOOM_MIN the zoom-out button is disabled and the label reads 10%', async () => {
    renderControls(ZOOM_MIN, true, false);
    expect(zoomOut()).toBeDisabled();
    expect(zoomIn()).toBeEnabled();
    expect(percentLabel()).toHaveTextContent(`${zoomPercent(cameraAt(ZOOM_MIN))}%`);
    expect(percentLabel().textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX the zoom-in button is disabled and the label reads 400%', () => {
    renderControls(ZOOM_MAX, false, true);
    expect(zoomIn()).toBeDisabled();
    expect(zoomOut()).toBeEnabled();
    expect(percentLabel().textContent).toBe('400%');
  });

  it('TC-21: the label is the zoom rounded to a whole percent', () => {
    renderControls(1.5625, true, true);
    expect(percentLabel().textContent).toBe('156%');
  });

  it('announces the zoom level politely', () => {
    renderControls(1, true, true);
    expect(percentLabel()).toHaveAttribute('aria-live', 'polite');
  });

  it('zooms in, zooms out and resets when the buttons are enabled', async () => {
    const handlers = renderControls(1, true, true);
    const actor = user();
    await actor.click(zoomIn());
    await actor.click(zoomOut());
    await actor.click(resetView());
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32: a click on the disabled zoom-in button at ZOOM_MAX does nothing', async () => {
    const handlers = renderControls(ZOOM_MAX, false, true);
    await user().click(zoomIn());
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
    // Zooming back the other way still works (and re-enables zoom in in the app).
    await user().click(zoomOut());
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('TC-32b: a click on the disabled zoom-out button at ZOOM_MIN does nothing', async () => {
    const handlers = renderControls(ZOOM_MIN, true, false);
    await user().click(zoomOut());
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
    await user().click(zoomIn());
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('TC-32c: keyboard activation of a disabled button does nothing', async () => {
    const handlers = renderControls(ZOOM_MAX, false, true);
    const actor = user();
    zoomIn().focus();
    await actor.keyboard('{Enter}');
    await actor.keyboard(' ');
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
  });

  it('is reachable by keyboard', () => {
    renderControls(1, true, true);
    zoomIn().focus();
    expect(zoomIn()).toHaveFocus();
    expect(resetView()).toBeVisible();
  });

});
