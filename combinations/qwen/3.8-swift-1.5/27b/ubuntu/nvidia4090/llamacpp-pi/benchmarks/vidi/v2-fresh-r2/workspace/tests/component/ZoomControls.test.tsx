import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

type ZoomControlsProps = ComponentProps<typeof ZoomControls>;

function renderControls(overrides: Partial<ZoomControlsProps> = {}) {
  const props: ZoomControlsProps = {
    zoomPercent: zoomPercent({ x: 0, y: 0, zoom: 1 }),
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

describe('zoom.controls', () => {
  it('TC-19 at the minimum zoom, Zoom out is disabled and the label reads 10%', () => {
    renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN }),
      canZoomOut: false,
    });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  it('TC-20 at the maximum zoom, Zoom in is disabled and the label reads 400%', () => {
    renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX }),
      canZoomIn: false,
    });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  it('TC-21 the label is the zoom rounded to a whole percent', () => {
    renderControls({ zoomPercent: zoomPercent({ x: 0, y: 0, zoom: 1.5625 }) });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('the zoom label is announced politely', () => {
    renderControls();
    expect(screen.getByTestId('zoom-label')).toHaveAttribute('aria-live', 'polite');
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const props = renderControls({ canZoomOut: false });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('enabled buttons call their callbacks', () => {
    const props = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});
