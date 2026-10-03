import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type Camera, canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

/**
 * zoom.controls component tests: TC-19, TC-20, TC-21, TC-32.
 */

function renderControls(cam: Camera) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
}

describe('zoom.controls (ZoomControls)', () => {
  it('TC-19 at the minimum zoom: Zoom out is disabled, Zoom in enabled, label 10%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('10%')); // found (getByText throws otherwise)
  });

  it('TC-20 at the maximum zoom: Zoom in is disabled, label 400%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('400%')); // found (getByText throws otherwise)
  });

  it('TC-21 the label shows the zoom rounded to a whole percent (1.5625 -> 156%)', () => {
    renderControls({ x: 0, y: 0, zoom: 1.5625 });
    expect(screen.getByText('156%')); // found (getByText throws otherwise)
  });

  it('TC-32 clicking a disabled zoom button does not call its callback', async () => {
    const { onZoomOut } = renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
