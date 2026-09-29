import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

function renderControls(zoom: number) {
  const camera = { x: 0, y: 0, zoom };
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  return {
    zoomIn: screen.getByRole('button', { name: 'Zoom in' }),
    zoomOut: screen.getByRole('button', { name: 'Zoom out' }),
    reset: screen.getByRole('button', { name: 'Reset view' }),
    label: screen.getByTestId('zoom-label'),
    onZoomIn,
    onZoomOut,
    onReset,
  };
}

describe('zoom controls (TC-19, TC-20, TC-21, TC-32)', () => {
  it('TC-19 at ZOOM_MIN the zoom-out button is disabled and the label reads 10%', () => {
    const controls = renderControls(ZOOM_MIN);
    expect(controls.zoomOut.hasAttribute('disabled')).toBe(true);
    expect(controls.zoomIn.hasAttribute('disabled')).toBe(false);
    expect(controls.label.textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
  });

  it('TC-20 at ZOOM_MAX the zoom-in button is disabled and the label reads 400%', () => {
    const controls = renderControls(ZOOM_MAX);
    expect(controls.zoomIn.hasAttribute('disabled')).toBe(true);
    expect(controls.zoomOut.hasAttribute('disabled')).toBe(false);
    expect(controls.label.textContent).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  it('TC-21 shows the zoom rounded to a whole percentage', () => {
    const controls = renderControls(1.5625);
    expect(controls.label.textContent).toBe('156%');
  });

  it('shows 100% at the default zoom', () => {
    const controls = renderControls(1);
    expect(controls.label.textContent).toBe('100%');
    expect(controls.zoomIn.hasAttribute('disabled')).toBe(false);
    expect(controls.zoomOut.hasAttribute('disabled')).toBe(false);
  });

  it('TC-32 a disabled button does not call its callback, an enabled one does', () => {
    const atMin = renderControls(ZOOM_MIN);
    atMin.zoomOut.click();
    expect(atMin.onZoomOut).not.toHaveBeenCalled();
    atMin.zoomIn.click();
    expect(atMin.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('Reset view calls onReset', () => {
    const controls = renderControls(3);
    controls.reset.click();
    expect(controls.onReset).toHaveBeenCalledTimes(1);
  });

  it('the zoom label is announced when it changes', () => {
    const { rerender } = render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const label = screen.getByTestId('zoom-label');
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.textContent).toBe('100%');
    rerender(
      <ZoomControls
        zoomPercent={125}
        canZoomIn
        canZoomOut
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    expect(label.textContent).toBe('125%');
  });

  it('is keyboard focusable', () => {
    const controls = renderControls(1);
    controls.zoomIn.focus();
    expect(document.activeElement).toBe(controls.zoomIn);
    controls.reset.focus();
    expect(document.activeElement).toBe(controls.reset);
  });
});
