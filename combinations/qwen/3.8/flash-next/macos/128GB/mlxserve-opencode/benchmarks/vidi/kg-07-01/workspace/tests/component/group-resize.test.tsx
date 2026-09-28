// tests/component/group-resize.test.tsx — Story 7 group resize, handles, scaling, clamping
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import {
  HANDLE_SIZE_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  camera,
  noteEl,
  press,
  renderApp,
  setCamera,
} from './helpers';

function getHandles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.selection-handle'));
}

function handleByDir(dir: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.selection-handle[data-handle="${dir}"]`);
  if (!el) throw new Error(`handle ${dir} not found`);
  return el;
}

/** Get the center of a handle element in screen coords (left + half). */
function handleScreenPos(el: HTMLElement): { x: number; y: number } {
  const half = HANDLE_SIZE_PX / 2;
  return { x: parseFloat(el.style.left) + half, y: parseFloat(el.style.top) + half };
}

describe('TC-29a every handle keeps its cursor; opposite corner fixed; group resize', () => {
  it('handles have correct cursors', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));
    const handles = getHandles();
    expect(handles).toHaveLength(8);

    const cursors: Record<string, string> = {
      nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
      e: 'e-resize', se: 'se-resize', s: 's-resize',
      sw: 'sw-resize', w: 'w-resize',
    };
    for (const [dir, cur] of Object.entries(cursors)) {
      const h = handleByDir(dir);
      expect(h.style.cursor).toBe(cur);
    }
  });

  it('SE drag moves SE corner, NW stays fixed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const before = snapshot(doc).find((n) => n.id === s)!;
    const nwX = before.x;
    const nwY = before.y;

    // Get the SE handle's current screen position
    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Drag SE by (50, 50) in screen coords (= (50, 50) world at zoom 1)
    // With aspect lock: new w = 200+50 = 250, new h = 200+50 = 250 (ratio maintained)
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 50, clientY: pos.y + 50, pointerId: 5, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 50, clientY: pos.y + 50, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    // NW corner should stay fixed
    expect(after.x).toBeCloseTo(nwX);
    expect(after.y).toBeCloseTo(nwY);
    // Both w and h should have expanded by 50 (aspect ratio 1:1 maintained)
    expect((after.width ?? STICKY_SIZE_WORLD)).toBeCloseTo(250, 0);
    expect((after.height ?? STICKY_SIZE_WORLD)).toBeCloseTo(250, 0);
  });
});

describe('TC-29b shift+corner scales corners with same factor', () => {
  it('SE resize with shift maintains aspect ratio 1:1 (same as default for sticky)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Drag SE with shift: screen delta (100, 50) → world delta (100, 50) at zoom 1.
    // Original box: 200x200. Aspect lock uses dominant axis: |sw-1|=0.5, |sh-1|=0.25 → sw wins
    // Expected: new w = 200*1.5 = 300, new h = 200*1.5 = 300 (both use dominant scale)
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 100, clientY: pos.y + 50, pointerId: 5, buttons: 1, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 100, clientY: pos.y + 50, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    expect(after.width).toBeCloseTo(300, 0);
    expect(after.height).toBeCloseTo(300, 0);
  });
});

describe('TC-32 corner handles move with the camera', () => {
  it('handles reposition after camera change', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const seBefore = handleByDir('se');
    const posBefore = { left: parseFloat(seBefore.style.left), top: parseFloat(seBefore.style.top) };

    // Read current camera
    const cam0 = camera();

    // Change camera: pan right by 50
    setCamera({ x: cam0.x + 50, y: cam0.y + 50, zoom: cam0.zoom });

    const seAfter = handleByDir('se');
    const posAfter = { left: parseFloat(seAfter.style.left), top: parseFloat(seAfter.style.top) };

    // screenX = (worldX - camX) * zoom. camX increased by 50 → screen decreased by 50.
    expect(posAfter.left - posBefore.left).toBeCloseTo(-50, 0);
    expect(posAfter.top - posBefore.top).toBeCloseTo(-50, 0);
  });
});

describe('TC-33 resize at zoom 0.5 and 2.0; clamp to max on huge drag', () => {
  it('resize at zoom 2.0', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    // Set camera to zoom 2.0.
    const cam0 = camera();
    setCamera({ x: cam0.x, y: cam0.y, zoom: 2.0 });

    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Move by (40, 0) screen → (20, 0) world at zoom 2.
    // With aspect lock (sticky always 1:1): dominant axis w gives scale 1.1
    // Both w and h = 200*1.1 = 220.
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 40, clientY: pos.y, pointerId: 5, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 40, clientY: pos.y, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    expect(after.width).toBeCloseTo(220, 0);
    expect(after.height).toBeCloseTo(220, 0);
  });

  it('clamps to MAX_OBJECT_SIZE_WORLD on huge drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const cam0 = camera();
    setCamera({ x: cam0.x, y: cam0.y, zoom: 0.1 });

    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Drag SE by huge amount: screen delta (500, 500) → world delta (5000, 5000).
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 500, clientY: pos.y + 500, pointerId: 5, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 500, clientY: pos.y + 500, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    expect(after.width!).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1);
    expect(after.height!).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 1);
  });

  it('resize at zoom 0.5', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    // At zoom 0.5, same position as initial camera.
    const cam0 = camera();
    setCamera({ x: cam0.x, y: cam0.y, zoom: 0.5 });

    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Move by (20, 20) screen → (40, 40) world at zoom 0.5.
    // Aspect lock (1:1): both w and h = 200+40 = 240.
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 20, clientY: pos.y + 20, pointerId: 5, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 20, clientY: pos.y + 20, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    expect(after.width).toBeCloseTo(240, 0);
    expect(after.height).toBeCloseTo(240, 0);
  });

  it('resize clamps to STICKY_MIN_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const se = handleByDir('se');
    const pos = handleScreenPos(se);

    // Drag SE handle way back: screen delta (-300,-300) → world delta (-300,-300).
    // That would shrink to 200-300=-100 → clamped to STICKY_MIN_SIZE_WORLD.
    act(() => {
      fireEvent.pointerDown(se, { clientX: pos.x, clientY: pos.y, pointerId: 5, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x - 300, clientY: pos.y - 300, pointerId: 5, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x - 300, clientY: pos.y - 300, pointerId: 5, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    expect(after.width!).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
    expect(after.height!).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
  });
});
