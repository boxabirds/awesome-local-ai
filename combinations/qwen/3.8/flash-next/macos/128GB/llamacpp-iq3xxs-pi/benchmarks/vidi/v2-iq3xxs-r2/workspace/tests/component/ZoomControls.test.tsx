import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../../src/client/canvas/camera';
import { zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  const props = {
    zoomPercent: 100,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn,
    onZoomOut,
    onReset,
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return { props, onZoomIn, onZoomOut, onReset };
}

function label(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="zoom-label"]');
}

function button(name: 'zoom-in' | 'zoom-out' | 'reset-view'): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[data-testid="${name}"]`);
  if (!element) throw new Error(`missing button ${name}`);
  return element;
}

describe('zoom level shown (TC-19, TC-20, TC-21)', () => {
  it('TC-19: at ZOOM_MIN the label reads 10%, Zoom out is disabled and Zoom in is enabled', () => {
    renderControls({ zoomPercent: ZOOM_MIN_PERCENT, canZoomOut: false });
    expect(label()?.textContent).toBe(`${ZOOM_MIN_PERCENT}%`);
    expect(button('zoom-out').disabled).toBe(true);
    expect(button('zoom-in').disabled).toBe(false);
  });

  it('TC-20: at ZOOM_MAX the label reads 400% and Zoom in is disabled', () => {
    renderControls({ zoomPercent: ZOOM_MAX_PERCENT, canZoomIn: false });
    expect(label()?.textContent).toBe(`${ZOOM_MAX_PERCENT}%`);
    expect(button('zoom-in').disabled).toBe(true);
    expect(button('zoom-out').disabled).toBe(false);
  });

  it('TC-21: 1.5625 renders as the rounded label 156%', () => {
    const percent = zoomPercent({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR ** 2 });
    expect(percent).toBe(156);
    renderControls({ zoomPercent: percent });
    expect(label()?.textContent).toBe('156%');
  });

  it('announces changes politely and has accessible names', () => {
    renderControls();
    expect(label()?.getAttribute('aria-live')).toBe('polite');
    expect(button('zoom-out').getAttribute('aria-label')).toBe('Zoom out');
    expect(button('zoom-in').getAttribute('aria-label')).toBe('Zoom in');
    expect(button('reset-view').textContent).toBe('Reset view');
    // Keyboard focusable.
    expect(button('zoom-out').tabIndex).toBe(0);
    expect(button('zoom-in').tabIndex).toBe(0);
    expect(button('reset-view').tabIndex).toBe(0);
  });
});

describe('clicking the buttons (zoom.step)', () => {
  it('calls the callbacks for enabled buttons', () => {
    const { onZoomIn, onZoomOut, onReset } = renderControls();
    button('zoom-in').click();
    button('zoom-out').click();
    button('reset-view').click();
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32: clicking a disabled button does nothing', () => {
    const { onZoomIn, onZoomOut } = renderControls({
      zoomPercent: ZOOM_MAX_PERCENT,
      canZoomIn: false,
      canZoomOut: true,
    });
    button('zoom-in').click();
    expect(onZoomIn).not.toHaveBeenCalled();
    // The enabled button still works, which is how a user gets back from the limit.
    button('zoom-out').click();
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });
});
