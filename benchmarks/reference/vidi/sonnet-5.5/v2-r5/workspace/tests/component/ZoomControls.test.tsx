import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(cleanup);

function renderFor(zoom: number) {
  const cam: Camera = { x: 0, y: 0, zoom };
  const cbs = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      {...cbs}
    />,
  );
  return cbs;
}

describe('ZoomControls', () => {
  it('TC-19 at ZOOM_MIN zoom out is disabled', () => {
    renderFor(ZOOM_MIN);
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('TC-20 at ZOOM_MAX zoom in is disabled', () => {
    renderFor(ZOOM_MAX);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('400%')).toBeTruthy();
  });

  it('TC-21 label is rounded to a whole percent', () => {
    renderFor(1.5625);
    expect(screen.getByText('156%')).toBeTruthy();
  });

  it('announces politely and exposes Reset view', () => {
    const cbs = renderFor(1);
    expect(screen.getByText('100%').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(cbs.onReset).toHaveBeenCalledTimes(1);
    expect(cbs.onZoomIn).toHaveBeenCalledTimes(1);
    expect(cbs.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const cbs = renderFor(ZOOM_MIN);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(cbs.onZoomOut).not.toHaveBeenCalled();
  });
});
