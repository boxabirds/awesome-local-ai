import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls.tsx';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config.ts';
import { zoomPercent, canZoomIn, canZoomOut, type Camera } from '../../src/client/canvas/camera.ts';

afterEach(cleanup);

function renderAt(cam: Camera, cbs: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...cbs,
  };
  render(<ZoomControls {...props} />);
  return props;
}

const at = (zoom: number): Camera => ({ x: 0, y: 0, zoom });

describe('zoom.controls', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    renderAt(at(ZOOM_MIN));
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    renderAt(at(ZOOM_MAX));
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  it('TC-21 zoom 1.5625: label rounds to 156%', () => {
    renderAt(at(1.5625));
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const onZoomOut = vi.fn();
    renderAt(at(ZOOM_MIN), { onZoomOut });
    const btn = screen.getByRole('button', { name: 'Zoom out' });
    fireEvent.click(btn);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('Reset view is keyboard focusable with an accessible name', () => {
    renderAt(at(1));
    const reset = screen.getByRole('button', { name: 'Reset view' });
    expect(reset).toBeEnabled();
  });
});
