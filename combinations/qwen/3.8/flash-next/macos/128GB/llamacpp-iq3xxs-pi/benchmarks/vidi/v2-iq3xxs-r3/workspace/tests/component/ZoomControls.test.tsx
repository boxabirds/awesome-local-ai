import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import type { Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

interface Handlers {
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

function renderAtZoom(zoom: number, handlers: Handlers): void {
  const camera: Camera = { x: 0, y: 0, zoom };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      {...handlers}
    />,
  );
}

function label(): string {
  return screen.getByTestId('zoom-percent').textContent ?? '';
}

function isDisabled(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled');
}

afterEach(cleanup);

const allEnabled = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };

describe('ZoomControls', () => {
  // TC-19
  it('TC-19 disables zoom-out at ZOOM_MIN and shows 10%', () => {
    renderAtZoom(ZOOM_MIN, allEnabled);
    expect(isDisabled('Zoom out')).toBe(true);
    expect(isDisabled('Zoom in')).toBe(false);
    expect(label()).toBe('10%');
  });

  // TC-20
  it('TC-20 disables zoom-in at ZOOM_MAX and shows 400%', () => {
    renderAtZoom(ZOOM_MAX, allEnabled);
    expect(isDisabled('Zoom in')).toBe(true);
    expect(isDisabled('Zoom out')).toBe(false);
    expect(label()).toBe('400%');
  });

  // TC-21
  it('TC-21 rounds the label to a whole percent (1.5625 -> 156%)', () => {
    renderAtZoom(1.5625, allEnabled);
    expect(label()).toBe('156%');
    expect(isDisabled('Zoom in')).toBe(false);
    expect(isDisabled('Zoom out')).toBe(false);
  });

  it('announces the label politely', () => {
    renderAtZoom(1, allEnabled);
    const output = screen.getByTestId('zoom-percent');
    expect(output.tagName).toBe('OUTPUT');
    expect(output.getAttribute('aria-live')).toBe('polite');
  });

  it('calls the callbacks when the buttons are enabled', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    renderAtZoom(1, { onZoomIn, onZoomOut, onReset });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32 ignores a click on a disabled zoom button', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderAtZoom(ZOOM_MAX, { onZoomIn, onZoomOut, onReset: vi.fn() });

    expect(screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).not.toHaveBeenCalled();

    // Zooming back the other way is still possible.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });
});
