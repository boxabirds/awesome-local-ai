import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  INITIAL_CAMERA,
  STEP,
  boardDown,
  boardElement,
  boardMove,
  boardUp,
  controlElement,
  dragTo,
  endDrag,
  expectSettled,
  fireBoardEvent,
  flush,
  flushFrames,
  gesture,
  gridElement,
  isDisabled,
  key,
  readCamera,
  pointerEvent,
  readZoomLabel,
  renderBoard,
  wheel,
  worldElement,
  worldTransformOf,
  worldUnder,
} from './harness.js';
import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config.js';

const CENTRE_SCREEN = { x: 1280 / 2, y: 800 / 2 };

describe('drag to pan (TC-13)', () => {
  it('moves the board by exactly the pointer delta and cycles Idle -> Panning -> Idle', async () => {
    renderBoard();
    const board = boardElement();
    const before = readCamera();
    expect(before).toEqual(INITIAL_CAMERA);

    await boardDown(400, 300);
    expect(board.dataset.panning).toBe('true');

    await boardMove(600, 400);
    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 9);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 9);
    // the world layer transform mirrors the camera, so content follows the pointer
    expect(worldElement().style.transform).toBe(worldTransformOf(after));
    expect(worldElement().dataset.worldTransform).toBe(worldTransformOf(after));

    await boardUp(600, 400);
    expect(board.dataset.panning).toBe('false');
  });

  it('moves a visible grid dot by exactly the pointer delta', async () => {
    renderBoard();
    const before = readCamera();
    const spacing = GRID_SPACING_WORLD * before.zoom;
    const dotBefore = { x: 400, y: 300 };
    await dragTo(dotBefore.x, dotBefore.y, dotBefore.x + 200, dotBefore.y + 100);

    const after = readCamera();
    // the dot lattice moved with the camera
    expect(after.x).toBeCloseTo(before.x - 200 / before.zoom, 9);
    expect(after.y).toBeCloseTo(before.y - 100 / before.zoom, 9);
    // and the grid tile is still the configured spacing at this zoom
    expect(gridElement().style.backgroundSize).toBe(
      `${spacing}px ${spacing}px`,
    );
    await endDrag(dotBefore.x + 200, dotBefore.y + 100);
  });

  it('ends the drag on lostpointercapture and ignores moves after it', async () => {
    renderBoard();
    const board = boardElement();
    await dragTo(50, 50, 90, 90);
    const frozen = readCamera();

    await fireBoardEvent('lostpointercapture');
    expect(board.dataset.panning).toBe('false');

    await boardMove(400, 400);
    expect(readCamera()).toEqual(frozen);
  });

  it('lands the last pointer position when the pointer is released within the same frame', async () => {
    // WebKit delivers `pointerup` in the frame of the final move: the queued delta
    // must still be applied, so the board never stops one step short of the pointer.
    renderBoard();
    const board = boardElement();
    pointerEvent('pointerdown', board, 100, 100, 1);
    pointerEvent('pointermove', board, 260, 190, 1);
    pointerEvent('pointerup', board, 260, 190, 0);
    await flush();

    expect(readCamera().x).toBeCloseTo(INITIAL_CAMERA.x - 160, 9);
    expect(readCamera().y).toBeCloseTo(INITIAL_CAMERA.y - 90, 9);
    expect(board.dataset.panning).toBe('false');
  });

  it('batches a burst of pointer moves into one camera position per frame', async () => {
    renderBoard();
    await boardDown(0, 0);
    for (let x = 10; x <= 60; x += 10) {
      pointerEvent('pointermove', boardElement(), x, 10, 1);
    }
    await flushFrames();
    // the newest pointer position wins, and nothing is left over
    expect(readCamera().x).toBeCloseTo(INITIAL_CAMERA.x - 60, 9);
    await boardUp(60, 10);
  });
});

describe('interrupted drag (TC-14)', () => {
  it('freezes the camera at the moment of pointercancel and ignores later moves', async () => {
    renderBoard();
    const board = boardElement();
    await dragTo(100, 100, 160, 130);
    const frozen = readCamera();

    await fireBoardEvent('pointercancel');
    expect(board.dataset.panning).toBe('false');

    await boardMove(900, 900);
    expect(readCamera()).toEqual(frozen);
  });
});

