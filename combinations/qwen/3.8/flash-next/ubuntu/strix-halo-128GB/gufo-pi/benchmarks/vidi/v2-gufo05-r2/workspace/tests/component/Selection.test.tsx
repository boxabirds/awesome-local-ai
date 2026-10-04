/**
 * Component: selecting, moving and resizing several objects at once.
 *
 * A real `Y.Doc` and the stand-in room from `setup.ts`, and a second object type
 * (`tests/fixtures/testbox.tsx`) whose registry declarations differ from a sticky
 * note's on purpose: story 7 promises the same selection, moving, resizing and
 * deleting for every type, and that promise is only tested if something other than
 * a sticky note goes through the path.
 *
 * Positions are given in board units, so a rectangle that contains a note contains
 * it at any zoom, and the containment rule under test is the model's own
 * (`objectsInRect`) rather than one the test invented.
 */

import * as Y from 'yjs';
import { act, render, screen } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { initDoc, objectBounds, objectSnapshots, snapshot } from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import {
  boxesOf,
  boxOf,
  centreOf,
  clickObject,
  deleteRemotely,
  dragMarquee,
  dragWorld,
  fireKey,
  firePointer,
  flushFrames,
  handleEl,
  objectsOf,
  objectEl,
  overlayEl,
  overlayRect,
  renderSelection,
  selectionBar,
  selectionIds,
  seedBox,
  seedNote,
  surface,
  toScreen,
} from './selectionHarness';
import { standInRoom } from './standInRoom';

const NOTE = STICKY_SIZE_WORLD;

/** Two notes side by side with a gap: a and b at (0,0) and (300,0). */
function twoNotes(doc: Y.Doc): [string, string] {
  const a = seedNote(doc, { x: 0, y: 0 });
  const b = seedNote(doc, { x: NOTE + 100, y: 0 });
  return [a, b];
}

describe('sel.interaction — the selection and its bar', () => {
  it('TC-16: everything selected is deleted elsewhere, so the selection empties', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);
    clickObject(b, { shift: true });
    expect(selectionIds()).toEqual([a, b].sort());
    expect(selectionBar()).not.toBeNull();
    expect(overlayEl()).not.toBeNull();

    deleteRemotely(doc, [a, b]);

    expect(selectionIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(overlayEl()).toBeNull();
  });

  it('TC-17: two selected objects get one bar, and the count is announced', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);
    clickObject(b, { shift: true });

    const bar = selectionBar();
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-selection-count')).toBe('2');
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    // Assistive tech is told the size of the selection; the outline says nothing to it.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('2 selected');

    // Deleting the selection removes both, and nothing is left selected.
    act(() => {
      (screen.getByRole('button', { name: 'Delete selection' }) as HTMLButtonElement).click();
    });
    flushFrames();
    expect(objectsOf(doc)).toHaveLength(0);
    expect(selectionIds()).toEqual([]);
  });

  it('TC-18: one sticky note still gets the note toolbar, not the group bar', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    clickObject(a);

    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pink colour' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
    expect(screen.getByTestId('selection-bar').getAttribute('data-selection-count')).toBe('1');
    // The outline is still the shared one, around exactly that note.
    expect(overlayRect()).toEqual(boxOf(doc, a));

    // A second object of any kind switches the bar over, and the toolbar goes.
    const box = seedBox(doc, { x: 0, y: NOTE + 100, width: 120, height: 90 });
    clickObject(box, { shift: true });
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(screen.getByTestId('selection-count').textContent).toBe('2 selected');
  });

  it('TC-19: a click on empty board space clears the selection', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);
    clickObject(b, { shift: true });
    expect(selectionIds()).toHaveLength(2);

    const at = { x: 2000, y: 2000 };
    firePointer(surface(), 'pointerdown', at.x, at.y);
    firePointer(surface(), 'pointerup', at.x, at.y);
    flushFrames();

    expect(selectionIds()).toEqual([]);
    expect(overlayEl()).toBeNull();
    expect(selectionBar()).toBeNull();
  });
});

