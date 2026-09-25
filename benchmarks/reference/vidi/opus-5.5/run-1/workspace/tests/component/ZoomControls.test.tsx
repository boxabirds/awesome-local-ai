import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls, type ZoomControlsProps } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const PERCENT = 100;

function renderFor(zoom: number, overrides: Partial<ZoomControlsProps> = {}) {
  const cam: Camera = { x: 0, y: 0, zoom };
  const props: ZoomControlsProps = {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
const label = () => screen.getByRole('status', { name: 'Zoom level' });

describe('zoom.controls', () => {
  it('renders −, live percentage, + and Reset view with accessible names', () => {
    renderFor(1);
    expect(zoomOut().textContent).toBe('−');
    expect(zoomIn().textContent).toBe('+');
    expect(label().tagName).toBe('OUTPUT');
    expect(label().getAttribute('aria-live')).toBe('polite');
    expect(label().textContent).toBe(`${PERCENT}%`);
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy();
  });

  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderFor(ZOOM_MIN);
    expect(zoomOut().disabled).toBe(true);
    expect(zoomIn().disabled).toBe(false);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * PERCENT)}%`);
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderFor(ZOOM_MAX);
    expect(zoomIn().disabled).toBe(true);
    expect(zoomOut().disabled).toBe(false);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * PERCENT)}%`);
  });

  it('TC-21 zoom 1.5625 shows the rounded whole percentage 156%', () => {
    renderFor(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR);
    expect(label().textContent).toBe('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const atMin = renderFor(ZOOM_MIN);
    fireEvent.click(zoomOut());
    expect(atMin.onZoomOut).not.toHaveBeenCalled();
  });

  it('TC-32 clicking a disabled Zoom in at ZOOM_MAX does not call its callback', () => {
    const atMax = renderFor(ZOOM_MAX);
    fireEvent.click(zoomIn());
    expect(atMax.onZoomIn).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', () => {
    const props = renderFor(1);
    fireEvent.click(zoomIn());
    fireEvent.click(zoomOut());
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});
