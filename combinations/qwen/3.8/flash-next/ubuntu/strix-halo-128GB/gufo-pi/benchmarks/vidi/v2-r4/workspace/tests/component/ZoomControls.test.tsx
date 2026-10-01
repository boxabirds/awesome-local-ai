import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

interface Harness {
  camera: Camera;
  onZoomIn: ReturnType<typeof vi.fn>;
  onZoomOut: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
}

function renderControls(camera: Camera) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  const harness: Harness = { camera, onZoomIn, onZoomOut, onReset };
  return harness;
}

describe('ZoomControls (zoom.controls)', () => {
  // TC-19
  it('TC-19 disables Zoom out at ZOOM_MIN and labels 10%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  // TC-20
  it('TC-20 disables Zoom in at ZOOM_MAX and labels 400%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  // TC-21
  it('TC-21 rounds the label to the nearest whole percent', () => {
    renderControls({ x: 0, y: 0, zoom: 1.5625 });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('labels 100% and enables both buttons at zoom 1', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  });

  it('announces the zoom level politely', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const label = screen.getByTestId('zoom-label');
    expect(label.tagName).toBe('OUTPUT');
    expect(label).toHaveAttribute('aria-live', 'polite');
  });

  it('calls the callbacks when a button is clicked', async () => {
    const user = userEvent.setup();
    const harness = renderControls({ x: 0, y: 0, zoom: 1 });

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(harness.onZoomIn).toHaveBeenCalledTimes(1);
    expect(harness.onZoomOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(harness.onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32 does not call a callback for a disabled button', async () => {
    const user = userEvent.setup();
    const harness = renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(harness.onZoomIn).not.toHaveBeenCalled();
    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  it('TC-32 (min side) does not call Zoom out at the minimum zoom', async () => {
    const user = userEvent.setup();
    const harness = renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });

  it('exposes keyboard-focusable controls', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    zoomIn.focus();
    expect(zoomIn).toHaveFocus();
    const reset = screen.getByRole('button', { name: 'Reset view' });
    reset.focus();
    expect(reset).toHaveFocus();
  });
});
