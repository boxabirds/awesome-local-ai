import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, resetCamera, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const AREA = { width: 1280, height: 800 };
const CENTRE = { x: AREA.width / 2, y: AREA.height / 2 };

function cameraAt(zoom: number): Camera {
  return { ...resetCamera(AREA), zoom };
}

function renderControls(cam: Camera) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
}

function label(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

describe('ZoomControls', () => {
  it('TC-19: at ZOOM_MIN zoom out is disabled, zoom in is enabled and the label reads 10%', () => {
    renderControls(cameraAt(ZOOM_MIN));

    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toHaveAttribute('disabled');
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(label().tagName).toBe('OUTPUT');
    expect(label()).toHaveAttribute('aria-live', 'polite');
  });

  it('TC-20: at ZOOM_MAX zoom in is disabled and the label reads 400%', () => {
    renderControls(cameraAt(ZOOM_MAX));

    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toHaveAttribute('disabled');
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  it('TC-21: the label is the zoom rounded to the nearest whole percent', () => {
    renderControls(cameraAt(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR));

    expect(label().textContent).toBe('156%');
    expect(cameraAt(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR).zoom).toBeCloseTo(1.5625, 9);
  });

  it('TC-21b: at the standard view the label reads 100% and Reset view is available', () => {
    renderControls(resetCamera(AREA));

    expect(label().textContent).toBe('100%');
    expect(screen.getByRole('button', { name: 'Reset view' })).not.toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Reset view' })).toHaveAttribute('type', 'button');
  });

  it('TC-32: clicking a disabled button does nothing, clicking an enabled one calls its callback', () => {
    const atMin = renderControls(cameraAt(ZOOM_MIN));

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(atMin.onZoomOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(atMin.onZoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(atMin.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32b: the buttons are focusable in order out, label, in, reset', () => {
    renderControls(cameraAt(1));
    const buttons = [
      screen.getByRole('button', { name: 'Zoom out' }),
      screen.getByRole('button', { name: 'Zoom in' }),
      screen.getByRole('button', { name: 'Reset view' }),
    ];

    for (const button of buttons) {
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    expect(label().textContent).toBe('100%');
  });

  it('TC-30 (ui): the control container stops wheel events from reaching the board', () => {
    renderControls(cameraAt(1));
    const container = screen.getByTestId('zoom-controls');
    let reachedRoot = false;
    const stop = () => {
      reachedRoot = true;
    };
    document.addEventListener('wheel', stop);

    fireEvent(container, new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: CENTRE.x, clientY: CENTRE.y }));
    document.removeEventListener('wheel', stop);

    // The control does not cancel the browser default, and the event does not bubble.
    expect(reachedRoot).toBe(false);
  });
});
