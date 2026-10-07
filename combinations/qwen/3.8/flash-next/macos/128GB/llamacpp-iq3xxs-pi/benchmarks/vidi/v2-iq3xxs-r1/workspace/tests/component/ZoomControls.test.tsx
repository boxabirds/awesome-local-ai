import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

const MIN_PCT = Math.round(ZOOM_MIN * 100); // 10
const MAX_PCT = Math.round(ZOOM_MAX * 100); // 400

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function renderControls(overrides: Partial<React.ComponentProps<typeof ZoomControls>> = {}) {
  const handlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ZoomControls zoomPercent={100} canZoomIn canZoomOut {...handlers} {...overrides} />);
  return handlers;
}

describe('ZoomControls (zoom.controls)', () => {
  // TC-19: at ZOOM_MIN the Zoom out button is disabled, Zoom in enabled, "10%".
  it('TC-19 disables Zoom out at ZOOM_MIN', () => {
    renderControls({ zoomPercent: MIN_PCT, canZoomOut: false, canZoomIn: true });
    expect(button('Zoom out').disabled).toBe(true);
    expect(button('Zoom in').disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe(`${MIN_PCT}%`);
  });

  // TC-20: at ZOOM_MAX the Zoom in button is disabled and the label shows "400%".
  it('TC-20 disables Zoom in at ZOOM_MAX', () => {
    renderControls({ zoomPercent: MAX_PCT, canZoomIn: false, canZoomOut: true });
    expect(button('Zoom in').disabled).toBe(true);
    expect(button('Zoom out').disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe(`${MAX_PCT}%`);
  });

  // TC-21: label is the rounded whole-percent ("156%" for zoom 1.5625).
  it('TC-21 shows the rounded whole-percent label', () => {
    renderControls({ zoomPercent: Math.round(1.5625 * 100) });
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  // TC-32 (negative): clicking a disabled button never calls its callback.
  it('TC-32 clicking a disabled button does not call its callback', () => {
    const handlers = renderControls({ zoomPercent: MIN_PCT, canZoomOut: false });
    fireEvent.click(button('Zoom out'));
    expect(handlers.onZoomOut).not.toHaveBeenCalled();
  });
});
