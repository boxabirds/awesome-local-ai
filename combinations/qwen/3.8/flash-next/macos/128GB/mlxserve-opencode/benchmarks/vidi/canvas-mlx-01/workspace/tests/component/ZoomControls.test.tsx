import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls.js';
import { canZoomIn, canZoomOut, resetCamera, zoomPercent } from '../../src/client/canvas/camera.js';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config.js';
import type { Camera } from '../../src/client/canvas/camera.js';

const VIEWPORT = { width: 1280, height: 800 };

const cameraAt = (zoom: number): Camera => ({ ...resetCamera(VIEWPORT), zoom });

function renderControls(zoom: number, calls: Record<string, () => void> = {}): void {
  const cam = cameraAt(zoom);
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      onZoomIn={calls.onZoomIn ?? (() => undefined)}
      onZoomOut={calls.onZoomOut ?? (() => undefined)}
      onReset={calls.onReset ?? (() => undefined)}
    />,
  );
}

const buttonByLabel = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

describe('zoom label (TC-19, TC-20, TC-21)', () => {
  it('shows 10% and disables Zoom out at the minimum zoom', () => {
    renderControls(ZOOM_MIN);
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
    expect(buttonByLabel('Zoom out').disabled).toBe(true);
    expect(buttonByLabel('Zoom in').disabled).toBe(false);
  });

  it('shows 400% and disables Zoom in at the maximum zoom', () => {
    renderControls(ZOOM_MAX);
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
    expect(buttonByLabel('Zoom in').disabled).toBe(true);
    expect(buttonByLabel('Zoom out').disabled).toBe(false);
  });

  it('rounds the percentage to a whole number', () => {
    renderControls(1.5625);
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('shows 100% at the standard view', () => {
    renderControls(1);
    expect(screen.getByTestId('zoom-label').textContent).toBe('100%');
  });

  it('announces changes politely', () => {
    renderControls(1);
    const label = screen.getByTestId('zoom-label');
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.tagName).toBe('OUTPUT');
  });
});

describe('buttons', () => {
  it('calls the callbacks when clicked', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    renderControls(1, { onZoomIn, onZoomOut, onReset });

    fireEvent.click(buttonByLabel('Zoom in'));
    fireEvent.click(buttonByLabel('Zoom out'));
    fireEvent.click(buttonByLabel('Reset view'));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('is reachable by keyboard with a visible focus target', () => {
    renderControls(1);
    for (const name of ['Zoom out', 'Zoom in', 'Reset view']) {
      const el = buttonByLabel(name);
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('type')).toBe('button');
      expect(el.tabIndex).toBe(0);
    }
  });
});

describe('negative: disabled buttons (TC-32)', () => {
  it('does not call onZoomIn when Zoom in is disabled at the maximum zoom', () => {
    const onZoomIn = vi.fn();
    renderControls(ZOOM_MAX, { onZoomIn });
    const zoomIn = buttonByLabel('Zoom in');
    expect(zoomIn.disabled).toBe(true);
    fireEvent.click(zoomIn);
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('does not call onZoomOut when Zoom out is disabled at the minimum zoom', () => {
    const onZoomOut = vi.fn();
    renderControls(ZOOM_MIN, { onZoomOut });
    const zoomOut = buttonByLabel('Zoom out');
    expect(zoomOut.disabled).toBe(true);
    fireEvent.click(zoomOut);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('has no aria-disabled button in the middle of the range', () => {
    renderControls(1);
    expect(buttonByLabel('Zoom in').hasAttribute('disabled')).toBe(false);
    expect(buttonByLabel('Zoom out').hasAttribute('disabled')).toBe(false);
  });
});
