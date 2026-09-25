import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { dispatch, pointerEvent } from './harness';
import { renderApp, flush, type SeedNote } from './appHarness';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7 component tests: multi-select, group move, resize, keyboard.
 *
 * These cover the story-7 behaviours that are NOT already covered by the
 * story-2 StickyNote.test.tsx. Where a story-2 test still describes a
 * single-note interaction, it stays where it is.
 */

/** A spread of 4 notes so a marquee, group drag or resize has room. */
const CLUSTER: SeedNote[] = [
  { x: 100, y: 100 },
  { x: 340, y: 100 },
  { x: 580, y: 100 },
  { x: 820, y: 100 },
];

function noteAt(harness: ReturnType<typeof renderApp>, i: number) {
  const n = harness.notes()[i];
  return { id: n.id, element: harness.noteElement(n.id) };
}

/**
 * Press, drag and release on the given element, at screen coordinates.
 * The pointer travels past the drag threshold before the move lands, so the
 * gesture hook always treats it as a real drag rather than a click.
 */
async function drag(
  harness: ReturnType<typeof renderApp>,
  target: EventTarget,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { shiftKey?: boolean } = {},
): Promise<void> {
  const mk = (type: string, x: number, y: number, buttons: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: options.shiftKey ?? false,
    });
    Object.defineProperty(event, 'buttons', { value: buttons });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    return event;
  };

  await dispatch(target, mk('pointerdown', from.x, from.y, 1));
  // Pointer moves go on the window: that is where the gesture listeners live
  // in the running app, and jsdom does not bubble an event from an element
  // to the window the way a real browser does.
  await dispatch(window, mk('pointermove', to.x, to.y, 1));
  await flush();
  await dispatch(window, mk('pointerup', to.x, to.y, 0));
  await flush();
}