describe('scroll to pan (TC-15)', () => {
  it('moves the camera in the scroll direction and stops the page from scrolling', async () => {
    renderBoard();
    const before = readCamera();

    const prevented = await wheel(boardElement(), { deltaY: 100, clientX: 640, clientY: 400 });
    const after = readCamera();

    expect(prevented).toBe(true);
    expect(after.zoom).toBe(before.zoom);
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 9);
  });

  it('pans for a horizontal trackpad swipe', async () => {
    renderBoard();
    const before = readCamera();
    const prevented = await wheel(boardElement(), { deltaX: 40, clientX: 640, clientY: 400 });
    expect(prevented).toBe(true);
    expect(readCamera().x).toBeCloseTo(before.x + 40 / before.zoom, 9);
  });

  it('converts line-mode wheel deltas into pixels', async () => {
    renderBoard();
    const before = readCamera();
    await wheel(boardElement(), { deltaY: 3, deltaMode: 1, clientX: 640, clientY: 400 });
    expect(readCamera().y).toBeCloseTo(before.y + 3 * 16, 9);
  });

  it('keeps the grid tile welded to the camera after a scroll', async () => {
    renderBoard();
    await wheel(boardElement(), { deltaY: 100, clientX: 640, clientY: 400 });
    const cam = readCamera();
    expect(gridElement().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * cam.zoom}px ${GRID_SPACING_WORLD * cam.zoom}px`,
    );
  });
});

describe('pinch and Ctrl/Cmd scroll to zoom (TC-16)', () => {
  it('zooms around the pointer and stops the page from zooming', async () => {
    renderBoard();
    const before = readCamera();
    const point = { x: 300, y: 200 };

    const prevented = await wheel(boardElement(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: point.x,
      clientY: point.y,
    });
    const after = readCamera();

    expect(prevented).toBe(true);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const beforeWorld = worldUnder(before, point);
    const afterWorld = worldUnder(after, point);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 9);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 9);
  });

  it('treats Cmd (macOS pinch) like Ctrl', async () => {
    renderBoard();
    const before = readCamera();
    await wheel(boardElement(), { deltaY: -50, metaKey: true, clientX: 200, clientY: 200 });
    expect(readCamera().zoom).toBeGreaterThan(before.zoom);
  });

  it('scales the grid tile with the zoom', async () => {
    renderBoard();
    await wheel(boardElement(), { deltaY: -100, ctrlKey: true, clientX: 640, clientY: 400 });
    const cam = readCamera();
    expect(gridElement().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * cam.zoom}px ${GRID_SPACING_WORLD * cam.zoom}px`,
    );
  });

  it('stops at ZOOM_MAX and disables the zoom-in button', async () => {
    renderBoard();
    for (let i = 0; i < 20; i++) {
      await wheel(boardElement(), { deltaY: -400, ctrlKey: true, clientX: 640, clientY: 400 });
    }
    await expectSettled(() => {
      expect(readCamera().zoom).toBe(ZOOM_MAX);
    });
    expect(isDisabled('zoom-in')).toBe(true);
    expect(readZoomLabel()).toBe('400%');
  });

  it('stops at ZOOM_MIN and disables the zoom-out button', async () => {
    renderBoard();
    for (let i = 0; i < 20; i++) {
      await wheel(boardElement(), { deltaY: 400, ctrlKey: true, clientX: 640, clientY: 400 });
    }
    await expectSettled(() => {
      expect(readCamera().zoom).toBe(ZOOM_MIN);
    });
    expect(isDisabled('zoom-out')).toBe(true);
    expect(readZoomLabel()).toBe('10%');
  });
});

describe('Safari pinch gesture (TC-17)', () => {
  it('zooms by the gesture scale and prevents the default page zoom', async () => {
    renderBoard();
    const before = readCamera();

    const prevented = await gesture(boardElement(), { scale: 2, clientX: 300, clientY: 200 });
    const after = readCamera();

    expect(prevented).toBe(true);
    expect(after.zoom).toBeCloseTo(before.zoom * 2, 9);
    const beforeWorld = worldUnder(before, { x: 300, y: 200 });
    const afterWorld = worldUnder(after, { x: 300, y: 200 });
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 9);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 9);
  });

  it('clamps a gesture that asks for more than the maximum zoom', async () => {
    renderBoard();
    const prevented = await gesture(boardElement(), { scale: 1e6, clientX: 300, clientY: 200 });
    expect(prevented).toBe(true);
    await expectSettled(() => {
      expect(readCamera().zoom).toBe(ZOOM_MAX);
    });
  });

  it('does not move the camera for a gesture whose scale is 1', async () => {
    renderBoard();
    const before = readCamera();
    await gesture(boardElement(), { scale: 1, clientX: 300, clientY: 200 });
    expect(readCamera()).toEqual(before);
  });
});

