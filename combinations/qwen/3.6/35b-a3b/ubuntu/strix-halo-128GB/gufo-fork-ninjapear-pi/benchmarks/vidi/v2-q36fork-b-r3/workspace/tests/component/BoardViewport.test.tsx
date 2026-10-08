import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { BoardViewport } from '@client/canvas/BoardViewport';
import type { BoardViewportProps } from '@client/canvas/BoardViewport';

type Spy = ReturnType<typeof vi.fn>;

function renderComponent(overrides?: Partial<{
  onPanMove: Spy;
  onWheel: Spy;
  onEndPan: Spy;
  onKeyDownZoom: Mock<(action: 'zoomIn' | 'zoomOut' | 'reset') => void>;
}>) {
  const onPanMove = (overrides?.onPanMove as Spy) ?? vi.fn();
  const onWheel = (overrides?.onWheel as Spy) ?? vi.fn();
  const onEndPan = (overrides?.onEndPan as Spy) ?? vi.fn();
  const onKeyDownZoom = (overrides?.onKeyDownZoom as Mock) ?? vi.fn();

  return {
    ...render(
      <BoardViewport
        camera={{ x: 0, y: 0, zoom: 1 }}
        onPanMove={onPanMove}
        onWheel={onWheel}
        onEndPan={onEndPan}
        onKeyDownZoom={onKeyDownZoom}
      />
    ),
    onPanMove, onWheel, onEndPan, onKeyDownZoom,
  };
}

describe('BoardViewport', () => {
  describe('TC-13: drag to pan', () => {
    it('cursor goes grabbing during drag and back to grab on release', async () => {
      const { onPanMove, container } = renderComponent();
      const viewport = container.querySelector('div[style*="position: fixed"]') as HTMLElement;

      // Pointer down → grabbing
      fireEvent.pointerDown(viewport, { clientX: 500, clientY: 400, pointerId: 1 });
      expect(viewport.style.cursor).toBe('grabbing');

      // Pointer move triggers pan
      fireEvent.pointerMove(viewport, { clientX: 700, clientY: 500, pointerId: 1 });
      expect(onPanMove).toHaveBeenCalled();

      // Pointer up → grab
      fireEvent.pointerUp(viewport, { clientX: 700, clientY: 500, pointerId: 1 });
      expect(viewport.style.cursor).toBe('grab');
    });
  });

  describe('TC-14: pointercancel mid-drag', () => {
    it('lostPointerCapture ends the drag (cursor back to grab)', async () => {
      const result = renderComponent();
      const { onEndPan, container } = result;
      const viewport = container.querySelector('div[style*="position: fixed"]') as HTMLElement;

      fireEvent.pointerDown(viewport, { clientX: 500, clientY: 400, pointerId: 1 });
      expect(viewport.style.cursor).toBe('grabbing');

      // lostPointerCapture is equivalent to pointercancel
      fireEvent.lostPointerCapture(viewport, { pointerId: 1 });
      expect(viewport.style.cursor).toBe('grab');
      expect(onEndPan).toHaveBeenCalled();
    });
  });

  describe('TC-29: click without moving', () => {
    it('pointerdown/up without move resets cursor to grab, no pan called', async () => {
      const result = renderComponent();
      const { onPanMove, container } = result;
      const viewport = container.querySelector('div[style*="position: fixed"]') as HTMLElement;

      fireEvent.pointerDown(viewport, { clientX: 500, clientY: 400, pointerId: 1 });
      fireEvent.pointerUp(viewport, { clientX: 500, clientY: 400, pointerId: 1 });

      expect(viewport.style.cursor).toBe('grab');
      expect(onPanMove).not.toHaveBeenCalled();
    });
  });

  describe('TC-15 + TC-16: wheel scroll', () => {
    it('wheel fires, prevents default, invokes onWheel callback', async () => {
      const { onWheel, container } = renderComponent();
      const viewport = container.querySelector('div[style*="position: fixed"]') as HTMLElement;

      await act(async () => { await new Promise(r => setTimeout(r, 0)); });

      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true, cancelable: true,
        deltaX: 0, deltaY: 100, deltaMode: 0,
      });
      Object.defineProperty(wheelEvent, 'ctrlKey', { value: false });
      Object.defineProperty(wheelEvent, 'metaKey', { value: false });
      viewport.dispatchEvent(wheelEvent);

      expect(wheelEvent.defaultPrevented).toBe(true);
      expect(onWheel).toHaveBeenCalledTimes(1);
      expect(onWheel).toHaveBeenCalledWith(0, 100, false, { x: 0, y: 0 });
    });

    it('Ctrl wheel passes ctrlOrMeta=true to onWheel', async () => {
      const { onWheel, container } = renderComponent();
      const viewport = container.querySelector('div[style*="position: fixed"]') as HTMLElement;

      await act(async () => { await new Promise(r => setTimeout(r, 0)); });

      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true, cancelable: true,
        deltaX: 0, deltaY: -100, deltaMode: 0,
      });
      Object.defineProperty(wheelEvent, 'ctrlKey', { value: true });
      Object.defineProperty(wheelEvent, 'metaKey', { value: false });
      viewport.dispatchEvent(wheelEvent);

      expect(wheelEvent.defaultPrevented).toBe(true);
      expect(onWheel).toHaveBeenCalledWith(0, -100, true, { x: 0, y: 0 });
    });
  });

  // Note: TouchAction and gesture events are verified in E2E tests.
  // In jsdom, useEffect doesn't fully run synchronously, so we skip this test here.
  describe('TC-18: keyboard shortcuts', () => {
    it('Ctrl+= zoomIn, Ctrl+- zoomOut, Ctrl+0 reset', async () => {
      const { onKeyDownZoom } = renderComponent();

      await act(async () => { await new Promise(r => setTimeout(r, 0)); });

      // Ctrl+= → zoomIn
      const plusEvent = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(plusEvent);
      expect(plusEvent.defaultPrevented).toBe(true);
      expect(onKeyDownZoom).toHaveBeenCalledWith('zoomIn');

      // Ctrl+- → zoomOut
      const minusEvent = new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(minusEvent);
      expect(minusEvent.defaultPrevented).toBe(true);
      expect(onKeyDownZoom).toHaveBeenCalledWith('zoomOut');

      // Ctrl+0 → reset
      const zeroEvent = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(zeroEvent);
      expect(zeroEvent.defaultPrevented).toBe(true);
      expect(onKeyDownZoom).toHaveBeenCalledWith('reset');
    });
  });
});
