import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { App } from '../../src/client/App';
import { panBy, screenToWorld, worldToScreen, type Camera } from '../../src/client/canvas/camera';

const SIZE = { width: 1280, height: 800 };

function cam(): Camera {
  return (window as unknown as { __vidi6: { getCamera(): Camera } }).__vidi6.getCamera();
}

function pe(type: string, x: number, y: number) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  (ev as unknown as { pointerId: number }).pointerId = 1;
  return ev;
}

function fire(el: EventTarget, ev: Event): boolean {
  let prevented = false;
  act(() => {
    el.dispatchEvent(ev);
    prevented = ev.defaultPrevented;
  });
  return prevented;
}

function close(a: number, b: number, tol = 1e-4): boolean {
  return Math.abs(a - b) < tol;
}

beforeEach(() => {
  cleanup();
});

describe('TC-13 viewport.input: drag pans the board', () => {
  it('pointerdown/move(200,100)/up moves the world layer by exactly (200,100) and returns to idle', () => {
    const { getByTestId } = render(<BoardViewport size={SIZE} />);
    const vp = getByTestId('board-viewport');
    const world = getByTestId('world-layer');
    const cam0 = cam();
    expect(cam0).toEqual({ x: -640, y: -400, zoom: 1 });
    expect(vp.getAttribute('data-mode')).toBe('idle');

    // Down begins the pan: Idle -> Panning.
    expect(fire(vp, pe('pointerdown', 500, 500))).toBe(false);
    expect(vp.getAttribute('data-mode')).toBe('panning');

    // Move 200 right / 100 down: content follows the pointer exactly.
    fire(vp, pe('pointermove', 700, 600));
    const expected = panBy(cam0, 200, 100);
    const after = cam();
    expect(close(after.x, expected.x)).toBe(true);
    expect(close(after.y, expected.y)).toBe(true);
    expect(after.zoom).toBe(1);

    // Up ends the pan: Panning -> Idle.
    fire(vp, pe('pointerup', 700, 600));
    expect(vp.getAttribute('data-mode')).toBe('idle');

    // The world-layer transform moved by exactly (200, 100) screen pixels.
    expect(world.getAttribute('style')).toContain('scale(1) translate(840px, 500px)');
  });
});

describe('TC-14 viewport.input: drag interrupted by pointercancel', () => {
  it('freezes the camera at the moment of cancel and ignores later moves', () => {
    const { getByTestId } = render(<BoardViewport size={SIZE} />);
    const vp = getByTestId('board-viewport');

    fire(vp, pe('pointerdown', 500, 500));
    fire(vp, pe('pointermove', 700, 600)); // +200,+100
    const atCancel = cam();
    fire(vp, pe('pointercancel', 700, 600));
    expect(vp.getAttribute('data-mode')).toBe('idle');
    expect(cam()).toEqual(atCancel);

    // A later move (still pressed, but no pan active) is ignored.
    fire(vp, pe('pointermove', 1100, 1100));
    expect(cam()).toEqual(atCancel);
  });
});

describe('TC-15 viewport.input: plain wheel pans', () => {
  it('scrolling down (deltaY +100) increases camera y by 100/zoom and prevents default', () => {
    const { getByTestId } = render(<BoardViewport size={SIZE} />);
    const vp = getByTestId('board-viewport');
    const before = cam();
    const wheel = new WheelEvent('wheel', {
      deltaY: 100,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    const prevented = fire(vp, wheel);
    const after = cam();
    // Content moves up when scrolling down: camera y increases by deltaY/zoom.
    expect(close(after.y, before.y + 100 / before.zoom)).toBe(true);
    expect(close(after.x, before.x)).toBe(true);
    expect(prevented).toBe(true);
  });
});

describe('TC-16 viewport.input: Ctrl wheel zooms at the pointer', () => {
  it('zoom increases and keeps the pointer world point invariant; default prevented', () => {
    const { getByTestId } = render(<BoardViewport size={SIZE} />);
    const vp = getByTestId('board-viewport');
    const before = cam();
    const p = { x: 300, y: 200 };
    const beforeWorld = screenToWorld(before, p);
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });
    const prevented = fire(vp, wheel);
    const after = cam();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const afterWorld = screenToWorld(after, p);
    expect(close(afterWorld.x, beforeWorld.x)).toBe(true);
    expect(close(afterWorld.y, beforeWorld.y)).toBe(true);
    expect(prevented).toBe(true);
  });
});

describe('TC-17 viewport.input: Safari gesturechange', () => {
  it('gesturechange scale 2 doubles zoom (clamped) and prevents default', () => {
    const { getByTestId } = render(<BoardViewport size={SIZE} />);
    const vp = getByTestId('board-viewport');
    const before = cam();
    const g = new Event('gesturechange', { bubbles: true, cancelable: true });
    (g as unknown as { scale: number }).scale = 2;
    const prevented = fire(vp, g);
    const after = cam();
    // 1 * 2 = 2 doubles before clamping; verify it increased toward 2 and stays <= 4.
    expect(close(after.zoom, Math.min(before.zoom * 2, 4))).toBe(true);
    expect(prevented).toBe(true);
  });
});

describe('TC-18 viewport.input: keyboard zoom shortcuts', () => {
  it('Ctrl/=, Ctrl+-, Ctrl+0 change zoom 1 -> 1.25 -> 1 -> reset, each preventing default', () => {
    render(<BoardViewport size={SIZE} />);
    const step = (key: string) =>
      fire(window, new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));

    expect(step('=')).toBe(true);
    expect(cam().zoom).toBeCloseTo(1.25, 4);
    expect(step('-')).toBe(true);
    expect(cam().zoom).toBe(1);
    // Zoom in to a known non-default view, then reset recentres at zoom 1.
    expect(step('=')).toBe(true);
    expect(step('0')).toBe(true);
    expect(cam().zoom).toBe(1);
    // After reset the world origin sits at the centre of the 1280x800 board.
    const origin = worldToScreen(cam(), { x: 0, y: 0 });
    expect(close(origin.x, SIZE.width / 2)).toBe(true);
    expect(close(origin.y, SIZE.height / 2)).toBe(true);
  });
});

describe('TC-29 negative: click without moving', () => {
  it('camera unchanged and hint not dismissed', () => {
    const { getByTestId } = render(<App />);
    const vp = getByTestId('board-viewport');
    const before = cam();
    expect(getByTestId('navigation-hint')).toBeTruthy();

    fire(vp, pe('pointerdown', 400, 400));
    fire(vp, pe('pointerup', 400, 400));

    expect(cam()).toEqual(before);
    // The hint is still present because no navigation actually happened.
    expect(getByTestId('navigation-hint')).toBeTruthy();
  });
});

describe('TC-30 negative: Ctrl wheel over the zoom control', () => {
  it('does not zoom the board and does not suppress the browser default there', () => {
    const { getByTestId } = render(<App />);
    // Place the controls somewhere and dispatch Ctrl wheel directly on them.
    const controls = getByTestId('zoom-controls');
    const before = cam();
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: 10,
      clientY: 10,
      bubbles: true,
      cancelable: true,
    });
    const prevented = fire(controls, wheel);
    // Board camera unchanged because the wheel over the controls never reaches
    // the board's wheel listener (controls also stop propagation).
    expect(cam()).toEqual(before);
    expect(prevented).toBe(false);
  });
});
