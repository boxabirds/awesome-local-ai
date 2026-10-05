import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Size,
} from '../../src/client/canvas/camera';
import { ZoomControls, type ZoomControlsProps } from '../../src/client/canvas/ZoomControls';

const PERCENT = 100;
const VIEWPORT: Size = { width: 1280, height: 800 };

const cameraAt = (zoom: number): Camera => ({
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom,
});

function renderControls(zoom: number, overrides: Partial<ZoomControlsProps> = {}): void {
  const camera = cameraAt(zoom);
  render(
    <ZoomControls
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onReset={vi.fn()}
      zoomPercent={zoomPercent(camera)}
      {...overrides}
    />,
  );
}

const label = (): HTMLElement => screen.getByTestId('zoom-label');
const zoomOutButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
const zoomInButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
const resetButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement;

describe('zoom controls', () => {
  // TC-19
  it('TC-19 disables Zoom out at the minimum zoom and shows 10%', () => {
    renderControls(ZOOM_MIN);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * PERCENT)}%`);
    expect(zoomOutButton().disabled).toBe(true);
    expect(zoomInButton().disabled).toBe(false);
    expect(label().getAttribute('aria-live')).toBe('polite');
  });

  // TC-20
  it('TC-20 disables Zoom in at the maximum zoom and shows 400%', () => {
    renderControls(ZOOM_MAX);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * PERCENT)}%`);
    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
  });

  // TC-21
  it('TC-21 rounds the percentage to a whole number (1.5625 -> 156%)', () => {
    const zoom = Math.pow(ZOOM_STEP_FACTOR, 2); // 1.5625
    renderControls(zoom);
    expect(label().textContent).toBe(`${Math.round(zoom * PERCENT)}%`);
    expect(label().textContent).toBe('156%');
  });

  it('rounds 1.953125 down to 195%', () => {
    const zoom = Math.pow(ZOOM_STEP_FACTOR, 3); // 1.953125
    renderControls(zoom);
    expect(label().textContent).toBe('195%');
  });

  // TC-32 (negative)
  it('TC-32 does not call the callback of a disabled button', () => {
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    renderControls(ZOOM_MIN, { onZoomOut, onZoomIn });
    fireEvent.click(zoomOutButton());
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomIn).not.toHaveBeenCalled();
    fireEvent.click(zoomInButton());
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('TC-32 does not call the zoom callbacks at the maximum zoom', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderControls(ZOOM_MAX, { onZoomIn, onZoomOut });
    fireEvent.click(zoomInButton());
    expect(onZoomIn).not.toHaveBeenCalled();
    fireEvent.click(zoomOutButton());
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('calls the right callback for each control', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    renderControls(ZOOM_STEP_FACTOR, { onZoomIn, onZoomOut, onReset });
    fireEvent.click(zoomInButton());
    fireEvent.click(zoomOutButton());
    fireEvent.click(resetButton());
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders the − / percentage / + / Reset view control with accessible names', () => {
    renderControls(1);
    expect(zoomOutButton().textContent).toBe('\u2212');
    expect(zoomInButton().textContent).toBe('+');
    expect(resetButton().textContent).toBe('Reset view');
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
    // Every control is reachable by keyboard (native buttons, not disabled here).
    for (const button of [zoomOutButton(), zoomInButton(), resetButton()]) {
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      expect(button.type).toBe('button');
    }
    expect(label().tagName).toBe('OUTPUT');
  });

  it('reports the limit flags the buttons are derived from', () => {
    // The buttons are stateless, so the camera decides: at ZOOM_MIN a zoom-out
    // step is a no-op and the button is disabled.
    expect(canZoomOut(cameraAt(ZOOM_MIN))).toBe(false);
    expect(canZoomIn(cameraAt(ZOOM_MAX))).toBe(false);
    expect(zoomPercent(cameraAt(ZOOM_MAX))).toBe(Math.round(ZOOM_MAX * PERCENT));
    // One step inside each limit is enabled again.
    expect(canZoomIn(cameraAt(ZOOM_MAX / ZOOM_STEP_FACTOR))).toBe(true);
    expect(canZoomOut(cameraAt(ZOOM_MIN * ZOOM_STEP_FACTOR))).toBe(true);
  });
});

