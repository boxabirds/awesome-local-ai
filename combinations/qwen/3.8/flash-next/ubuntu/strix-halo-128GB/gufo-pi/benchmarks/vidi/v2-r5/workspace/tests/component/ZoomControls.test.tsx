import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent } from '../../src/client/canvas/camera';
import { PERCENT, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

const percentAt = (zoom: number): number => zoomPercent({ x: 0, y: 0, zoom });

const renderControls = (overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) => {
  const props = {
    zoomPercent: PERCENT,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
};

describe('zoom.controls: labels and disabled states', () => {
  it('TC-19 at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    renderControls({ zoomPercent: percentAt(ZOOM_MIN), canZoomOut: false });

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    renderControls({ zoomPercent: percentAt(ZOOM_MAX), canZoomIn: false });

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('400%');
  });

  it('TC-21 rounds the zoom to a whole percent (1.5625 -> 156%)', () => {
    renderControls({ zoomPercent: percentAt(1.5625) });

    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('156%');
  });

  it('announces the zoom level politely', () => {
    renderControls();

    expect(screen.getByTestId('zoom-percent')).toHaveAttribute('aria-live', 'polite');
  });

  it('has an accessible Reset view button', () => {
    renderControls();

    expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled();
  });
});

describe('zoom.controls: callbacks', () => {
  it('calls onZoomIn, onZoomOut and onReset when enabled', () => {
    const props = renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 does not call a callback whose button is disabled', () => {
    const props = renderControls({ canZoomIn: false, canZoomOut: false });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  it('stops wheel propagation so the board never zooms from the control', () => {
    renderControls();
    const controls = screen.getByTestId('zoom-controls');
    const event = new WheelEvent('wheel', { deltaY: -240, ctrlKey: true, bubbles: true });
    controls.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
