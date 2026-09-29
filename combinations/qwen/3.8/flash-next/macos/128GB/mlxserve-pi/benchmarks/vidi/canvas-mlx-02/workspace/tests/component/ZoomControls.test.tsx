import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls.tsx';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_PERCENT_SCALE,
} from '../../src/shared/config.ts';

const noop = () => {};

function setup(props: Partial<React.ComponentProps<typeof ZoomControls>> = {}) {
  return render(
    <ZoomControls
      zoomPercent={100}
      canZoomIn
      canZoomOut
      onZoomIn={noop}
      onZoomOut={noop}
      onReset={noop}
      {...props}
    />,
  );
}

describe('zoom controls', () => {
  // TC-19: at ZOOM_MIN, Zoom out is disabled and the label reads 10%.
  it('TC-19 disables Zoom out at the minimum and shows 10%', () => {
    setup({ zoomPercent: Math.round(ZOOM_MIN * ZOOM_PERCENT_SCALE), canZoomOut: false });
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
    expect(screen.getByLabelText('Zoom in')).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  // TC-20: at ZOOM_MAX, Zoom in is disabled and the label reads 400%.
  it('TC-20 disables Zoom in at the maximum and shows 400%', () => {
    setup({ zoomPercent: Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE), canZoomIn: false });
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
    expect(screen.getByLabelText('Zoom out')).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  // TC-21: a fractional zoom shows the rounded whole percent.
  it('TC-21 shows the rounded percent 156%', () => {
    setup({ zoomPercent: Math.round(1.5625 * ZOOM_PERCENT_SCALE) });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  // The zoom label is announced when it changes.
  it('marks the zoom label as a live region', () => {
    setup();
    expect(screen.getByTestId('zoom-label')).toHaveAttribute('aria-live', 'polite');
  });

  // TC-32 (negative): clicking a disabled button does not call its callback.
  it('TC-32 does not call a disabled button handler', () => {
    const onZoomOut = vi.fn();
    setup({ canZoomOut: false, onZoomOut });
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('calls the enabled handlers', () => {
    const onZoomIn = vi.fn();
    const onReset = vi.fn();
    setup({ onZoomIn, onReset });
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
