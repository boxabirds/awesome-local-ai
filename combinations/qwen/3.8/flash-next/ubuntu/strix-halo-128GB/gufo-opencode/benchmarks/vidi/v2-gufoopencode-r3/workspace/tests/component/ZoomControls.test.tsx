import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

function cameraWithZoom(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function renderControls(cam: Camera, handlers?: Partial<Parameters<typeof ZoomControls>[0]>) {
  return render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={cam.zoom < ZOOM_MAX}
      canZoomOut={cam.zoom > ZOOM_MIN}
      onZoomIn={handlers?.onZoomIn ?? (() => {})}
      onZoomOut={handlers?.onZoomOut ?? (() => {})}
      onReset={handlers?.onReset ?? (() => {})}
    />
  );
}

describe('zoom.controls (ZoomControls)', () => {
  it('TC-19 at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    renderControls(cameraWithZoom(ZOOM_MIN));
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    renderControls(cameraWithZoom(ZOOM_MAX));
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  it('TC-21 zoom 1.5625 renders the label rounded to 156%', () => {
    const cam = cameraWithZoom(ZOOM_STEP_FACTOR ** 2);
    expect(zoomPercent(cam)).toBe(156);
    renderControls(cam);
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('TC-32 clicking a disabled zoom button does not call its callback', async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderControls(cameraWithZoom(ZOOM_MAX), { onZoomIn, onZoomOut });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).toHaveBeenCalledTimes(0);
  });

  it('enabled buttons call their callbacks once per click', async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    renderControls(cameraWithZoom(1), { onZoomIn, onZoomOut, onReset });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('the Reset view button has an accessible name', () => {
    renderControls(cameraWithZoom(1));
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
  });
});
