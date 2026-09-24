import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { resetCamera, screenToWorld } from '../../src/client/canvas/camera';
import { ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import {
  DEFAULT_SIZE,
  enableFakeFrameTimers,
  flushFrames,
  renderHarness,
} from './test-utils';

describe('viewport.input', () => {
  beforeEach(() => {
    enableFakeFrameTimers();
  });

  afterEach(() => {
    // cleanup() runs from the shared setup file.
    vi.useRealTimers();
  });

  it('TC-13 drag pans the board exactly and the state machine returns to idle', () => {
    const { apiRef, viewport, world } = renderHarness();
    const initial = resetCamera(DEFAULT_SIZE);
    expect(apiRef.current!.camera).toEqual(initial);

    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 50, button: 0 });
    expect(viewport.classList.contains('vidi6-viewport--panning')).toBe(true);

    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 150 });
    flushFrames();
    const cam = apiRef.current!.camera;
    // Pointer moved +200,+100: the camera (world at top-left) moves by the
    // negative delta, so the board content follows the pointer exactly.
    expect(cam.x).toBe(initial.x - 200);
    expect(cam.y).toBe(initial.y - 100);
    expect(cam.zoom).toBe(initial.zoom);

    // The world layer transform matches the camera.
    expect(world.style.transform).toBe(`scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`);

    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 150, button: 0 });
    flushFrames();
    expect(viewport.classList.contains('vidi6-viewport--panning')).toBe(false);
  });

  it('TC-14 pointercancel mid-drag freezes the camera; later moves are ignored', () => {
    const { apiRef, viewport } = renderHarness();
    const initial = resetCamera(DEFAULT_SIZE);

    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 50, button: 0 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 150 });
    flushFrames();
    const atCancel = { ...apiRef.current!.camera };

    fireEvent.pointerCancel(viewport, { clientX: 260, clientY: 210 });
    fireEvent.pointerMove(viewport, { clientX: 400, clientY: 300 });
    flushFrames();

    expect(apiRef.current!.camera).toEqual(atCancel);
    expect(apiRef.current!.camera).not.toEqual(initial);
    expect(viewport.classList.contains('vidi6-viewport--panning')).toBe(false);
  });

  it('TC-15 a plain wheel pans the board and the event is always preventDefaulted', () => {
    const { apiRef, viewport } = renderHarness();
    const before = apiRef.current!.camera;

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      clientX: 320,
      clientY: 240,
    });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    flushFrames();
    const after = apiRef.current!.camera;
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 10);
    expect(after.x).toBe(before.x);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-16 Ctrl-wheel zooms around the pointer and the event is preventDefaulted', () => {
    const { apiRef, viewport } = renderHarness();
    const before = apiRef.current!.camera;
    const point = { x: 300, y: 200 };

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: 300,
      clientY: 200,
    });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    flushFrames();
    const after = apiRef.current!.camera;
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // The world point under the pointer stays put.
    const wBefore = screenToWorld(before, point);
    const wAfter = screenToWorld(after, point);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(1e-6);
  });

  it('TC-17 a Safari gesturechange zooms by the scale ratio and is preventDefaulted', () => {
    const { apiRef, viewport } = renderHarness();
    const before = apiRef.current!.camera;

    const event = new Event('gesturechange', {
      bubbles: true,
      cancelable: true,
    }) as Event & { scale: number; clientX: number; clientY: number };
    event.scale = 2;
    event.clientX = 300;
    event.clientY = 200;
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    flushFrames();
    expect(Math.abs(apiRef.current!.camera.zoom - before.zoom * 2)).toBeLessThan(1e-9);
  });

  it('TC-18 Ctrl/Cmd + = / - / 0 step the zoom and reset, each preventDefaulted', () => {
    const { apiRef, viewport } = renderHarness();
    const initial = resetCamera(DEFAULT_SIZE);

    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      flushFrames();
      return event;
    };

    expect(press('=').defaultPrevented).toBe(true);
    expect(apiRef.current!.camera.zoom).toBe(ZOOM_STEP_FACTOR);

    expect(press('-').defaultPrevented).toBe(true);
    expect(apiRef.current!.camera.zoom).toBe(1);

    // Pan away first so the reset is observable.
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 100, button: 0 });
    flushFrames();
    expect(apiRef.current!.camera.x).toBe(initial.x - 200);

    expect(press('0').defaultPrevented).toBe(true);
    expect(apiRef.current!.camera).toEqual(initial);
  });

  it('TC-29 a click without movement changes nothing and keeps the hint', () => {
    const { apiRef, viewport } = renderHarness();
    const initial = apiRef.current!.camera;

    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 50, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 100, clientY: 50, button: 0 });
    flushFrames();

    expect(apiRef.current!.camera).toBe(initial);
    expect(apiRef.current!.hasNavigated).toBe(false);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });

  it('TC-30 Ctrl-wheel over the zoom controls does not zoom the board or suppress the default', () => {
    const { apiRef } = renderHarness();
    const initial = apiRef.current!.camera;
    const controls = document.querySelector('.vidi6-zoom-controls') as HTMLElement;

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    controls.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    flushFrames();
    expect(apiRef.current!.camera).toBe(initial);
  });
});
