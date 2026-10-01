import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(cleanup);

function renderFor(zoom: number, cbs = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() }) {
  const cam = { x: 0, y: 0, zoom };
  render(<ZoomControls zoomPercent={zoomPercent(cam)} canZoomIn={canZoomIn(cam)} canZoomOut={canZoomOut(cam)} {...cbs} />);
  return cbs;
}

describe('ZoomControls', () => {
  it('TC-19 at ZOOM_MIN zoom out is disabled', () => {
    renderFor(ZOOM_MIN);
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX zoom in is disabled', () => {
    renderFor(ZOOM_MAX);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('400%');
  });

  it('TC-21 label is rounded', () => {
    renderFor(1.5625);
    expect(screen.getByRole('status').textContent).toBe('156%');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('calls callbacks when enabled', () => {
    const cbs = renderFor(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(cbs.onZoomIn).toHaveBeenCalledOnce();
    expect(cbs.onZoomOut).toHaveBeenCalledOnce();
    expect(cbs.onReset).toHaveBeenCalledOnce();
  });

  it('TC-32 clicking a disabled button does nothing', () => {
    const cbs = renderFor(ZOOM_MIN);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(cbs.onZoomOut).not.toHaveBeenCalled();
  });
});
