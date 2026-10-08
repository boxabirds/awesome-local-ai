import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
} from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

interface ControlHandlers {
  onZoomIn: ReturnType<typeof vi.fn>;
  onZoomOut: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
}

function renderControls(cam: Camera): ControlHandlers {
  const handlers: ControlHandlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      onZoomIn={handlers.onZoomIn}
      onZoomOut={handlers.onZoomOut}
      onReset={handlers.onReset}
    />,
  );
  return handlers;
}

describe('zoom.controls (ZoomControls)', () => {
  it('TC-19: at ZOOM_MIN the Zoom out button is disabled, Zoom in is enabled and the label reads 10%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    const reset = screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement;

    expect(zoomOut.disabled).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;

    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
  });

  it('TC-21: a non-round zoom (1.5625) is labelled with the rounded percent (156%)', () => {
    renderControls({ x: 0, y: 0, zoom: 1.5625 });

    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('enabled buttons call their callbacks', () => {
    const handlers = renderControls({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32: clicking a disabled zoom button does not call its callback', () => {
    const handlers = renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;

    expect(zoomOut.disabled).toBe(true);
    fireEvent.click(zoomOut);

    expect(handlers.onZoomOut).not.toHaveBeenCalled();
  });
});
