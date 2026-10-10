import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

afterEach(() => {
  cleanup();
});

function renderControls(zoom: number) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  const camera = { x: 0, y: 0, zoom };
  const view = render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  return {
    view,
    onZoomIn,
    onZoomOut,
    onReset,
    zoomOut: screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement,
    zoomIn: screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement,
    reset: screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement,
    label: screen.getByTestId('zoom-label'),
  };
}

describe('zoom.controls', () => {
  it('TC-19 disables Zoom out at ZOOM_MIN and shows 10%', () => {
    const controls = renderControls(ZOOM_MIN);

    expect(controls.zoomOut.disabled).toBe(true);
    expect(controls.zoomIn.disabled).toBe(false);
    expect(controls.label.textContent).toBe('10%');
    expect(controls.reset.disabled).toBe(false);
  });

  it('TC-20 disables Zoom in at ZOOM_MAX and shows 400%', () => {
    const controls = renderControls(ZOOM_MAX);

    expect(controls.zoomIn.disabled).toBe(true);
    expect(controls.zoomOut.disabled).toBe(false);
    expect(controls.label.textContent).toBe('400%');
  });

  it('TC-21 shows the zoom rounded to a whole percent', () => {
    const controls = renderControls(1.5625);
    expect(controls.label.textContent).toBe('156%');
    expect(controls.label.tagName.toLowerCase()).toBe('output');
    expect(controls.label.getAttribute('aria-live')).toBe('polite');
  });

  it('TC-32 clicking a disabled zoom button does nothing', async () => {
    const user = userEvent.setup();
    const controls = renderControls(ZOOM_MIN);

    await user.click(controls.zoomOut);
    expect(controls.onZoomOut).not.toHaveBeenCalled();
    expect(controls.onZoomIn).not.toHaveBeenCalled();
    expect(controls.onReset).not.toHaveBeenCalled();

    await user.click(controls.zoomIn);
    expect(controls.onZoomIn).toHaveBeenCalledTimes(1);

    await user.click(controls.reset);
    expect(controls.onReset).toHaveBeenCalledTimes(1);
  });

  it('zoom buttons and Reset view are keyboard focusable with accessible names', async () => {
    const user = userEvent.setup();
    const controls = renderControls(1);

    await user.tab();
    expect(document.activeElement).toBe(controls.zoomOut);
    await user.tab();
    expect(document.activeElement).toBe(controls.zoomIn);
    await user.tab();
    expect(document.activeElement).toBe(controls.reset);

    // Focus reaches the controls with the keyboard alone, and Enter works.
    await user.keyboard('{Enter}');
    expect(controls.onReset).toHaveBeenCalledTimes(1);
  });
});
