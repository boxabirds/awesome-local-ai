import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { flushFrame, readCamera } from './helpers';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

function setup() {
  render(<BoardViewport />);
  const viewport = screen.getByTestId('board-viewport');
  const world = screen.getByTestId('board-world');
  return { viewport, world };
}

function down(el: Element, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}
function move(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}

describe('BoardViewport input', () => {
  it('TC-13 drag pans by the pointer delta; Idle→Panning→Idle', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    expect(viewport.dataset.panState).toBe('idle');
    down(viewport, 100, 100);
    expect(viewport.dataset.panState).toBe('panning');
    move(viewport, 300, 200);
    await flushFrame();
    const after = readCamera(world);
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 9);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 9);
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(viewport.dataset.panState).toBe('idle');
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('TC-14 pointercancel freezes the camera', async () => {
    const { viewport, world } = setup();
    down(viewport, 100, 100);
    move(viewport, 150, 130);
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    await flushFrame();
    const atCancel = readCamera(world);
    expect(viewport.dataset.panState).toBe('idle');
    move(viewport, 400, 400);
    await flushFrame();
    expect(readCamera(world)).toEqual(atCancel);
  });

  it('TC-15 plain wheel pans and prevents default', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    const notPrevented = fireEvent.wheel(viewport, { deltaY: 100, deltaX: 0 });
    await flushFrame();
    expect(notPrevented).toBe(false);
    const after = readCamera(world);
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 9);
    expect(after.x).toBe(before.x);
  });

  it('plain horizontal wheel moves content left', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    fireEvent.wheel(viewport, { deltaX: 40, deltaY: 0 });
    await flushFrame();
    expect(readCamera(world).x).toBeCloseTo(before.x + 40 / before.zoom, 9);
  });

  it('TC-16 ctrl wheel zooms in and prevents default', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    const notPrevented = fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    await flushFrame();
    expect(notPrevented).toBe(false);
    const after = readCamera(world);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // pointer world point invariant
    expect(300 / after.zoom + after.x).toBeCloseTo(300 / before.zoom + before.x, 6);
    expect(200 / after.zoom + after.y).toBeCloseTo(200 / before.zoom + before.y, 6);
  });

  it('TC-17 gesturechange scale 2 doubles zoom', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    const start = new Event('gesturestart', { bubbles: true, cancelable: true });
    viewport.dispatchEvent(start);
    const change = Object.assign(new Event('gesturechange', { bubbles: true, cancelable: true }), { scale: 2 });
    viewport.dispatchEvent(change);
    await flushFrame();
    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(readCamera(world).zoom).toBe(Math.min(before.zoom * 2, ZOOM_MAX));
  });

  it('TC-18 Ctrl+= Ctrl+- Ctrl+0', async () => {
    const { world } = setup();
    const start = readCamera(world);
    const press = async (key: string) => {
      const ev = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      await flushFrame();
    };
    await press('=');
    expect(readCamera(world).zoom).toBe(ZOOM_STEP_FACTOR);
    await press('-');
    expect(readCamera(world).zoom).toBe(1);
    await press('=');
    await press('0');
    const reset = readCamera(world);
    expect(reset.zoom).toBe(1);
    expect(reset).toEqual(start);
  });

  it('TC-29 click without moving changes nothing and keeps the hint', async () => {
    const { viewport, world } = setup();
    const before = readCamera(world);
    down(viewport, 50, 50);
    fireEvent.pointerUp(viewport, { clientX: 50, clientY: 50, pointerId: 1 });
    await flushFrame();
    expect(readCamera(world)).toEqual(before);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('TC-30 ctrl wheel over the zoom control does not zoom the board', async () => {
    const { world } = setup();
    const before = readCamera(world);
    const label = screen.getByTestId('zoom-label');
    const notPrevented = fireEvent.wheel(label, { deltaY: -100, ctrlKey: true });
    await flushFrame();
    expect(notPrevented).toBe(true); // browser default not suppressed there
    expect(readCamera(world)).toEqual(before);
  });

  it('TC-22 hint: visible → hidden → hidden', async () => {
    const { viewport } = setup();
    expect(screen.getByText(HINT)).toBeTruthy();
    fireEvent.wheel(viewport, { deltaY: 10 });
    await flushFrame();
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.wheel(viewport, { deltaY: 10 });
    await flushFrame();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('zoom buttons work and report the label', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await flushFrame();
    expect(screen.getByTestId('zoom-label').textContent).toBe('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    await flushFrame();
    expect(screen.getByTestId('zoom-label').textContent).toBe('100%');
  });
});
