import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

type Handlers = { onZoomIn: Mock; onZoomOut: Mock; onReset: Mock };

function renderControls(camera: Camera, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}): Handlers {
  const handlers: Handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

const cameraAt = (zoom: number): Camera => ({ x: 0, y: 0, zoom });

describe('zoom.controls — rendering', () => {
  it('TC-19 disables Zoom out at ZOOM_MIN and shows 10%', () => {
    renderControls(cameraAt(ZOOM_MIN));
    expect(screen.getByLabelText('Zoom out').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Zoom in').hasAttribute('disabled')).toBe(false);
    expect(label()).toBe(`${Math.round(ZOOM_MIN * ZOOM_PERCENT_SCALE)}%`);
  });

  it('TC-20 disables Zoom in at ZOOM_MAX and shows 400%', () => {
    renderControls(cameraAt(ZOOM_MAX));
    expect(screen.getByLabelText('Zoom in').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Zoom out').hasAttribute('disabled')).toBe(false);
    expect(label()).toBe(`${Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE)}%`);
  });

  it('TC-21 rounds the label to a whole percent (1.5625 -> 156%)', () => {
    renderControls(cameraAt(1.5625));
    expect(label()).toBe('156%');
  });

  it('shows 100% and two enabled buttons at zoom 1', () => {
    renderControls(cameraAt(1));
    expect(label()).toBe(`${ZOOM_PERCENT_SCALE}%`);
    expect(screen.getByLabelText('Zoom in').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('Zoom out').hasAttribute('disabled')).toBe(false);
  });

  it('announces the zoom level and offers a keyboard-focusable Reset view', () => {
    renderControls(cameraAt(1));
    const output = screen.getByLabelText('Zoom level');
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(output.tagName.toLowerCase()).toBe('output');
    const reset = screen.getByRole('button', { name: 'Reset view' });
    expect(reset).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Zoom' })).not.toBeNull();
  });
});

describe('zoom.controls — clicks', () => {
  it('calls the callbacks for one step in, one step out and reset', () => {
    const handlers = renderControls(cameraAt(1));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 ignores clicks on a disabled zoom button', () => {
    const handlers = renderControls(cameraAt(ZOOM_MAX));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });

  it('TC-32 ignores a keyboard activation of a disabled zoom button', () => {
    const handlers = renderControls(cameraAt(ZOOM_MIN));
    fireEvent.keyDown(screen.getByLabelText('Zoom out'), { key: 'Enter' });
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
  });

  it('reflects the zoom ladder the buttons walk (100 -> 125 -> 100)', () => {
    const { rerender } = render(<ZoomControls zoomPercent={zoomPercent(cameraAt(1))} canZoomIn canZoomOut onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    expect(label()).toBe(`${ZOOM_PERCENT_SCALE}%`);
    rerender(
      <ZoomControls
        zoomPercent={zoomPercent(cameraAt(ZOOM_STEP_FACTOR))}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(label()).toBe(`${Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE)}%`);
  });
});

function label(): string {
  return screen.getByLabelText('Zoom level').textContent ?? '';
}
