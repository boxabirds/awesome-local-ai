import { describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';

afterEach(() => {
  cleanup();
});

function renderControls(camera: Camera) {
  const handlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn()
  };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={camera.zoom < ZOOM_MAX}
      canZoomOut={camera.zoom > ZOOM_MIN}
      {...handlers}
    />
  );
  return handlers;
}

const cam = (zoom: number): Camera => ({ x: 0, y: 0, zoom });

describe('zoom.controls', () => {
  test('TC-19 at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    renderControls(cam(ZOOM_MIN));
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();
  });

  test('TC-20 at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    renderControls(cam(ZOOM_MAX));
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  test('TC-21 zoom 1.5625 renders the label rounded to 156%', () => {
    renderControls(cam(Math.pow(ZOOM_STEP_FACTOR, 2)));
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  test('TC-32 clicking a disabled button does not call its callback', () => {
    const handlers = renderControls(cam(ZOOM_MIN));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
  });

  test('buttons and reset call their callbacks when enabled', () => {
    const handlers = renderControls(cam(1));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });
});
