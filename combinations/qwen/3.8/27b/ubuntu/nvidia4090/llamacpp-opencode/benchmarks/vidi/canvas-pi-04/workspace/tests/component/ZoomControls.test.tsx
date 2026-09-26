import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from './helpers';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(() => {
  cleanup();
});

function renderControls(props?: Partial<Parameters<typeof ZoomControls>[0]>) {
  const callbacks = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  const utils = render(
    <ZoomControls
      zoomPercent={100}
      canZoomIn
      canZoomOut
      {...callbacks}
      {...props}
    />,
  );
  return { callbacks, ...utils };
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('zoom.controls (TC-19 to TC-21, TC-32)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out is disabled, Zoom in is enabled, label shows 10%', () => {
    renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN }),
      canZoomIn: true,
      canZoomOut: false,
    });

    expect(button('Zoom out').disabled).toBe(true);
    expect(button('Zoom in').disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in is disabled and the label shows 400%', () => {
    renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX }),
      canZoomIn: false,
      canZoomOut: true,
    });

    expect(button('Zoom in').disabled).toBe(true);
    expect(button('Zoom out').disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
  });

  it('TC-21 the label shows the zoom rounded to a whole percent', () => {
    renderControls({ zoomPercent: zoomPercent({ x: 0, y: 0, zoom: 1.5625 }) });

    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('TC-32 clicking a disabled zoom button does nothing', async () => {
    const { callbacks } = renderControls({
      zoomPercent: zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX }),
      canZoomIn: false,
      canZoomOut: true,
    });
    const user = userEvent.setup();

    // Disabled: a user click is ignored entirely.
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(callbacks.onZoomIn).not.toHaveBeenCalled();
    expect(callbacks.onZoomOut).not.toHaveBeenCalled();
    expect(callbacks.onReset).not.toHaveBeenCalled();
  });

  it('an enabled zoom button calls its callback', async () => {
    const { callbacks } = renderControls();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(callbacks.onZoomIn).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(callbacks.onZoomOut).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
  });
});
