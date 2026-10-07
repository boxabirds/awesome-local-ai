import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  TEST_BOARD_ID,
  dispatchGesture,
  dispatchKey,
  dispatchPointer,
  dispatchWheel,
  flushFrame,
  getCamera,
} from './util';

function setup() {
  render(<Board boardId={TEST_BOARD_ID} sync={false} />);
  const viewport = screen.getByTestId('board-viewport');
  const world = screen.getByTestId('board-world');
  const controls = screen.getByTestId('zoom-controls');
  return { viewport, world, controls };
}

describe('BoardViewport (viewport.input)', () => {
  // TC-13: pointer drag pans; world transform matches camera; Idle->Panning->Idle.
  it('TC-13 drags the board and updates the world transform', async () => {
    const { viewport, world } = setup();
    const before = getCamera();

    dispatchPointer(viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    expect(viewport.getAttribute('data-panning')).toBe('true'); // Panning

    dispatchPointer(viewport, 'pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
    const after = getCamera();
    expect(after.x).toBeCloseTo(before.x - 200, 9);
    expect(after.y).toBeCloseTo(before.y - 100, 9);

    await flushFrame();
    const cam = getCamera();
    expect(world.style.transform).toBe(
      `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
    );

    dispatchPointer(viewport, 'pointerup', { pointerId: 1 });
    expect(viewport.getAttribute('data-panning')).toBe('false'); // Idle
  });

  // TC-14: pointercancel freezes the camera; later moves are ignored.
  it('TC-14 freezes the camera at pointercancel and ignores later moves', () => {
    const { viewport } = setup();
    const before = getCamera();

    dispatchPointer(viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 1, clientX: 100, clientY: 50 });
    const atCancel = getCamera();
    expect(atCancel.x).toBeCloseTo(before.x - 100, 9);
    expect(atCancel.y).toBeCloseTo(before.y - 50, 9);

    dispatchPointer(viewport, 'pointercancel', { pointerId: 1 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 1, clientX: 500, clientY: 500 });
    expect(getCamera()).toBe(atCancel);
  });

  // TC-15: plain wheel pans in the scroll direction and is default-prevented.
  it('TC-15 plain wheel pans down (content up) and prevents default', () => {
    const { viewport } = setup();
    const before = getCamera();
    const ev = dispatchWheel(viewport, { deltaY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(getCamera().y).toBeCloseTo(before.y + 100 / before.zoom, 9);
  });

  // TC-16: Ctrl + wheel zooms in around the pointer and is default-prevented.
  it('TC-16 ctrl wheel zooms in and prevents default', () => {
    const { viewport } = setup();
    const before = getCamera();
    const ev = dispatchWheel(viewport, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBeGreaterThan(before.zoom);
  });

  // TC-17: Safari gesturechange doubles zoom (clamped) and is default-prevented.
  it('TC-17 gesturechange doubles zoom and prevents default', () => {
    const { viewport } = setup();
    const before = getCamera();
    const ev = dispatchGesture(viewport, 'gesturechange', 2, { x: 100, y: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(getCamera().zoom).toBeCloseTo(Math.min(before.zoom * 2, 4), 9);
  });

  // TC-18: keyboard shortcuts zoom/reset, each default-prevented.
  it('TC-18 ctrl +/-/0 zoom and reset, each preventing default', () => {
    setup();
    expect(getCamera().zoom).toBe(1);

    expect(dispatchKey({ key: '=', ctrlKey: true })).toBe(true);
    expect(getCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);

    expect(dispatchKey({ key: '-', ctrlKey: true })).toBe(true);
    expect(getCamera().zoom).toBe(1);

    expect(dispatchKey({ key: '0', ctrlKey: true })).toBe(true);
    expect(getCamera().zoom).toBe(1);
  });

  // TC-29 (negative): click without moving leaves the camera and the hint alone.
  it('TC-29 click without movement does not change camera or dismiss hint', async () => {
    const { viewport } = setup();
    const before = getCamera();

    dispatchPointer(viewport, 'pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 1 });
    await flushFrame();

    expect(getCamera()).toBe(before);
    expect(screen.queryByTestId('navigation-hint')).toBeTruthy();
  });

  // TC-30 (negative): Ctrl wheel over the zoom control does not zoom the board.
  it('TC-30 ctrl wheel over the zoom control does not zoom the board', () => {
    const { controls } = setup();
    const before = getCamera();
    const ev = dispatchWheel(controls, { deltaY: -100, ctrlKey: true });
    expect(getCamera()).toBe(before);
    expect(ev.defaultPrevented).toBe(false);
  });
});