describe('sel.marquee_ui — shift + drag selection', () => {
  it('TC-20: a marquee adds the objects fully inside it, keeping what was selected', () => {
    const doc = renderSelection();
    // x sits away from the marquee; a is inside it; b sticks out of it; c is elsewhere.
    const x = seedNote(doc, { x: 0, y: 1000 });
    const a = seedNote(doc, { x: 0, y: 0 });
    const b = seedNote(doc, { x: 250, y: 0 });
    const c = seedNote(doc, { x: 2000, y: 2000 });
    clickObject(x);
    expect(selectionIds()).toEqual([x]);

    // From the top-left of a to a point that leaves b partly outside (b spans
    // 250..450 horizontally, so the rectangle stops at world x 400).
    dragMarquee({ x: -50, y: -50 }, { x: 400, y: NOTE + 50 });

    // b lies partly inside the rectangle and c not at all: neither is selected.
    expect(selectionIds()).not.toContain(b);
    expect(selectionIds()).not.toContain(c);
    expect(selectionIds()).toEqual([a, x].sort());
    expect(screen.queryByTestId('marquee')).toBeNull();
    // Nothing moved: a marquee selects, it never changes the board.
    expect(boxOf(doc, a)).toEqual({ x: 0, y: 0, width: NOTE, height: NOTE });
    expect(boxOf(doc, c)).toEqual({ x: 2000, y: 2000, width: NOTE, height: NOTE });
  });

  it('TC-21: a plain drag on empty space pans the board and selects nothing', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    clickObject(a);
    const before = selectionIds();

    const from = { x: 3000, y: 3000 };
    const to = { x: 2900, y: 3000 };
    dragWorld(surface(), from, to);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectionIds()).toEqual(before);
    // The board moved instead: panning is what a plain drag means.
    const moved = toScreen(from);
    expect(moved.x).toBeGreaterThan(toScreen(to).x);
  });

  it('TC-22: a marquee that is cancelled selects nothing new', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    clickObject(a);

    dragMarquee({ x: -50, y: -50 }, { x: 500, y: NOTE + 50 }, { release: false });
    expect(screen.getByTestId('marquee')).toBeTruthy();
    firePointer(surface(), 'pointercancel', 500, NOTE + 50);
    flushFrames();

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectionIds()).toEqual([a]);
  });
});