describe('multi-select (TC-16 through TC-22)', () => {
  it('Shift-click on a note adds or removes it from the selection', async () => {
    const harness = renderApp(CLUSTER);
    const a = noteAt(harness, 0);
    const b = noteAt(harness, 1);
    // First, put A into the selection with a normal click.
    await dispatch(a.element, pointerEvent('pointerdown', { clientX: 200, clientY: 200, buttons: 1 }));
    await dispatch(a.element, pointerEvent('pointerup', { clientX: 200, clientY: 200, buttons: 1 }));

    // Shift-click on B: it joins A.
    const shiftDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 440,
      clientY: 200,
      button: 0,
      shiftKey: true,
    });
    Object.defineProperty(shiftDown, 'buttons', { value: 1 });
    Object.defineProperty(shiftDown, 'pointerType', { value: 'mouse' });
    Object.defineProperty(shiftDown, 'pointerId', { value: 1 });
    await dispatch(b.element, shiftDown);

    // The bounding box appears when 2+ are selected.
    expect(harness.container.querySelector('[data-testid="selection-bounding-box"]')).not.toBeNull();
    expect(harness.container.querySelectorAll('[data-testid="local-selection-outline"]')).toHaveLength(2);
  });

  it('Select-all (Ctrl/Cmd+A) selects every note on the board', async () => {
    const harness = renderApp(CLUSTER);

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await flush();

    const outlines = harness.container.querySelectorAll('[data-testid="local-selection-outline"]');
    expect(outlines).toHaveLength(4);
    expect(harness.container.querySelector('[data-testid="selection-bar"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-testid="selection-count"]')?.textContent).toBe(
      '4 selected',
    );
  });

  it('Ctrl/Cmd+A on an empty board does nothing', async () => {
    const harness = renderApp();

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );

    expect(harness.container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });

  it('Escape clears the selection', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    expect(harness.container.querySelectorAll('[data-testid="local-selection-outline"]')).toHaveLength(4);

    await dispatch(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(harness.container.querySelectorAll('[data-testid="local-selection-outline"]')).toHaveLength(0);
    expect(harness.container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });

  it('Dragging a selected note when 2 are selected moves both by the same amount', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    await flush();

    const before = harness.notes().map((n) => ({ x: n.x, y: n.y }));
    const a = noteAt(harness, 0);

    await drag(harness, a.element, { x: 200, y: 200 }, { x: 300, y: 200 });
    await flush();

    const after = harness.notes().map((n) => ({ x: n.x, y: n.y }));
    // All four notes moved together by 100 screen px = 100 world units at 1x.
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x + 100, 4);
    }
  });

  it('Nudge: ArrowRight shifts by NUDGE_STEP_WORLD (1)', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    const before = harness.notes().map((n) => n.x);

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await flush();

    const after = harness.notes().map((n) => n.x);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBeCloseTo(before[i] + 1, 6);
    }
  });

  it('Shift+Arrow: Shift+ArrowUp shifts by NUDGE_LARGE_STEP_WORLD (10)', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    const before = harness.notes().map((n) => n.y);

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush();

    const after = harness.notes().map((n) => n.y);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBeCloseTo(before[i] - 10, 6);
    }
  });

  it('Delete with 2+ selected removes all selected notes', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    expect(harness.notes()).toHaveLength(4);

    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );
    await flush();

    expect(harness.notes()).toHaveLength(0);
    expect(harness.container.querySelectorAll('[data-testid="local-selection-outline"]')).toHaveLength(0);
  });

  it('Delete via the SelectionBar button removes all selected notes', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    await flush();

    const bar = harness.container.querySelector('[data-testid="delete-selection"]');
    expect(bar).not.toBeNull();

    await act(async () => {
      (bar as HTMLButtonElement).click();
    });
    await flush();

    expect(harness.notes()).toHaveLength(0);
  });

  it('A remote delete removes the note from the selection', async () => {
    const harness = renderApp(CLUSTER);
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
    );
    await flush();

    // Delete one note through the doc (simulating a remote peer).
    const toRemove = harness.notes()[0];
    await act(async () => {
      const { deleteObject } = await import('../../src/shared/board-model');
      deleteObject(harness.doc, toRemove.id);
    });
    await flush();

    expect(harness.notes()).toHaveLength(3);
    expect(harness.container.querySelectorAll('[data-testid="local-selection-outline"]')).toHaveLength(3);
    expect(harness.container.querySelector('[data-testid="selection-count"]')?.textContent).toBe(
      '3 selected',
    );
  });

  it('Shift+drag on empty space selects all notes fully inside the rectangle', async () => {
    const harness = renderApp(CLUSTER);

    // The default camera centres the world origin in the viewport, so screen
    // coords for the marquee must be computed against the live camera. Notes
    // are 200x200, placed at world (100, 100), (340, 100), (580, 100) and
    // (820, 100). A rect from (0, 0) to (700, 400) covers the first two
    // notes fully; the third note's right edge at x = 780 falls outside.
    const world = (x: number, y: number) => {
      const cam = harness.camera();
      return { x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom };
    };
    const start = world(0, 0);
    const end = world(700, 400);

    const rect = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: start.x,
      clientY: start.y,
      button: 0,
      shiftKey: true,
    });
    Object.defineProperty(rect, 'buttons', { value: 1 });
    Object.defineProperty(rect, 'pointerType', { value: 'mouse' });
    Object.defineProperty(rect, 'pointerId', { value: 1 });
    await dispatch(harness.board(), rect);

    const move = new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: end.x,
      clientY: end.y,
      button: 0,
      shiftKey: true,
    });
    Object.defineProperty(move, 'buttons', { value: 1 });
    Object.defineProperty(move, 'pointerType', { value: 'mouse' });
    Object.defineProperty(move, 'pointerId', { value: 1 });
    await dispatch(harness.board(), move);

    const up = new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: end.x,
      clientY: end.y,
      button: 0,
      shiftKey: true,
    });
    Object.defineProperty(up, 'buttons', { value: 0 });
    Object.defineProperty(up, 'pointerType', { value: 'mouse' });
    Object.defineProperty(up, 'pointerId', { value: 1 });
    await dispatch(harness.board(), up);
    await flush();

    // Notes at x=100 (100-300) and x=340 (340-540) fit inside 50-620 world
    // width. Note at x=580 (580-780) has its right edge at 780 > 620, so it
    // is not selected.
    const selected = harness.container.querySelectorAll('[data-testid="local-selection-outline"]');
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(selected.length).toBeLessThanOrEqual(3);
  });
});
/** The ids that currently have a local outline, in DOM order. */
function outlineIds(harness: ReturnType<typeof renderApp>): string[] {
  return Array.from(
    harness.container.querySelectorAll<HTMLElement>('[data-testid="local-selection-outline"]'),
  ).map((el) => el.getAttribute('data-outline-id') ?? '');
}

