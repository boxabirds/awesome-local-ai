// Selecting several objects at once (`sel.interaction`, `sel.marquee_ui`,
// `sel.transform`, `sel.keyboard`) — the component half of story 7.
//
// Everything here runs against the real `<Board>`: the point of the story is that
// click, shift-click, marquee, select-all, the arrows and the bar are six roads to
// one selection, so the tests drive the screen and read the document back, rather
// than calling the reducer. The one thing they cannot see is the gesture's own
// start/end callbacks, which is what `TransformGesture.test.tsx` is for.
//
// Camera: the viewport starts with the world origin at the centre of the window
// (`resetCamera`), at zoom 1, so a world point and its screen point differ by a
// constant — but the helpers below ask the camera rather than assume it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  snapshot,
  snapshotObjects,
} from '../../src/shared/board-model';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { worldToScreen } from '../../src/client/canvas/camera';
import { ResizeObserverStub } from './setup';
import { dispatchPointer, type PointerType, VIEWPORT } from './helpers/events';
import { FakeWebsocketProvider } from './helpers/fake-provider';
import { createTestbox, registerTestboxType, TESTBOX_TYPE } from '../fixtures/testbox';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'selection-board-under-test';
const HALF = STICKY_SIZE_WORLD / 2;

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const settle = (): void => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

/** The document the board itself made (the fake provider holds a reference to it). */
const doc = (): Y.Doc => FakeWebsocketProvider.last().doc as Y.Doc;

const IDLE_CAMERA: Camera = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 };
const camera = (): Camera => window.__vidi6?.getCamera() ?? IDLE_CAMERA;
const screenOfPoint = (world: Point): Point => worldToScreen(camera(), world);

// --- driving the board -------------------------------------------------------

const press = (element: Element, at: Point, shift = false): Event =>
  dispatchPointer(element, 'pointerdown', at.x, at.y, { shiftKey: shift });

/**
 * Moves and releases for an object drag go to the window: the transform gesture owns
 * a drag once it has started, wherever the pointer ends up (that is what a real drag
 * with pointer capture looks like from the inside).
 */
const moveTo = (at: Point, shift = false): Event =>
  dispatchPointer(window, 'pointermove', at.x, at.y, { shiftKey: shift });

const release = (at: Point): Event => dispatchPointer(window, 'pointerup', at.x, at.y);

/**
 * ... but the board's own surface answers on its own element, like any other widget:
 * panning, the marquee and the click that clears the selection are BoardViewport's.
 */
const on = (element: Element, type: PointerType, at: Point, shift = false): Event =>
  dispatchPointer(element, type, at.x, at.y, { shiftKey: shift });

/** Press and let go again: a click, which selects without moving. */
const click = (element: Element, world: Point, shift = false): void => {
  const at = screenOfPoint(world);
  press(element, at, shift);
  // The board's surface answers its own release; an object's is the window's.
  on(element, 'pointerup', at, shift);
  flush();
};

