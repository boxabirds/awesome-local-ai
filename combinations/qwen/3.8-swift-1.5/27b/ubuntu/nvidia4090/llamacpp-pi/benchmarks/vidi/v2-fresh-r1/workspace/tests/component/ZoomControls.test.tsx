import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

afterEach(cleanup);

function cam(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  const utils = render(
    <ZoomControls
      zoomPercent={100}
      canZoomIn
      canZoomOut
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onZoomIn, onZoomOut, onReset, ...utils };
}

describe('zoom.controls (ZoomControls)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    const c = cam(0, 0, ZOOM_MIN);
    renderControls({ zoomPercent: zoomPercent(c), canZoomIn: true, canZoomOut: false });

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    const c = cam(0, 0, ZOOM_MAX);
    renderControls({ zoomPercent: zoomPercent(c), canZoomIn: false, canZoomOut: true });

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByText('400%')).toBeInTheDocument();
  });

  it('TC-21 zoom 1.5625 renders the rounded label 156%', () => {
    const c = cam(0, 0, 1.5625);
    renderControls({ zoomPercent: zoomPercent(c) });

    expect(screen.getByText('156%')).toBeInTheDocument();
  });

  it('TC-32 clicking a disabled zoom button does not call its callback', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(
      <ZoomControls
        zoomPercent={zoomPercent(cam(0, 0, ZOOM_MAX))}
        canZoomIn={false}
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks; Reset view always works', () => {
    const { onZoomIn, onZoomOut, onReset } = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
