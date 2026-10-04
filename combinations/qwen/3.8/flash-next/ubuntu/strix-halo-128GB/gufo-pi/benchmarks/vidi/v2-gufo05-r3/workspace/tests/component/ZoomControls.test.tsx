import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderAt(zoom: number, handlers: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const cam: Camera = { x: 0, y: 0, zoom };
  const props = {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...handlers,
  };
  const { container } = render(<ZoomControls {...props} />);
  const zoomIn = container.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;
  const zoomOut = container.querySelector('[aria-label="Zoom out"]') as HTMLButtonElement;
  const reset = container.querySelector<HTMLButtonElement>('.zoom-reset')!;
  const label = container.querySelector('.zoom-label')!;
  return { zoomIn, zoomOut, reset, label, props };
}

describe('ZoomControls (TC-19, TC-20, TC-21, TC-32)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    const { zoomIn, zoomOut, label } = renderAt(ZOOM_MIN);
    expect(zoomOut).toBeDisabled();
    expect(zoomIn).toBeEnabled();
    expect(label.textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    const { zoomIn, zoomOut, label } = renderAt(ZOOM_MAX);
    expect(zoomIn).toBeDisabled();
    expect(zoomOut).toBeEnabled();
    expect(label.textContent).toBe('400%');
  });

  it('TC-21 zoom 1.5625 shows a rounded 156% label', () => {
    const { label } = renderAt(1.5625);
    expect(label.textContent).toBe('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const { zoomIn, props } = renderAt(ZOOM_MAX);
    fireEvent.click(zoomIn);
    expect(props.onZoomIn).not.toHaveBeenCalled();
  });

  it('clicking enabled buttons calls the right callbacks', () => {
    const { zoomIn, zoomOut, reset, props } = renderAt(1);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomOut);
    fireEvent.click(reset);
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('zoom label is announced politely', () => {
    const { label } = renderAt(1);
    expect(label).toHaveAttribute('aria-live', 'polite');
  });
});
