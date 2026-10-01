import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: 100,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

describe('zoom controls (zoom.controls)', () => {
  it('renders accessible names and the percentage', () => {
    renderControls();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('100%');
  });

  // TC-19: at ZOOM_MIN the − button is disabled and the label reads 10%.
  it('TC-19 disables zoom out at the minimum zoom', () => {
    const props = renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN }),
      canZoomOut: false,
      canZoomIn: true,
    });
    expect(props.zoomPercent).toBe(Math.round(ZOOM_MIN * 100));
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  // TC-20: at ZOOM_MAX the + button is disabled and the label reads 400%.
  it('TC-20 disables zoom in at the maximum zoom', () => {
    renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX }),
      canZoomIn: false,
      canZoomOut: true,
    });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  // TC-21: zoom 1.5625 displays the rounded percentage 156%.
  it('TC-21 shows the zoom rounded to the nearest whole percent', () => {
    const mid = ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR; // 1.5625
    renderControls({ zoomPercent: zoomPercent({ x: 0, y: 0, zoom: mid }) });
    expect(mid).toBe(1.5625);
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  // TC-32 (negative): clicking a disabled button does nothing.
  it('TC-32 ignores clicks on disabled buttons', () => {
    const props = renderControls({ canZoomOut: false });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).not.toHaveBeenCalled();
    // The enabled button still works.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('announces the zoom label politely', () => {
    renderControls();
    expect(screen.getByTestId('zoom-label')).toHaveAttribute('aria-live', 'polite');
  });
});
