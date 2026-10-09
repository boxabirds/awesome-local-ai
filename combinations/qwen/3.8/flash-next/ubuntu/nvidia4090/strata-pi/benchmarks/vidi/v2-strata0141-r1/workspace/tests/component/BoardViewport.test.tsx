import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  boardElement,
  dispatchGesture,
  dispatchWheel,
  dotAlignmentError,
  flushFrame,
  mod,
  pointerEvent,
  pressKeys,
  readCamera,
  readGrid,
  renderBoard,
  zoomLabel,
} from './harness';

const RESET_VIEWPORT_TOLERANCE = 1e-6;

describe('BoardViewport (viewport.input)', () => {
  it('TC-13: dragging moves the board by exactly the pointer delta, Idle -> Panning -> Idle', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();
    expect(boardElement().dataset.panning).toBe('false');

    pointerEvent('pointerdown', 100, 100);
    expect(boardElement().dataset.panning).toBe('true');
    pointerEvent('pointermove', 200, 150);
    pointerEvent('pointermove', 300, 200);
    expect(boardElement().dataset.panning).toBe('true');
    pointerEvent('pointerup', 300, 200);
    expect(boardElement().dataset.panning).toBe('false');
    await flushFrame();

    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 100, 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 9);
    // The hint is dismissed by the first pan.
    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });

  it('TC-14: a drag interrupted by pointercancel freezes the camera; later moves are ignored', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();

    pointerEvent('pointerdown', 50, 50);
    pointerEvent('pointermove', 130, 90);
    await flushFrame();
    const atCancel = readCamera();
    expect(atCancel.x).toBeCloseTo(before.x - 80, 6);
    expect(atCancel.y).toBeCloseTo(before.y - 40, 6);

    pointerEvent('pointercancel', 130, 90);
    expect(boardElement().dataset.panning).toBe('false');
    pointerEvent('pointermove', 900, 900);
    pointerEvent('pointerup', 900, 900);
    await flushFrame();

    const after = readCamera();
    expect(after.x).toBeCloseTo(atCancel.x, 6);
    expect(after.y).toBeCloseTo(atCancel.y, 6);
  });

  it('TC-15: plain wheel pans in the scroll direction and is preventDefaulted', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();

    const event = dispatchWheel(boardElement(), { deltaY: 100 });
    await flushFrame();

    const after = readCamera();
    expect(event.defaultPrevented).toBe(true);
    // Scrolling down moves content up: camera y increases by 100 / zoom.
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(after.x).toBeCloseTo(before.x, 6);

    // Horizontal trackpad scroll: scrolling right moves content left.
    const rightward = dispatchWheel(boardElement(), { deltaX: 60 });
    await flushFrame();
    const afterX = readCamera();
    expect(rightward.defaultPrevented).toBe(true);
    expect(afterX.x).toBeCloseTo(after.x + 60 / after.zoom, 6);
  });

  it('TC-16: Ctrl/Cmd wheel zooms at the pointer and is preventDefaulted', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();
    const pointer = { x: 300, y: 200 };
    const worldBefore = {
      x: pointer.x / before.zoom + before.x,
      y: pointer.y / before.zoom + before.y,
    };

    const event = dispatchWheel(boardElement(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    await flushFrame();
    const after = readCamera();

    expect(event.defaultPrevented).toBe(true);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    // The world point under the pointer keeps its screen position.
    expect((worldBefore.x - after.x) * after.zoom).toBeCloseTo(pointer.x, 4);
    expect((worldBefore.y - after.y) * after.zoom).toBeCloseTo(pointer.y, 4);

    const meta = dispatchWheel(boardElement(), {
      deltaY: -100,
      metaKey: true,
      clientX: pointer.x,
      clientY: pointer.y,
    });
    await flushFrame();
    expect(meta.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeGreaterThan(after.zoom);
  });

  it('TC-17: a Safari gesture (gesturechange scale 2) doubles the zoom, clamped, preventDefaulted', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();

    const start = dispatchGesture('gesturestart', 1);
    const change = dispatchGesture('gesturechange', 2);
    await flushFrame();
    const after = readCamera();

    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(after.zoom).toBeCloseTo(Math.min(before.zoom * 2, ZOOM_MAX), 6);

    // Clamped: already at the maximum, zooming further does nothing.
    const big = dispatchGesture('gesturechange', 1_000);
    await flushFrame();
    expect(big.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_MAX, 6);
  });

  it('TC-18: Ctrl/Cmd + = / - / 0 zoom one step each and reset, all preventDefaulted', async () => {
    renderBoard();
    await flushFrame();
    const start = readCamera();
    expect(start.zoom).toBeCloseTo(1, 9);

    const zoomIn = pressKeys('=', { ctrl: true });
    await flushFrame();
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(zoomLabel()).toBe('125%');

    const zoomOut = pressKeys('-', { ctrl: true });
    await flushFrame();
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBe(1);
    expect(zoomLabel()).toBe('100%');

    // Pan away first so reset has something to undo.
    dispatchWheel(boardElement(), { deltaY: 300 });
    await flushFrame();
    expect(readCamera().y).not.toBeCloseTo(start.y, 6);

    const reset = pressKeys('0', { ctrl: true });
    await flushFrame();
    expect(reset.defaultPrevented).toBe(true);
    const camera = readCamera();
    expect(camera.zoom).toBe(1);
    expect(camera.x).toBeCloseTo(-window.innerWidth / 2, RESET_VIEWPORT_TOLERANCE);
    expect(camera.y).toBeCloseTo(-window.innerHeight / 2, RESET_VIEWPORT_TOLERANCE);
    expect(zoomLabel()).toBe('100%');

    // Cmd variants work too.
    const cmd = pressKeys('=', { meta: true });
    await flushFrame();
    expect(cmd.defaultPrevented).toBe(true);
    expect(readCamera().zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
  });

  it('TC-29: a click without moving leaves the camera unchanged and keeps the hint', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();

    pointerEvent('pointerdown', 400, 300);
    pointerEvent('pointerup', 400, 300);
    await flushFrame();

    expect(readCamera()).toEqual(before);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(zoomLabel()).toBe('100%');
  });

  it('TC-30: Ctrl/Cmd wheel over the zoom control does not zoom the board', async () => {
    renderBoard();
    await flushFrame();
    const before = readCamera();
    const zoomOutButton = screen.getByRole('button', { name: 'Zoom out' });

    const event = dispatchWheel(zoomOutButton, { deltaY: -100, ctrlKey: true, clientX: 1200, clientY: 700 });
    await flushFrame();

    expect(readCamera()).toEqual(before);
    expect(zoomLabel()).toBe('100%');
    // Over the control the browser default is left alone.
    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-23/TC-24 (grid): the dot pattern is anchored to world coordinates, not the screen', async () => {
    renderBoard();
    await flushFrame();

    const beforeCamera = readCamera();
    const beforeGrid = readGrid();
    expect(beforeGrid.spacingPx).toBeCloseTo(GRID_SPACING_WORLD * beforeCamera.zoom, 6);
    // A dot sits exactly on the board's starting point (world 0,0).
    expect(dotAlignmentError(-beforeCamera.x * beforeCamera.zoom, beforeGrid.offsetX, beforeGrid.spacingPx)).toBeLessThan(1e-6);
    expect(dotAlignmentError(-beforeCamera.y * beforeCamera.zoom, beforeGrid.offsetY, beforeGrid.spacingPx)).toBeLessThan(1e-6);

    pointerEvent('pointerdown', 100, 100);
    pointerEvent('pointermove', 300, 200);
    pointerEvent('pointerup', 300, 200);
    await flushFrame();

    const afterCamera = readCamera();
    const afterGrid = readGrid();
    // Spacing unchanged (zoom unchanged); dots moved with the board by exactly
    // the pointer delta, which shows up as a shift of the tile offset modulo
    // the spacing.
    expect(afterGrid.spacingPx).toBeCloseTo(beforeGrid.spacingPx, 6);
    expect(mod(afterGrid.offsetX - beforeGrid.offsetX, beforeGrid.spacingPx)).toBeCloseTo(
      mod(200, beforeGrid.spacingPx),
      6,
    );
    expect(mod(afterGrid.offsetY - beforeGrid.offsetY, beforeGrid.spacingPx)).toBeCloseTo(
      mod(100, beforeGrid.spacingPx),
      6,
    );
    expect(dotAlignmentError(-afterCamera.x * afterCamera.zoom, afterGrid.offsetX, afterGrid.spacingPx)).toBeLessThan(1e-6);
    expect(dotAlignmentError(-afterCamera.y * afterCamera.zoom, afterGrid.offsetY, afterGrid.spacingPx)).toBeLessThan(1e-6);
  });

  it('grid spacing scales with zoom so dots stay GRID_SPACING_WORLD board units apart', async () => {
    renderBoard();
    await flushFrame();
    expect(readGrid().spacingPx).toBeCloseTo(GRID_SPACING_WORLD, 6);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await flushFrame();

    const camera = readCamera();
    const grid = readGrid();
    expect(camera.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(grid.spacingPx).toBeCloseTo(GRID_SPACING_WORLD * camera.zoom, 6);
    expect(dotAlignmentError(-camera.x * camera.zoom, grid.offsetX, grid.spacingPx)).toBeLessThan(1e-6);
    expect(dotAlignmentError(-camera.y * camera.zoom, grid.offsetY, grid.spacingPx)).toBeLessThan(1e-6);
  });
});
