import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { zoomPercent } from '@client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX } from '@shared/config';

function setup(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
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

describe('ZoomControls', () => {
  // TC-19
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    const percent = zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN });
    setup({ zoomPercent: percent, canZoomIn: true, canZoomOut: false });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
  });

  // TC-20
  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    const percent = zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX });
    setup({ zoomPercent: percent, canZoomIn: false, canZoomOut: true });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
  });

  // TC-21
  it('TC-21 rounds the label: zoom 1.5625 shows 156%', () => {
    const percent = zoomPercent({ x: 0, y: 0, zoom: 1.5625 });
    setup({ zoomPercent: percent });
    expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
  });

  it('exposes the zoom label as a polite live region', () => {
    setup();
    expect(screen.getByTestId('zoom-label')).toHaveAttribute('aria-live', 'polite');
  });

  it('calls the enabled callbacks', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const props = setup({ canZoomIn: false });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.onZoomIn).not.toHaveBeenCalled();
  });
});
