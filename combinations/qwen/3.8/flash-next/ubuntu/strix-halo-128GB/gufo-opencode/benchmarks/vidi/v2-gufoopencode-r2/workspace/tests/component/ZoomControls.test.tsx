import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { type Camera, canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

function propsFor(cam: Camera, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  return {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

describe('zoom.controls', () => {
  it('TC-19: at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: ZOOM_MIN })} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toBeDisabled();
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: ZOOM_MAX })} />);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toBeDisabled();
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
  });

  it('TC-21: zoom 1.5625 renders the rounded label 156%', () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: 1.5625 })} />);
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('TC-32: clicking a disabled button does not call its callback', () => {
    const props = propsFor({ x: 0, y: 0, zoom: ZOOM_MIN });
    render(<ZoomControls {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('the zoom label is a polite live region', () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: 1 })} />);
    expect(screen.getByTestId('zoom-label').getAttribute('aria-live')).toBe('polite');
  });
});
