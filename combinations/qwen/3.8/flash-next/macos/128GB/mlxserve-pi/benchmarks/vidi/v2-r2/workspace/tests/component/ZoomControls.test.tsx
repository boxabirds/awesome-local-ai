// zoom.controls: the − / percentage / + / Reset view control, its accessible
// names, its percentage label and its disabled limits. Cases TC-18 (keys),
// TC-19, TC-20, TC-21, TC-32.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// RTL does not auto-clean up without vitest globals; fake timers also fake the
// requestAnimationFrame the board batches camera updates into.
useBoardTestLifecycle();

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { flushFrames, pressKey, readCamera, renderBoard, useBoardTestLifecycle, zoomLabel } from './helpers';

function renderControls(cam: Camera, callbacks: Partial<Record<string, () => void>> = {}) {
  const onZoomIn = callbacks.onZoomIn ?? vi.fn();
  const onZoomOut = callbacks.onZoomOut ?? vi.fn();
  const onReset = callbacks.onReset ?? vi.fn();
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

describe('zoom controls', () => {
  describe('rendered from a camera', () => {
    // TC-19: at the minimum zoom the zoom-out button is disabled.
    it('TC-19 disables Zoom out at the minimum zoom', () => {
      renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
      expect(button('Zoom out').disabled).toBe(true);
      expect(button('Zoom in').disabled).toBe(false);
      expect(screen.getByTestId('zoom-label').textContent).toBe('10%');
    });

    // TC-20: at the maximum zoom the zoom-in button is disabled.
    it('TC-20 disables Zoom in at the maximum zoom', () => {
      renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });
      expect(button('Zoom in').disabled).toBe(true);
      expect(button('Zoom out').disabled).toBe(false);
      expect(screen.getByTestId('zoom-label').textContent).toBe('400%');
    });

    // TC-21: the label is the zoom rounded to the nearest whole percent.
    it('TC-21 shows the zoom as a whole-number percentage', () => {
      renderControls({ x: 0, y: 0, zoom: 1.5625 });
      expect(screen.getByTestId('zoom-label').textContent).toBe('156%');
      renderControls({ x: 0, y: 0, zoom: 1 });
      expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    });

    it('announces the zoom level politely and exposes Reset view', () => {
      renderControls({ x: 0, y: 0, zoom: 1 });
      const label = screen.getByTestId('zoom-label');
      expect(label.tagName).toBe('OUTPUT');
      expect(label.getAttribute('aria-live')).toBe('polite');
      expect(button('Reset view').disabled).toBe(false);
      expect(button('Reset view').textContent).toBe('Reset view');
    });

    // TC-32: a disabled button never calls its callback.
    it('TC-32 ignores clicks on a disabled zoom button', () => {
      const { onZoomOut, onZoomIn } = renderControls({ x: 0, y: 0, zoom: ZOOM_MIN });
      fireEvent.click(button('Zoom out'));
      expect(onZoomOut).not.toHaveBeenCalled();
      fireEvent.click(button('Zoom in'));
      expect(onZoomIn).toHaveBeenCalledTimes(1);
      fireEvent.click(button('Reset view'));
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('calls Reset view when clicked', () => {
      const { onReset } = renderControls({ x: 0, y: 0, zoom: 1 });
      fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('wired to the board', () => {
    it('steps the zoom by one factor per click around 125%', () => {
      renderBoard();
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      flushFrames();
      expect(zoomLabel()).toBe('125%');
      expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);

      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      flushFrames();
      expect(zoomLabel()).toBe('100%');
      expect(readCamera().zoom).toBe(1);
    });

    // TC-18 + TC-25 at component level: keyboard zoom steps, limit, recovery.
    it('TC-18 reaches the maximum with the keyboard and disables Zoom in', () => {
      renderBoard();
      for (let i = 0; i < 12; i++) {
        pressKey('=', { ctrlKey: true });
        flushFrames();
      }
      expect(zoomLabel()).toBe('400%');
      expect(readCamera().zoom).toBe(ZOOM_MAX);
      expect(button('Zoom in').disabled).toBe(true);
      expect(button('Zoom out').disabled).toBe(false);

      // a single step back re-enables zooming in
      pressKey('-', { ctrlKey: true });
      flushFrames();
      expect(button('Zoom in').disabled).toBe(false);
      expect(readCamera().zoom).toBeLessThan(ZOOM_MAX);

      // and the same in reverse: the label stops at the minimum
      for (let i = 0; i < 20; i++) {
        pressKey('-', { ctrlKey: true });
        flushFrames();
      }
      expect(zoomLabel()).toBe('10%');
      expect(readCamera().zoom).toBe(ZOOM_MIN);
      expect(button('Zoom out').disabled).toBe(true);
    });

    it('zooms with the buttons and resets with Reset view', () => {
      renderBoard();
      const start = readCamera();
      fireEvent.click(button('Zoom in'));
      flushFrames();
      expect(readCamera().zoom).toBe(ZOOM_STEP_FACTOR);
      // the board starts at Reset view for the measured board size
      expect(start.zoom).toBe(1);

      fireEvent.click(button('Reset view'));
      flushFrames();
      expect(readCamera()).toEqual(start);
      expect(zoomLabel()).toBe('100%');
    });
  });
});