describe('keyboard shortcuts (TC-18)', () => {
  it('steps with Ctrl+= and Ctrl+- and resets with Ctrl+0, preventing the default each time', async () => {
    renderBoard();
    expect(readZoomLabel()).toBe('100%');

    expect(await key({ key: '=', ctrlKey: true })).toBe(true);
    await expectSettled(() => {
      expect(readZoomLabel()).toBe(`${Math.round(STEP * 100)}%`);
    });
    expect(readCamera().zoom).toBe(STEP);

    expect(await key({ key: '-', ctrlKey: true })).toBe(true);
    await expectSettled(() => {
      expect(readZoomLabel()).toBe('100%');
    });
    expect(readCamera().zoom).toBe(1);

    // travel away, then return to the known view
    await wheel(boardElement(), { deltaY: 250, clientX: 640, clientY: 400 });
    expect(readCamera().y).not.toBe(INITIAL_CAMERA.y);

    expect(await key({ key: '0', ctrlKey: true })).toBe(true);
    await expectSettled(() => {
      expect(readZoomLabel()).toBe('100%');
    });
    expect(readCamera()).toEqual(INITIAL_CAMERA);
  });

  it('accepts Cmd and the shifted + and _ forms', async () => {
    renderBoard();
    await key({ key: '+', metaKey: true });
    await expectSettled(() => {
      expect(readCamera().zoom).toBe(STEP);
    });
    await key({ key: '_', metaKey: true });
    await expectSettled(() => {
      expect(readCamera().zoom).toBe(1);
    });
  });

  it('leaves other Ctrl/Cmd browser shortcuts alone', async () => {
    renderBoard();
    const before = readCamera();
    expect(await key({ key: 'r', ctrlKey: true })).toBe(false);
    expect(await key({ key: '1', ctrlKey: true })).toBe(false);
    expect(readCamera()).toEqual(before);
  });

  it('steps around the centre of the board area', async () => {
    renderBoard();
    const before = readCamera();
    await key({ key: '=', ctrlKey: true });
    const after = readCamera();
    const beforeWorld = worldUnder(before, CENTRE_SCREEN);
    const afterWorld = worldUnder(after, CENTRE_SCREEN);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 9);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 9);
  });

  it('does not treat a bare key press as a shortcut', async () => {
    renderBoard();
    const before = readCamera();
    expect(await key({ key: '=' })).toBe(false);
    expect(await key({ key: '0' })).toBe(false);
    expect(readCamera()).toEqual(before);
  });
});

describe('negative: click without movement (TC-29)', () => {
  it('leaves the camera alone and keeps the hint visible', async () => {
    renderBoard();
    const board = boardElement();
    await boardDown(300, 200);
    expect(board.dataset.panning).toBe('true');
    await boardUp(300, 200);
    await flushFrames();

    expect(readCamera()).toEqual(INITIAL_CAMERA);
    expect(screen.getByTestId('navigation-hint')).toBeTruthy();
    expect(board.dataset.panning).toBe('false');
  });

  it('does not pan when a drag is started over the zoom control', async () => {
    renderBoard();
    const before = readCamera();
    pointerEvent('pointerdown', controlElement(), 1200, 760, 1);
    await flush();
    await boardMove(1000, 700);
    expect(readCamera()).toEqual(before);
  });
});

describe('negative: gestures over the zoom control (TC-30)', () => {
  it('does not zoom the board for Ctrl/Cmd + wheel over the control, leaving the browser default alone', async () => {
    renderBoard();
    const before = readCamera();

    const prevented = await wheel(controlElement(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: 1200,
      clientY: 760,
    });

    expect(prevented).toBe(false);
    expect(readCamera()).toEqual(before);
  });

  it('does not pan the board for a plain wheel over the control', async () => {
    renderBoard();
    const before = readCamera();
    await wheel(controlElement(), { deltaY: 200, clientX: 1200, clientY: 760 });
    expect(readCamera()).toEqual(before);
  });
});
