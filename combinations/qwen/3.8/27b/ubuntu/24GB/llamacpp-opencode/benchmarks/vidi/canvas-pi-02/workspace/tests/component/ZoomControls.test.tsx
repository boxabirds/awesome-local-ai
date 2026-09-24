import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Camera } from '../../src/client/canvas/camera';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderControls(
  cam: Camera,
  handlers: Partial<Record<'onZoomIn' | 'onZoomOut' | 'onReset', (e?: unknown) => void>> = {},
) {
  const onZoomIn = handlers.onZoomIn ?? vi.fn();
  const onZoomOut = handlers.onZoomOut ?? vi.fn();
  const onReset = handlers.onReset ?? vi.fn();
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

describe('zoom.controls', () => {
  it('TC-19 at ZOOM_MIN: zoom out disabled, zoom in enabled, label 10%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('TC-20 at ZOOM_MAX: zoom in disabled, zoom out enabled, label 400%', () => {
    renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('400%')).toBeTruthy();
  });

  it('TC-21 the label is the whole-number percentage (156.25% -> 156%)', () => {
    renderControls({ x: 0, y: 0, zoom: 1.5625 });
    expect(screen.getByText('156%')).toBeTruthy();
  });

  it('the zoom label is an aria-live output element', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const label = screen.getByText('100%');
    expect(label.tagName).toBe('OUTPUT');
    expect(label.getAttribute('aria-live')).toBe('polite');
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const onZoomOut = vi.fn();
    renderControls({ x: 0, y: 0, zoom: ZOOM_MIN }, { onZoomOut });
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('clicking an enabled button calls its callback', async () => {
    const onZoomIn = vi.fn();
    renderControls({ x: 0, y: 0, zoom: 1 }, { onZoomIn });
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('Reset view calls onReset', async () => {
    const onReset = vi.fn();
    renderControls({ x: 0, y: 0, zoom: 1 }, { onReset });
    await userEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('wheel events over the controls stop propagation (Ctrl-wheel there never reaches the board)', () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const controls = document.querySelector('.vidi6-zoom-controls') as HTMLElement;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    controls.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
