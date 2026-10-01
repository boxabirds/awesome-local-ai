import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderFor(zoom: number, handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() }) {
  const cam = { x: 0, y: 0, zoom };
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

describe('ZoomControls', () => {
  it('TC-19 at minimum zoom, Zoom out is disabled', () => {
    renderFor(ZOOM_MIN);
    expect(screen.getByLabelText('Zoom out')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Zoom in')).toHaveProperty('disabled', false);
    expect(screen.getByRole('status').textContent).toBe('10%');
  });

  it('TC-20 at maximum zoom, Zoom in is disabled', () => {
    renderFor(ZOOM_MAX);
    expect(screen.getByLabelText('Zoom in')).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toBe('400%');
  });

  it('TC-21 label is rounded', () => {
    renderFor(1.5625);
    expect(screen.getByRole('status').textContent).toBe('156%');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('calls callbacks for enabled buttons', () => {
    const h = renderFor(1);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByText('Reset view'));
    expect(h.onZoomIn).toHaveBeenCalledOnce();
    expect(h.onZoomOut).toHaveBeenCalledOnce();
    expect(h.onReset).toHaveBeenCalledOnce();
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const h = renderFor(ZOOM_MIN);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(h.onZoomOut).not.toHaveBeenCalled();
  });
});
