import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

interface Calls {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

function renderControls(camera: Camera, overrides: Partial<Calls> = {}) {
  const calls: Calls = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={calls.onZoomIn}
      onZoomOut={calls.onZoomOut}
      onReset={calls.onReset}
    />,
  );
  return calls;
}

function zoomOutButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
}

function zoomInButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
}

function resetButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement;
}

const atZoom = (zoom: number): Camera => ({ x: 0, y: 0, zoom });

describe('ZoomControls', () => {
  it('shows the zoom as a whole-number percentage', () => {
    renderControls(atZoom(1));
    expect(screen.getByTestId('zoom-label').textContent).toBe('100%');
  });

  it('TC-19: disables zoom out at ZOOM_MIN and shows 10%', () => {
    renderControls(atZoom(ZOOM_MIN));
    expect(zoomOutButton().disabled).toBe(true);
    expect(zoomInButton().disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
  });

  it('TC-20: disables zoom in at ZOOM_MAX and shows 400%', () => {
    renderControls(atZoom(ZOOM_MAX));
    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
    expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
  });

  it('TC-21: rounds the percentage to the nearest whole percent', () => {
    renderControls(atZoom(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR));
    expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
  });

  it('announces the zoom level politely', () => {
    renderControls(atZoom(1));
    const label = screen.getByTestId('zoom-label');
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.tagName.toLowerCase()).toBe('output');
  });

  it('calls the callbacks from the enabled buttons', () => {
    const calls = renderControls(atZoom(1));
    fireEvent.click(zoomInButton());
    fireEvent.click(zoomOutButton());
    fireEvent.click(resetButton());
    expect(calls.onZoomIn).toHaveBeenCalledTimes(1);
    expect(calls.onZoomOut).toHaveBeenCalledTimes(1);
    expect(calls.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32: a click on a disabled button does nothing', () => {
    const calls = renderControls(atZoom(ZOOM_MAX));
    fireEvent.click(zoomInButton());
    expect(calls.onZoomIn).not.toHaveBeenCalled();
    fireEvent.click(zoomOutButton());
    expect(calls.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('TC-32: at ZOOM_MIN a click on the disabled zoom-out button does nothing', () => {
    const calls = renderControls(atZoom(ZOOM_MIN));
    fireEvent.click(zoomOutButton());
    expect(calls.onZoomOut).not.toHaveBeenCalled();
    fireEvent.click(zoomInButton());
    expect(calls.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('keeps every control keyboard focusable', () => {
    renderControls(atZoom(1));
    for (const button of [zoomOutButton(), zoomInButton(), resetButton()]) {
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });

  it('labels the zoom-out button with a minus sign and zoom-in with a plus sign', () => {
    renderControls(atZoom(1));
    expect(zoomOutButton().textContent).toBe('−');
    expect(zoomInButton().textContent).toBe('+');
  });
});