/** Press, travel, let go: the gesture, in world units from and to. */
const drag = (element: Element, from: Point, to: Point, shift = false): void => {
  const start = screenOfPoint(from);
  press(element, start, shift);
  const end = screenOfPoint(to);
  // Two moves: the first crosses the drag threshold, the second is what lands.
  moveTo({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, shift);
  moveTo(end, shift);
  release(end);
  flush();
};

/** Shift-drag a box over empty board space: a marquee. */
const marquee = (from: Point, to: Point, cancel = false): void => {
  const viewport = screen.getByTestId('board-viewport');
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  on(viewport, 'pointerdown', start, true);
  on(viewport, 'pointermove', { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, true);
  if (cancel) {
    on(viewport, 'pointercancel', end, true);
  } else {
    on(viewport, 'pointermove', end, true);
    on(viewport, 'pointerup', end, true);
  }
  flush();
};

// --- reading the board back --------------------------------------------------

const noteElements = (): HTMLElement[] =>
  screen.queryAllByTestId('sticky-note') as HTMLElement[];

const noteElement = (id: string): HTMLElement => {
  const found = noteElements().find((element) => element.dataset.id === id);
  if (!found) throw new Error(`no note "${id}" on the screen`);
  return found;
};

const selectedIds = (): string[] =>
  noteElements()
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.id as string)
    .sort();

const boxOf = (id: string): Rect => {
  const object = snapshotObjects(doc()).find((candidate) => candidate.id === id);
  if (!object) throw new Error(`"${id}" is not in the document`);
  return objectBounds(object);
};

/** Open the board and let its connection sync, as the story 4 tests do. */
const open = (): void => {
  render(<Board boardId={BOARD_ID} />);
  act(() => {
    FakeWebsocketProvider.last().markSynced();
  });
  flush();
};

/** A note at world `at` (its centre), and on the screen. */
const makeNote = (x: number, y: number): string => {
  let id = '';
  act(() => {
    id = createSticky(doc(), { x, y });
  });
  flush();
  return id;
};

/** The centre of an object, in world units. */
const centre = (id: string): Point => {
  const bounds = boxOf(id);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

const selectAll = (): void => {
  // Ctrl/Cmd+A on the board itself: the body stands for "the page, unfocused".
  fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
  flush();
};

const bar = (): HTMLElement | null => screen.queryByTestId('selection-bar');
const count = (): string | null => screen.queryByTestId('selection-count')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.size = { ...VIEWPORT };
  FakeWebsocketProvider.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('selection bar (sel.interaction)', () => {
  // TC-17: two notes selected — the count, the delete, and a live region that says it.
  it('TC-17 shows "2 selected" and a Delete selection button', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    click(noteElement(a), centre(a));
    click(noteElement(b), centre(b), true);

    expect(selectedIds()).toEqual([a, b].sort());
    expect(count()).toBe('2 selected');
    const button = screen.getByTestId('delete-selection');
    expect(button.getAttribute('aria-label')).toBe('Delete selection');
    expect(screen.getByTestId('selection-count').getAttribute('aria-live')).toBe('polite');
  });

  // TC-18: one sticky note gets the note's own tools instead of a count of one.
  it('TC-18 shows the note toolbar rather than a count for a single note', () => {
    open();
    const a = makeNote(0, 0);
    click(noteElement(a), centre(a));

    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-count')).toBeNull();
    // Still one place to act on the selection: the bar holds the toolbar.
    expect(screen.getByTestId('selection-bar')).toBeTruthy();
  });

  // TC-19: a click on empty board space, with no drag in it, empties the selection.
  it('TC-19 clears the selection on a click of empty space', () => {
    open();
    makeNote(0, 0);
    makeNote(300, 0);
    selectAll();
    expect(count()).toBe('2 selected');

    click(screen.getByTestId('board-viewport'), { x: -600, y: -300 });
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  // TC-16: the other person deletes everything this screen has selected.
  it('TC-16 drops ids from the selection when somebody else deletes them', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    const c = makeNote(600, 0);
    selectAll();
    expect(count()).toBe('3 selected');

    // A second person, in their own copy of the board, deletes two of the three.
    const other = new Y.Doc();
    act(() => {
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc()));
      deleteObjects(other, [a, b]);
      Y.applyUpdate(doc(), Y.encodeStateAsUpdate(other));
    });
    flush();

    expect(selectedIds()).toEqual([c]);
    // One note left in the selection: the bar shows the note's own tools (TC-18).
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    act(() => {
      deleteObjects(other, [c]);
      Y.applyUpdate(doc(), Y.encodeStateAsUpdate(other));
    });
    flush();

    // Empty: not a bar saying zero, and nothing left selected.
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  // TC-31 from the bar as well as from the keyboard: one press deletes the lot.
  it('deletes the whole selection from the bar', () => {
    open();
    makeNote(0, 0);
    makeNote(300, 0);
    selectAll();
    fireEvent.click(screen.getByTestId('delete-selection'));
    flush();

    expect(snapshot(doc())).toHaveLength(0);
    expect(bar()).toBeNull();
  });
});

describe('marquee selection (sel.marquee_ui)', () => {
  // TC-20: a marquee adds to the selection, and only takes what is wholly inside.
  it('TC-20 adds the objects wholly inside the box to the selection', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    // A third note straddles the far edge of the box: half in is not in.
    makeNote(560, 0);
    click(noteElement(a), centre(a));
    expect(selectedIds()).toEqual([a]);

    // Box from (-100,-100) to (500,100): b lies inside it, c starts at 460 and stops
    // at 660, so only its left part is in.
    marquee({ x: -100, y: -100 }, { x: 500, y: 100 });

    expect(selectedIds()).toEqual([a, b].sort());
    expect(screen.queryByTestId('marquee')).toBeNull();
  });

  // TC-21 (negative): without Shift the same drag is the story 1 pan, as it was.
  it('TC-21 pans without Shift and starts no marquee', () => {
    open();
    const a = makeNote(0, 0);
    click(noteElement(a), centre(a));
    const before = camera();

    const viewport = screen.getByTestId('board-viewport');
    on(viewport, 'pointerdown', { x: 200, y: 200 });
    on(viewport, 'pointermove', { x: 300, y: 260 });
    on(viewport, 'pointermove', { x: 400, y: 320 });
    on(viewport, 'pointerup', { x: 400, y: 320 });
    flush();

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(camera().x).not.toBe(before.x);
    // Panning is not a way of changing the selection.
    expect(selectedIds()).toEqual([a]);
    expect(boxOf(a)).toEqual({ x: -HALF, y: -HALF, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  // TC-22: a marquee that is interrupted selects nothing and changes nothing.
  it('TC-22 leaves the selection alone when the marquee is cancelled', () => {
    open();
    const a = makeNote(0, 0);
    click(noteElement(a), centre(a));

    marquee({ x: 100, y: -100 }, { x: 500, y: 100 }, true);

    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([a]);
  });

  it('shows the box while dragging', () => {
    open();
    makeNote(0, 0);
    const viewport = screen.getByTestId('board-viewport');
    const from = screenOfPoint({ x: -200, y: -200 });
    const to = screenOfPoint({ x: 200, y: 200 });
    on(viewport, 'pointerdown', from, true);
    on(viewport, 'pointermove', to, true);
    flush();

    expect(screen.getByTestId('marquee')).toBeTruthy();
    on(viewport, 'pointerup', to, true);
    flush();
  });
});

describe('transform gesture (sel.transform)', () => {
  // TC-23: pressing something outside the selection makes it the whole selection,
  // and moves only it.
  it('TC-23 drags an unselected note without moving the selected one', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    click(noteElement(a), centre(a));
    const aBefore = boxOf(a);

    drag(noteElement(b), centre(b), { x: centre(b).x + 120, y: centre(b).y + 40 });

    const moved = boxOf(b);
    expect(selectedIds()).toEqual([b]);
    expect(moved.x).toBeCloseTo(300 - HALF + 120, 6);
    expect(moved.y).toBeCloseTo(-HALF + 40, 6);
    expect(boxOf(a)).toEqual(aBefore);
  });

  // TC-23's other half: a group moves together, and each note keeps its own place
  // inside the group.
  it('moves every selected note by the same distance', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    selectAll();
    const before = { a: boxOf(a), b: boxOf(b) };

    drag(noteElement(a), centre(a), { x: centre(a).x + 50, y: centre(a).y - 25 });

    expect(boxOf(a).x - before.a.x).toBeCloseTo(50, 6);
    expect(boxOf(b).x - before.b.x).toBeCloseTo(50, 6);
    expect(boxOf(a).y - before.a.y).toBeCloseTo(-25, 6);
    expect(boxOf(b).y - before.b.y).toBeCloseTo(-25, 6);
  });

  // TC-24: a type that does not keep its proportions is resized on one axis only,
  // and Shift holds the proportions anyway.
  it('TC-24 resizes a non-aspect-locked type on one axis, and uniformly with Shift', () => {
    registerTestboxType();
    open();
    let id = '';
    act(() => {
      id = createTestbox(doc(), { x: 0, y: 0, width: 200, height: 100 });
    });
    flush();
    const box = screen.getByTestId('testbox') as HTMLElement;
    click(box, { x: 100, y: 50 });
    expect(screen.getByTestId('testbox').dataset.selected).toBe('true');

    drag(screen.getByLabelText('Resize right'), { x: 200, y: 50 }, { x: 240, y: 50 });
    expect(boxOf(id).width).toBeCloseTo(240, 6);
    expect(boxOf(id).height).toBeCloseTo(100, 6);
    // The left edge is the anchor: the box does not drift, and its middle line stays.
    expect(boxOf(id).x).toBeCloseTo(0, 6);
    expect(boxOf(id).y).toBeCloseTo(0, 6);

    // With Shift the same drag keeps the proportions: 20% wider is 20% taller,
    // even for a type that does not ask for that by itself.
    drag(screen.getByLabelText('Resize right'), { x: 240, y: 50 }, { x: 288, y: 50 }, true);
    expect(boxOf(id).width).toBeCloseTo(288, 6);
    expect(boxOf(id).height).toBeCloseTo(120, 6);
  });

  // TC-25 (negative): a board that could not be read is shown, not edited.
  it('TC-25 refuses the gesture on a board that could not be loaded', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    const before = { a: boxOf(a), b: boxOf(b) };
    act(() => {
      FakeWebsocketProvider.last().markRoomClosed(CLOSE_BOARD_LOAD_FAILED);
    });
    settle();

    selectAll();
    drag(noteElement(a), centre(a), { x: centre(a).x + 100, y: centre(a).y + 60 });

    expect(boxOf(a)).toEqual(before.a);
    expect(boxOf(b)).toEqual(before.b);
    // Nothing to act on either: a board that cannot be edited has no selection.
    expect(bar()).toBeNull();
    expect(count()).toBeNull();
  });
});

describe('keyboard (sel.keyboard)', () => {
  // TC-27: select all, and the page's own text is left alone.
  it('TC-27 selects every object with Ctrl/Cmd+A', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);

    const event = fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    flush();

    expect(selectedIds()).toEqual([a, b].sort());
    expect(event).toBe(false); // preventDefault: no page text gets selected

    const meta = fireEvent.keyDown(document.body, { key: 'a', metaKey: true });
    flush();
    expect(meta).toBe(false);
    expect(count()).toBe('2 selected');
  });

  // TC-28 (boundary): select all on an empty board is Empty, and says nothing.
  it('TC-28 selects nothing at all on an empty board', () => {
    open();
    expect(() => {
      fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
      flush();
    }).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it('Escape empties the selection', () => {
    open();
    makeNote(0, 0);
    makeNote(300, 0);
    selectAll();
    expect(count()).toBe('2 selected');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    flush();
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  // TC-29: the arrows nudge the selection by board units, and scroll nothing.
  it('TC-29 nudges the selection by one unit, and ten with Shift', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    selectAll();
    const before = { a: boxOf(a), b: boxOf(b) };
    const atRest = camera();

    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(false);
    flush();
    expect(boxOf(a).x - before.a.x).toBeCloseTo(NUDGE_STEP_WORLD, 6);
    expect(boxOf(b).x - before.b.x).toBeCloseTo(NUDGE_STEP_WORLD, 6);
    expect(boxOf(a).y).toBeCloseTo(before.a.y, 6);

    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    flush();
    expect(boxOf(a).y - before.a.y).toBeCloseTo(-NUDGE_LARGE_STEP_WORLD, 6);
    expect(boxOf(b).y - before.b.y).toBeCloseTo(-NUDGE_LARGE_STEP_WORLD, 6);

    // The board is where it was: nudging is not panning.
    expect(camera()).toEqual(atRest);
    expect(window.scrollY).toBe(0);
  });

  // TC-31: Delete takes the whole selection, and stops selecting it.
  it('TC-31 deletes everything selected', () => {
    open();
    makeNote(0, 0);
    makeNote(300, 0);
    selectAll();

    expect(fireEvent.keyDown(document.body, { key: 'Delete' })).toBe(false);
    flush();

    expect(snapshot(doc())).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it('Backspace deletes the whole selection too', () => {
    open();
    makeNote(0, 0);
    selectAll();
    expect(fireEvent.keyDown(document.body, { key: 'Backspace' })).toBe(false);
    flush();
    expect(snapshot(doc())).toHaveLength(0);
  });

  // TC-30 (negative): typing is not commanding.
  it('TC-30 leaves the objects alone while text is being edited', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    // Open a note's text: the caret owns the keyboard from here.
    const at = screenOfPoint(centre(a));
    const note = noteElement(a);
    press(note, at);
    release(at);
    press(note, at);
    release(at);
    fireEvent.dblClick(note, { clientX: at.x, clientY: at.y });
    flush();

    const editor = within(note).getByTestId('sticky-note-text') as HTMLTextAreaElement;
    expect(editor.tagName).toBe('TEXTAREA');
    fireEvent.input(editor, { target: { value: 'do not' } });
    flush();

    // Backspace in the editor edits the text; nothing is deleted and nothing is prevented.
    expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(true);
    expect(fireEvent.keyDown(editor, { key: 'a', ctrlKey: true })).toBe(true);
    flush();

    expect(snapshot(doc()).map((n) => n.id).sort()).toEqual([a, b].sort());
    // Still the one note selected — Ctrl+A did not reach the board's selection.
    expect(selectedIds()).toEqual([a]);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('Enter opens the text of the one note selected', () => {
    open();
    const a = makeNote(0, 0);
    click(noteElement(a), centre(a));

    fireEvent.keyDown(document.body, { key: 'Enter' });
    flush();

    expect((screen.getByTestId('sticky-note-text') as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
  });
});

describe('objects of another kind (sel.all_types)', () => {
  // A type the registry holds is drawn, selected, moved and deleted by the very same
  // code as a note: nothing below is testbox-specific.
  it('selects, moves and deletes a non-note type with the note commands', () => {
    registerTestboxType();
    open();
    const id = createTestbox(doc(), { x: 0, y: 0, width: 200, height: 100 }, 1);
    const a = makeNote(0, 0);
    flush();

    const box = screen.getByTestId('testbox') as HTMLElement;
    click(box, { x: 100, y: 50 });
    expect(screen.getByTestId('testbox').dataset.selected).toBe('true');
    expect(screen.getByTestId('selection-bar').textContent).toContain('1 selected');

    // Select all takes both kinds; the arrows move both.
    selectAll();
    expect(count()).toBe('2 selected');
    const before = boxOf(id);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    flush();
    expect(boxOf(id).x - before.x).toBeCloseTo(NUDGE_STEP_WORLD, 6);
    expect(boxOf(a).x).toBeCloseTo(-HALF + NUDGE_STEP_WORLD, 6);

    // A marquee around the box selects it on its own.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    marquee({ x: -50, y: -50 }, { x: 250, y: 150 });
    expect(screen.getByTestId('testbox').dataset.selected).toBe('true');
    expect(count()).toBe('1 selected');

    // And the bar deletes it.
    fireEvent.click(screen.getByTestId('delete-selection'));
    flush();
    expect(snapshotObjects(doc()).filter((object) => object.type === TESTBOX_TYPE)).toHaveLength(0);
  });

  // A kind nobody registered is not drawn, and so cannot be selected either (TC-08).
  it('does not draw or select a type this screen does not know', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(300, 0);
    doc().transact(() => {
      const alien = new Y.Map<unknown>();
      alien.set('type', 'hologram');
      alien.set('x', 40);
      alien.set('y', 40);
      alien.set('z', 5);
      doc().getMap<Y.Map<unknown>>('objects').set('alien-1', alien);
    });
    flush();

    expect(screen.queryAllByTestId('hologram')).toHaveLength(0);
    selectAll();
    // The two notes are the whole selection: the kind nobody registered is not in it.
    expect(count()).toBe('2 selected');
    expect(selectedIds()).toEqual([a, b].sort());
  });
});