describe('sel.transform — moving and resizing a group', () => {
  it('TC-23: dragging an unselected object moves it alone and selects it', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);
    expect(selectionIds()).toEqual([a]);

    dragWorld(objectEl(b), centreOf(boxOf(doc, b)), {
      x: centreOf(boxOf(doc, b)).x + 40,
      y: centreOf(boxOf(doc, b)).y + 20,
    });

    expect(selectionIds()).toEqual([b]);
    expect(boxOf(doc, b)).toEqual({ x: NOTE + 140, y: 20, width: NOTE, height: NOTE });
    expect(boxOf(doc, a)).toEqual({ x: 0, y: 0, width: NOTE, height: NOTE });
  });

  it('TC-23: a movement under the threshold is a click, exactly on it is a drag', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);

    // One less pixel than the threshold: no write at all, and it selects b.
    const bStart = centreOf(boxOf(doc, b));
    dragWorld(objectEl(b), bStart, { x: bStart.x + DRAG_THRESHOLD_PX - 1, y: bStart.y });
    expect(boxOf(doc, b)).toEqual({ x: NOTE + 100, y: 0, width: NOTE, height: NOTE });
    expect(selectionIds()).toEqual([b]);

    // Exactly the threshold: the gesture runs and the object moves.
    clickObject(a);
    const from = centreOf(boxOf(doc, b));
    dragWorld(objectEl(b), from, { x: from.x + DRAG_THRESHOLD_PX, y: from.y });
    expect(boxOf(doc, b).x).toBe(NOTE + 100 + DRAG_THRESHOLD_PX);
  });

  it('TC-23: dragging one of two selected objects moves both by the same amount', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    const c = seedNote(doc, { x: 0, y: NOTE + 300 });
    clickObject(a);
    clickObject(b, { shift: true });

    const before = { a: boxOf(doc, a), b: boxOf(doc, b) };
    dragWorld(objectEl(a), centreOf(before.a), {
      x: centreOf(before.a).x + 70,
      y: centreOf(before.a).y - 35,
    });

    expect(boxOf(doc, a)).toEqual({ ...before.a, x: before.a.x + 70, y: before.a.y - 35 });
    expect(boxOf(doc, b)).toEqual({ ...before.b, x: before.b.x + 70, y: before.b.y - 35 });
    // The whole group is raised above everything else, order inside it kept.
    const after = objectsOf(doc);
    const z = (id: string) => after.find((o) => o.id === id)!.z;
    expect(z(a)).toBeGreaterThan(z(c));
    expect(z(b)).toBeGreaterThan(z(c));
    expect(z(a)).toBeLessThan(z(b));
  });

  it('TC-24: an edge handle changes one axis; shift keeps the proportions', () => {
    const doc = renderSelection();
    const wide = seedBox(doc, { x: 0, y: 0, width: 300, height: 100 });
    const tall = seedBox(doc, { x: 0, y: 200, width: 100, height: 300 });
    clickObject(wide);
    clickObject(tall, { shift: true });
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(8);
    expect(handleEl('e')!.getAttribute('aria-label')).toBe('Resize right');
    expect(handleEl('nw')!.getAttribute('aria-label')).toBe('Resize top-left');

    // Right edge: width only. The testbox type does not lock its proportions, and
    // every object is scaled about the group's box, so both grow wider by 20% and
    // neither changes height.
    const group = union(boxOf(doc, wide), boxOf(doc, tall));
    expect(group).toEqual({ x: 0, y: 0, width: 300, height: 500 });
    dragWorld(
      handleEl('e')!,
      { x: group.x + group.width, y: group.y + group.height / 2 },
      { x: group.x + group.width + 60, y: group.y + group.height / 2 },
    );
    expect(boxesOf(doc, [wide, tall])).toEqual({
      [wide]: { x: 0, y: 0, width: 360, height: 100 },
      [tall]: { x: 0, y: 200, width: 120, height: 300 },
    });

    // Shift with a free-proportion type asks for the locked ratio instead: the
    // pointer moves 100 across and 10 down, and the wider deviation drives both.
    const beforeWide = boxOf(doc, wide);
    const beforeTall = boxOf(doc, tall);
    const grown = union(beforeWide, beforeTall);
    dragWorld(
      handleEl('se')!,
      { x: grown.x + grown.width, y: grown.y + grown.height },
      { x: grown.x + grown.width + 100, y: grown.y + grown.height + 10 },
      { modifiers: { shift: true } },
    );
    const afterWide = boxOf(doc, wide);
    const afterTall = boxOf(doc, tall);
    const scale = (grown.width + 100) / grown.width;
    expect(afterWide.width).toBe(Math.round(beforeWide.width * scale));
    expect(afterWide.height).toBe(Math.round(beforeWide.height * scale));
    expect(afterTall.width).toBe(Math.round(beforeTall.width * scale));
    expect(afterTall.height).toBe(Math.round(beforeTall.height * scale));
    // The gap between them grew by the same factor, so the layout is a scaled
    // picture of itself rather than two objects that drifted apart.
    const gapBefore = beforeTall.y - (beforeWide.y + beforeWide.height);
    const gapAfter = afterTall.y - (afterWide.y + afterWide.height);
    expect(gapAfter).toBeCloseTo(gapBefore * scale, 0);
    expect(tall).toBeTruthy();
  });

  it('TC-24: resizing stops as soon as the first object reaches its limit', () => {
    const doc = renderSelection();
    // The sticky may shrink to 50; the box may shrink to 10. Growing the group can
    // only stop when the *first* of them hits a limit, with one scale for both.
    const note = seedNote(doc, { x: 0, y: 0 });
    const box = seedBox(doc, { x: 0, y: NOTE + 20, width: 40, height: 40 });
    clickObject(note);
    clickObject(box, { shift: true });
    const group = union(boxOf(doc, note), boxOf(doc, box));
    const corner = { x: group.x + group.width, y: group.y + group.height };

    dragWorld(handleEl('se')!, corner, { x: corner.x + 4000, y: corner.y + 4000 });
    const noteBox = boxOf(doc, note);
    const boxBox = boxOf(doc, box);
    // One scale for the whole selection: both grew by the same factor.
    expect(noteBox.width / NOTE).toBeCloseTo(boxBox.width / 40, 5);
    // ...and that factor is the largest that keeps every object inside the limits.
    expect(noteBox.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    expect(boxBox.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    const scale = noteBox.width / NOTE;
    const larger = union(boxOf(doc, note), boxOf(doc, box));
    expect(larger.width / group.width).toBeCloseTo(scale, 3);
  });

  it('TC-24: a single sticky note resizes as a square, and stops at its minimum', () => {
    const doc = renderSelection();
    const id = seedNote(doc, { x: 0, y: 0 });
    clickObject(id);
    const box = boxOf(doc, id);
    const corner = { x: box.x + box.width, y: box.y + box.height };

    // A sticky note locks its proportions on its own: pull the corner, stay square.
    dragWorld(handleEl('se')!, corner, { x: corner.x + 120, y: corner.y + 5 });
    let now = boxOf(doc, id);
    expect(now.width).toBe(now.height);
    expect(now.width).toBeGreaterThan(box.width);

    // Shrinking stops at the type's minimum, however far the pointer goes.
    dragWorld(handleEl('se')!, { x: now.x + now.width, y: now.y + now.height }, {
      x: now.x - 4000,
      y: now.y - 4000,
    });
    now = boxOf(doc, id);
    expect(now.width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(now.height).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-24: no handles when a selected type cannot be resized', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    const id = seedBox(doc, { x: 0, y: 600, width: 80, height: 80 });
    clickObject(id);
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(8);

    // The same object, now of a type that says it cannot be resized: the handles go.
    rewriteType(doc, id, FLAT_TYPE);
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(0);
    // It is still selected, still outlined, and still deletable.
    expect(overlayEl()).not.toBeNull();
    expect(selectionIds()).toEqual([id]);

    // A mixed selection loses them too: a handle that does nothing is worse than none.
    clickObject(a, { shift: true });
    expect(selectionIds()).toEqual([a, id].sort());
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(0);
  });

  it('TC-25: while the board could not be loaded, no gesture writes anything', async () => {
    const doc = renderSelection();
    await act(async () => {});
    const [a, b] = twoNotes(doc);
    clickObject(a);
    clickObject(b, { shift: true });
    act(() => standInRoom.refuseConnections(CLOSE_BOARD_LOAD_FAILED, 'could not read it'));
    await act(async () => {});

    const untouched = JSON.stringify(objectsOf(doc));
    dragWorld(objectEl(a), centreOf(boxOf(doc, a)), { x: 900, y: 700 });
    expect(JSON.stringify(objectsOf(doc))).toBe(untouched);

    // The keyboard is the same story.
    expect(fireKey('ArrowRight').defaultPrevented).toBe(true);
    expect(JSON.stringify(objectsOf(doc))).toBe(untouched);
    expect(fireKey('Delete').defaultPrevented).toBe(true);
    expect(JSON.stringify(objectsOf(doc))).toBe(untouched);
  });

  it('TC-26: gesture callbacks fire once, and a cancelled drag keeps its positions', () => {
    // A board of its own, with the gesture hook mounted on its own: `onGestureStart`
    // and `onGestureEnd` are the hook's promise to story 8 (pause presence while a
    // person drags), and nothing on the board page can stand in for counting them.
    const doc = new Y.Doc();
    initDoc(doc);
    const id = seedNote(doc, { x: 0, y: 0 });
    const starts: number[] = [];
    const ends: number[] = [];
    renderProbe(doc, [id], starts, ends);

    dragWorld(objectEl(id), centreOf(boxOf(doc, id)), { x: 300, y: 100 });
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    const moved = boxOf(doc, id);
    expect(moved.x).toBeGreaterThan(0);

    // Cancelled halfway: the last written position stands, and no write follows.
    dragWorld(objectEl(id), centreOf(moved), { x: 900, y: 400 }, { release: false });
    const held = boxOf(doc, id);
    expect(held.x).toBeGreaterThan(moved.x);
    firePointer(objectEl(id), 'pointercancel', 400, 400);
    flushFrames();
    expect(boxOf(doc, id)).toEqual(held);
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
  });
});

describe('sel.keyboard — commands on the whole selection', () => {
  it('TC-27: ctrl-A selects every object on the board', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    const box = seedBox(doc, { x: 800, y: 0, width: 40, height: 40 });

    const event = fireKey('a', { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    expect(selectionIds()).toEqual([a, b, box].sort());
    expect(window.getSelection()?.toString()).toBe('');

    // cmd on a Mac keyboard does the same thing.
    fireKey('a', { ctrl: true });
    expect(fireKey('a', { meta: true }).defaultPrevented).toBe(true);
    expect(selectionIds()).toEqual([a, b, box].sort());
  });

  it('TC-28: ctrl-A on an empty board selects nothing and harms nothing', () => {
    renderSelection();
    const event = fireKey('a', { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    expect(selectionIds()).toEqual([]);
    expect(overlayEl()).toBeNull();
    expect(selectionBar()).toBeNull();
  });

  it('TC-29: arrows nudge the selection by the set steps, without scrolling the page', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    clickObject(a);
    clickObject(b, { shift: true });
    const before = { a: boxOf(doc, a), b: boxOf(doc, b) };

    expect(fireKey('ArrowRight').defaultPrevented).toBe(true);
    flushFrames();
    expect(boxOf(doc, a).x).toBe(before.a.x + NUDGE_STEP_WORLD);
    expect(boxOf(doc, b).x).toBe(before.b.x + NUDGE_STEP_WORLD);

    expect(fireKey('ArrowUp', { shift: true }).defaultPrevented).toBe(true);
    flushFrames();
    expect(boxOf(doc, a).y).toBe(before.a.y - NUDGE_LARGE_STEP_WORLD);
    expect(boxOf(doc, b).y).toBe(before.b.y - NUDGE_LARGE_STEP_WORLD);
    // Widths and heights are untouched: a nudge is a move.
    expect(boxOf(doc, a).width).toBe(NOTE);
  });

  it('TC-29: an arrow with nothing selected does nothing', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    const before = boxOf(doc, a);
    fireKey('ArrowRight');
    flushFrames();
    expect(boxOf(doc, a)).toEqual(before);
  });

  it('TC-30: backspace while typing edits the text and keeps the objects', () => {
    const doc = renderSelection();
    const id = seedNote(doc, { x: 0, y: 0 });
    // Open the note and put text in it, the way a double-click and typing do.
    act(() => {
      objectEl(id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    flushFrames();
    const editor = objectEl(id).querySelector('textarea');
    expect(editor).not.toBeNull();
    const text = snapshot(doc)[0]!.text;
    act(() => {
      getStickyTextFor(doc, id)?.insert(0, 'keep me');
    });
    flushFrames();
    expect(snapshot(doc)[0]!.text).toBe(`${text}keep me`);

    // Backspace inside the editor is for the text, never for the object.
    const event = fireKeyOn(editor!, 'Backspace');
    expect(event.defaultPrevented).toBe(false);
    expect(objectsOf(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.text).toBe('keep me');

    // Escape, pressed where the typing is, leaves the text; the note stays selected.
    fireKeyOn(editor!, 'Escape');
    flushFrames();
    expect(objectEl(id).querySelector('textarea')).toBeNull();
    expect(selectionIds()).toEqual([id]);
  });

  it('TC-31: delete removes the whole selection and empties it', () => {
    const doc = renderSelection();
    const [a, b] = twoNotes(doc);
    const box = seedBox(doc, { x: 900, y: 900, width: 50, height: 50 });
    clickObject(a);
    clickObject(box, { shift: true });
    const kept = b;

    expect(fireKey('Delete').defaultPrevented).toBe(true);
    flushFrames();
    expect(objectsOf(doc).map((o) => o.id)).toEqual([kept]);
    expect(selectionIds()).toEqual([]);
    expect(overlayEl()).toBeNull();
  });

  it('TC-31: enter opens the text of a single selected sticky, and nothing else', () => {
    const doc = renderSelection();
    const [a] = twoNotes(doc);
    const box = seedBox(doc, { x: 900, y: 900, width: 50, height: 50 });
    clickObject(a);
    expect(fireKey('Enter').defaultPrevented).toBe(true);
    flushFrames();
    expect(objectEl(a).querySelector('textarea')).not.toBeNull();

    clickObject(box);
    expect(fireKey('Enter').defaultPrevented).toBe(false);
    flushFrames();
    expect(document.querySelector('textarea')).toBeNull();

    // Two objects selected: there is no single thing to type into.
    clickObject(a);
    clickObject(box, { shift: true });
    expect(fireKey('Enter').defaultPrevented).toBe(false);
  });
});

/** ------------------------------------------------------------------ **/

/** The union of two boxes, as the selection draws it. */
function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** A keydown on one element (it reaches the window handler by bubbling). */
function fireKeyOn(el: Element, key: string): Event {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function getStickyTextFor(doc: Y.Doc, id: string) {
  const entry = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return entry?.get('text') as Y.Text | undefined;
}

/**
 * A type that declares itself unresizable, under a name no product story uses. The
 * overlay must take the handles away for it — and from a mixed selection that
 * includes it — without anything else about the selection changing.
 */
const FLAT_TYPE = 'unresizable-test-type';
if (!getObjectType(FLAT_TYPE)) {
  registerObjectType(FLAT_TYPE, {
    Component: () => null,
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest: () => false,
  });
}

/** Change what an object is, the way an object written by another client arrives. */
function rewriteType(doc: Y.Doc, id: string, type: string): void {
  act(() => {
    doc.getMap<Y.Map<unknown>>('objects').get(id)?.set('type', type);
  });
  flushFrames();
}

/** A probe component: the gesture hook on its own, with the callbacks counted. */
function renderProbe(doc: Y.Doc, ids: string[], starts: number[], ends: number[]) {
  const objects = objectSnapshots(doc);
  function Probe() {
    const camera = useRef({ x: 0, y: 0, zoom: 1 }).current;
    const click = useCallback(() => {}, []);
    const gestures = useTransformGesture({
      doc,
      editable: true,
      camera,
      objects,
      selectedIds: new Set(ids),
      click,
      toggle: click,
      onGestureStart: () => starts.push(1),
      onGestureEnd: () => ends.push(1),
    });
    const box = objectBounds(objects.find((o) => o.id === ids[0])!);
    return (
      <div
        data-object-id={ids[0]}
        style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height }}
        onPointerDown={(event) => gestures.onObjectPointerDown(event, ids[0]!)}
      />
    );
  }
  render(<Probe />);
}
