import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderFor(zoom: number) {
  const cam: Camera = { x: 0, y: 0, zoom };
  const handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
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

describe('ZoomControls (zoom.controls)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderFor(ZOOM_MIN);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(screen.getByRole('status')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderFor(ZOOM_MAX);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('400%');
  });

  it('TC-21 at 1.5625 the label is rounded to 156%', () => {
    renderFor(1.5625);
    expect(screen.getByRole('status')).toHaveTextContent('156%');
  });

  it('label is an aria-live output and Reset view is a focusable button', () => {
    renderFor(1);
    const label = screen.getByRole('status');
    expect(label.tagName).toBe('OUTPUT');
    expect(label).toHaveAttribute('aria-live', 'polite');
    const reset = screen.getByRole('button', { name: 'Reset view' });
    reset.focus();
    expect(reset).toHaveFocus();
  });

  it('enabled buttons call their callbacks', async () => {
    const user = userEvent.setup();
    const h = renderFor(1);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);
    expect(h.onZoomOut).toHaveBeenCalledTimes(1);
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const atMin = renderFor(ZOOM_MIN);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(atMin.onZoomOut).not.toHaveBeenCalled();
  });

  it('TC-32 clicking disabled Zoom in at ZOOM_MAX does not call its callback', async () => {
    const user = userEvent.setup();
    const atMax = renderFor(ZOOM_MAX);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(atMax.onZoomIn).not.toHaveBeenCalled();
  });
});