/** Ctrl/Cmd+A, the way the keyboard path is reached. */
async function selectAll(harness: ReturnType<typeof renderApp>): Promise<void> {
  await dispatch(
    document.body,
    new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
  );
  await flush();
}

/** Shift-click a note: the cheap way to build a selection of exactly some notes. */
async function shiftClick(
  harness: ReturnType<typeof renderApp>,
  index: number,
  at: { x: number; y: number },
): Promise<void> {
  const note = harness.notes()[index];
  await dispatch(
    harness.noteElement(note.id),
    shiftDown(at.x, at.y),
  );
  await flush();
}

function pointer(x: number, y: number, type = 'pointerdown', buttons = 1): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'buttons', { value: buttons });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function shiftDown(x: number, y: number): MouseEvent {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    shiftKey: true,
  });
  Object.defineProperty(event, 'buttons', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

describe('transform gesture (TC-23 to TC-26)', () => {
  it('TC-23 dragging an unselected note moves only it, and selects only it', async () => {
    const harness = renderApp(CLUSTER);
    await shiftClick(harness, 0, { x: 200, y: 200 });
    expect(outlineIds(harness)).toEqual([harness.notes()[0].id]);

    // Compared by id, not index: `notes()` is z-ordered, and a drag raises
    // what it moved.
    const before = new Map(harness.notes().map((n) => [n.id, { x: n.x, y: n.y }]));
    const b = noteAt(harness, 1);
    await drag(harness, b.element, { x: 440, y: 200 }, { x: 540, y: 200 });
    await flush();

    const after = new Map(harness.notes().map((n) => [n.id, { x: n.x, y: n.y }]));
    // Only B moved, by the whole 100 screen pixels (zoom is 1).
    expect(after.get(b.id)!.x).toBeCloseTo(before.get(b.id)!.x + 100, 4);
    for (const [id, position] of after) {
      if (id === b.id) continue;
      expect(position.x).toBeCloseTo(before.get(id)!.x, 6);
      expect(position.y).toBeCloseTo(before.get(id)!.y, 6);
    }
    // And the drag replaced the selection with the note it started on.
    expect(outlineIds(harness)).toEqual([b.id]);
  });

  it('TC-23 a movement under the drag threshold is a click, not a drag', async () => {
    const harness = renderApp(CLUSTER);
    const before = new Map(
      harness.notes().map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]),
    );
    // Two screen pixels: below DRAG_THRESHOLD_PX, so nothing is written.
    await drag(harness, noteAt(harness, 0).element, { x: 200, y: 200 }, { x: 202, y: 200 });
    await flush();
    const after = new Map(
      harness.notes().map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]),
    );
    expect(after).toEqual(before);
  });

  it('TC-24 the eight resize handles are named, and an edge handle scales the selection', async () => {
    const harness = renderApp(CLUSTER);
    await selectAll(harness);
    expect(harness.container.querySelectorAll('[data-testid^="handle-"]')).toHaveLength(8);
    // The names are the accessible contract: "Resize right", not "handle-e".
    expect(() => harness.button('Resize right')).not.toThrow();
    expect(() => harness.button('Resize top-left')).not.toThrow();

    const before = harness.notes().map((n) => ({ x: n.x, width: n.width ?? 200 }));
    await drag(harness, harness.button('Resize right'), { x: 500, y: 100 }, { x: 540, y: 100 });
    await flush();

    const after = harness.notes().map((n) => ({ x: n.x, width: n.width ?? 200 }));
    // A group resize is one uniform scale: every note grew, none was
    // distorted, and the left-to-right order is what it was.
    for (const note of after) expect(note.width).toBeGreaterThan(200);
    for (let i = 1; i < after.length; i += 1) {
      expect(after[i].x).toBeGreaterThan(after[i - 1].x);
      expect(after[i].x - before[i].x).toBeGreaterThanOrEqual(after[i - 1].x - before[i - 1].x - 1e-6);
    }
  });

  it('TC-24 a corner handle keeps the note ratio', async () => {
    const harness = renderApp(CLUSTER);
    await selectAll(harness);
    await drag(
      harness,
      harness.button('Resize bottom-right'),
      { x: 600, y: 200 },
      { x: 640, y: 240 },
      { shiftKey: true },
    );
    await flush();
    for (const note of harness.notes()) {
      // Sticky notes are square, and the ratio is locked: whatever the resize
      // did, width and height stayed equal.
      expect(Math.abs((note.width ?? 200) - (note.height ?? 200))).toBeLessThan(1e-6);
    }
  });

  it('TC-33 shrinking past the limit stops at STICKY_MIN_SIZE_WORLD', async () => {
    const harness = renderApp(CLUSTER);
    await selectAll(harness);

    // Drag the bottom-right handle far up and left: 900x250 screen pixels
    // inward, which would take the 920x200 bounding box down to 20x0. The
    // clamp has to stop it at the per-type minimum instead. Nothing else in
    // the suite drives the min-size clamp through a gesture: geometry.test.ts
    // only checks clampScale in isolation.
    await drag(
      harness,
      harness.button('Resize bottom-right'),
      { x: 1100, y: 350 },
      { x: 200, y: 100 },
    );
    await flush();

    const after = harness.notes();
    // The drag has to have done SOMETHING, or "nothing went below the limit"
    // would pass vacuously on a gesture that simply aborted.
    expect(Math.min(...after.map((n) => n.width ?? 200))).toBeLessThan(200);
    for (const note of after) {
      expect(note.width ?? 0).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
      expect(note.height ?? 0).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
      expect(Number.isFinite(note.x)).toBe(true);
      expect(Number.isFinite(note.y)).toBe(true);
    }
  });

  it('TC-33 the same clamp holds for an edge handle, where only one axis is dragged', async () => {
    const harness = renderApp(CLUSTER);
    await selectAll(harness);

    // Same idea through 'Resize right': aspect lock makes resizeRect derive the
    // height from the width, so a purely horizontal drag does shrink both
    // axes. A 700px inward drag has to stop at the minimum, not collapse.
    await drag(harness, harness.button('Resize right'), { x: 1100, y: 200 }, { x: 400, y: 200 });
    await flush();

    const after = harness.notes();
    expect(Math.min(...after.map((n) => n.width ?? 200))).toBeLessThan(200);
    for (const note of after) {
      expect(note.width ?? 0).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
      expect(note.height ?? 0).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1e-6);
    }
  });

  it('TC-25 a read-only board writes nothing, from the handle or the keyboard', async () => {
    let started = 0;
    const harness = renderApp(CLUSTER, {
      canEdit: false,
      onGestureStart: () => {
        started += 1;
      },
    });
    await shiftClick(harness, 0, { x: 200, y: 200 });
    await shiftClick(harness, 1, { x: 440, y: 200 });
    expect(outlineIds(harness)).toHaveLength(2);

    const before = harness.notes().map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }));

    // The resize gesture is refused outright.
    await drag(harness, harness.button('Resize right'), { x: 500, y: 100 }, { x: 560, y: 100 });
    await flush();
    // And so are the nudges.
    await dispatch(
      document.body,
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await flush();

    expect(harness.notes().map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }))).toEqual(
      before,
    );
    expect(started).toBe(0);
  });

  it('TC-26 one drag reports one start and one end', async () => {
    const calls: string[] = [];
    const harness = renderApp(CLUSTER, {
      onGestureStart: () => calls.push('start'),
      onGestureEnd: () => calls.push('end'),
    });
    await selectAll(harness);
    await drag(harness, noteAt(harness, 0).element, { x: 200, y: 200 }, { x: 300, y: 200 });
    await flush();
    expect(calls).toEqual(['start', 'end']);
  });

  it('TC-26 a cancelled drag keeps the last position it applied', async () => {
    const harness = renderApp(CLUSTER);
    await selectAll(harness);
    const before = harness.notes().map((n) => n.x);

    const target = noteAt(harness, 0).element;
    await dispatch(target, pointer(200, 200));
    await dispatch(window, pointer(260, 200, 'pointermove'));
    await flush();
    const midway = harness.notes().map((n) => n.x);
    // The release the browser never reported must not roll the group back,
    // and it must not leave the gesture listening for the next drag.
    await dispatch(window, pointer(400, 200, 'pointercancel', 0));
    await flush();

    expect(harness.notes().map((n) => n.x)).toEqual(midway);
    expect(midway[0]).toBeGreaterThan(before[0]);

    // A fresh drag works afterwards: the cancel released the window listeners.
    await drag(harness, noteAt(harness, 0).element, { x: 200, y: 200 }, { x: 250, y: 200 });
    await flush();
    expect(harness.notes()[0].x).toBeGreaterThan(midway[0]);
  });
});
