import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

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

describe('zoom.controls', () => {
  it('TC-19 at ZOOM_MIN zoom-out is disabled and label reads 10%', () => {
    setup({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN }),
      canZoomOut: false,
      canZoomIn: true,
    });
    const out = screen.getByRole('button', { name: 'Zoom out' });
    const in_ = screen.getByRole('button', { name: 'Zoom in' });
    expect((out as HTMLButtonElement).disabled).toBe(true);
    expect((in_ as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX zoom-in is disabled and label reads 400%', () => {
    setup({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX }),
      canZoomIn: false,
      canZoomOut: true,
    });
    const in_ = screen.getByRole('button', { name: 'Zoom in' });
    expect((in_ as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
  });

  it('TC-21 zoom 1.5625 rounds to a 156% label', () => {
    setup({ zoomPercent: zoomPercent({ x: 0, y: 0, zoom: 1.5625 }) });
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const props = setup({ canZoomOut: false });
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).not.toHaveBeenCalled();
    // The enabled button still works.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.onZoomIn).toHaveBeenCalled();
  });

  it('Reset view calls onReset', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onReset).toHaveBeenCalled();
  });
});
