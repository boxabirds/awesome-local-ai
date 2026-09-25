import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '@/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '@/shared/config';
import { zoomPercent } from '@/client/canvas/camera';

function renderControls(overrides: Partial<React.ComponentProps<typeof ZoomControls>> = {}) {
  const props: React.ComponentProps<typeof ZoomControls> = {
    zoomPercent: 100,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  return render(<ZoomControls {...props} />);
}

describe('ZoomControls', () => {
  it('TC-19: at ZOOM_MIN, Zoom out disabled, Zoom in enabled, label 10%', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MIN };
    renderControls({
      zoomPercent: zoomPercent(cam),
      canZoomIn: true,
      canZoomOut: false,
    });

    const zoomOut = screen.getByLabelText('Zoom out');
    const zoomIn = screen.getByLabelText('Zoom in');
    const label = screen.getByTestId('zoom-label');

    expect(zoomOut).toBeDisabled();
    expect(zoomIn).toBeEnabled();
    expect(label.textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX, Zoom in disabled, label 400%', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MAX };
    renderControls({
      zoomPercent: zoomPercent(cam),
      canZoomIn: false,
      canZoomOut: true,
    });

    const zoomIn = screen.getByLabelText('Zoom in');
    const label = screen.getByTestId('zoom-label');

    expect(zoomIn).toBeDisabled();
    expect(label.textContent).toBe('400%');
  });

  it('TC-21: zoom 1.5625 shows label 156%', () => {
    const cam = { x: 0, y: 0, zoom: 1.5625 };
    renderControls({
      zoomPercent: zoomPercent(cam),
    });

    const label = screen.getByTestId('zoom-label');
    expect(label.textContent).toBe('156%');
  });

  it('TC-32: clicking a disabled button does not call its callback', () => {
    const onZoomOut = vi.fn();
    renderControls({
      zoomPercent: 10,
      canZoomIn: true,
      canZoomOut: false,
      onZoomOut,
    });

    const zoomOut = screen.getByLabelText('Zoom out');
    fireEvent.click(zoomOut);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('calls onZoomIn when button is enabled and clicked', () => {
    const onZoomIn = vi.fn();
    renderControls({
      zoomPercent: 100,
      canZoomIn: true,
      canZoomOut: true,
      onZoomIn,
    });

    const zoomIn = screen.getByLabelText('Zoom in');
    fireEvent.click(zoomIn);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('calls onReset when Reset view is clicked', () => {
    const onReset = vi.fn();
    renderControls({
      zoomPercent: 200,
      canZoomIn: true,
      canZoomOut: true,
      onReset,
    });

    const reset = screen.getByLabelText('Reset view');
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
