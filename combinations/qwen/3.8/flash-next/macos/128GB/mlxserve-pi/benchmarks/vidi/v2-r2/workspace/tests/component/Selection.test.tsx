// Story 7, the multi-selection behaviour as the whole app renders it: the
// selection bar, the marquee, the group transform gesture and the keyboard.
// TC ids are the Acceptance Cases in
// spec/stories/007-select-move-resize-and-delete-several-objects-at-o/design.md.

import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
} from '../../src/shared/config';
import {
  clickOn,
  doubleClickOn,
  dragTo,
  editorElement,
  flushFrames,
  forceConnectionState,
  initialCamera,
  modelText,
  newNote,
  noteAt,
  noteCount,
  noteElements,
  notePosition,
  noteToolbarOpen,
  pointerOn,
  pressKey,
  pressKeyOn,
  readCamera,
  renderBoard,
  selectionCount,
  selectedNotes,
  typeInto,
  useBoardTestLifecycle,
  viewportEl,
} from './helpers';
import { rawObject } from '../helpers/yjs';

useBoardTestLifecycle();

/** A note's rendered element by its id - paint order is not creation order. */
function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`);
  if (el === null) throw new Error(`note ${id} is not rendered`);
  return el as HTMLElement;
}

/** The ids of the selected notes, sorted: selection is a set. */
function selectedIds(): string[] {
  return selectedNotes()
    .map((el) => el.getAttribute('data-note-id'))
    .sort() as string[];
}

function barElement(): HTMLElement | null {
  return document.querySelector('[data-testid="selection-bar"]');
}

/** Shift-click, the multi-select gesture a keyboard-less mouse knows. */
function shiftClick(el: Element): void {
  pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10, shiftKey: true });
  pointerOn(el, 'pointerup', { clientX: 10, clientY: 10, shiftKey: true });
}

/** Shift-drag on empty board space: the marquee, in screen (world at 1x) pixels. */
function marqueeDrag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 4): void {
  const el = viewportEl();
  pointerOn(el, 'pointerdown', { clientX: from.x, clientY: from.y, shiftKey: true });
  for (let i = 1; i <= steps; i += 1) {
    pointerOn(el, 'pointermove', {
      clientX: from.x + ((to.x - from.x) * i) / steps,
      clientY: from.y + ((to.y - from.y) * i) / steps,
      shiftKey: true,
    });
  }
}

// The board opens centred on the world origin, so world points arrive on
// screen shifted by the starting camera; marquee points are stated in world
// units and converted, never guessed.
function screenPoint(worldX: number, worldY: number): { x: number; y: number } {
  const cam = initialCamera();
  return { x: worldX - cam.x, y: worldY - cam.y };
}

function marqueeEnd(to: { x: number; y: number }): void {
  pointerOn(viewportEl(), 'pointerup', { clientX: to.x, clientY: to.y, shiftKey: true });
}

function marqueeCancel(to: { x: number; y: number }): void {
  pointerOn(viewportEl(), 'pointercancel', { clientX: to.x, clientY: to.y, shiftKey: true });
}

function marqueeElement(): HTMLElement | null {
  return document.querySelector('[data-testid="marquee"]');
}

/** One step of a synthetic gesture, with the world's microtasks flushed. */
async function step(action: () => void): Promise<void> {
  await act(async () => {
    action();
  });
}

/** Drag a note by id a given number of pixels, in steps, with the real events. */
function dragNoteById(
  id: string,
  dx: number,
  dy: number,
  steps = 4,
  options: { endWith?: 'up' | 'cancel' } = {},
): void {
  const el = noteEl(id);
  pointerOn(el, 'pointerdown', { clientX: 20, clientY: 20 });
  for (let i = 1; i <= steps; i += 1) {
    pointerOn(el, 'pointermove', { clientX: 20 + (dx * i) / steps, clientY: 20 + (dy * i) / steps });
    flushFrames();
  }
  pointerOn(el, options.endWith === 'cancel' ? 'pointercancel' : 'pointerup', {
    clientX: 20 + dx,
    clientY: 20 + dy,
  });
  flushFrames();
}

/** The same drag, stepped through microtasks, for a MutationObserver to see. */
async function dragNoteObserved(id: string, dx: number, dy: number, endWith: 'up' | 'cancel'): Promise<void> {
  const el = noteEl(id);
  await step(() => pointerOn(el, 'pointerdown', { clientX: 20, clientY: 20 }));
  for (let i = 1; i <= 4; i += 1) {
    await step(() => {
      pointerOn(el, 'pointermove', { clientX: 20 + (dx * i) / 4, clientY: 20 + (dy * i) / 4 });
      flushFrames();
    });
  }
  await step(() =>
    pointerOn(el, endWith === 'cancel' ? 'pointercancel' : 'pointerup', { clientX: 20 + dx, clientY: 20 + dy }),
  );
}

/**
 * Grab one named resize handle of the selection box and drag it, then let go.
 * The handle's own centre is the grab point; moves go to the window, which is
 * where a real drag ends up when the pointer outruns the 8-pixel handle.
 */
function dragHandle(handle: string, dx: number, dy: number, shiftKey = false): void {
  const el = screen.getByTestId(`resize-handle-${handle}`) as HTMLElement;
  const cx = Number.parseFloat(el.style.left) + HANDLE_SIZE_PX / 2;
  const cy = Number.parseFloat(el.style.top) + HANDLE_SIZE_PX / 2;
  pointerOn(el, 'pointerdown', { clientX: cx, clientY: cy, shiftKey });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: cx + dx, clientY: cy + dy });
  flushFrames();
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: cx + dx, clientY: cy + dy });
  flushFrames();
}

describe('the selection bar (TC-16 to TC-18)', () => {
  // TC-16
  it('deselects objects that another editor deleted, singly and in a group', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 500, y: 100 });
    const c = newNote(doc, { x: 900, y: 100 });

    clickOn(noteAt(2));
    shiftClick(noteEl(a));
    expect(selectionCount()).toBe(2);
    expect(barElement()).not.toBeNull();

    // the colleague's deletion lands on the same document
    act(() => {
      doc.transact(() => {
        const objects = doc.getMap<unknown>('objects');
        objects.delete(a);
      });
    });

    expect(selectionCount()).toBe(1);
    expect(selectedIds()).not.toContain(a);
    expect(barElement()).toBeNull(); // one left: the note toolbar is the UI again

    act(() => {
      doc.transact(() => {
        const objects = doc.getMap<unknown>('objects');
        objects.delete(b);
        objects.delete(c);
      });
    });
    expect(selectionCount()).toBe(0);
    expect(barElement()).toBeNull();
  });

  // TC-17
  it('says "2 selected", offers a Delete selection button, and announces the count', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 500, y: 100 });
    clickOn(noteEl(b));
    shiftClick(noteEl(a));

    const bar = barElement();
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toContain('2 selected');
    expect(screen.getByRole('button', { name: 'Delete selection' })).not.toBeNull();
    // the count is announced: role=status implies aria-live=polite, set explicitly too
    const count = screen.getByTestId('selection-count');
    expect(count.getAttribute('aria-live')).toBe('polite');
  });

  // TC-18
  it('stays away when one object is selected, where the note toolbar serves (negative)', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    clickOn(noteEl(a));
    expect(noteToolbarOpen()).toBe(true);
    expect(barElement()).toBeNull();
  });
});

describe('the marquee (TC-19 to TC-22)', () => {
  // TC-19
  it('shift-click on empty space clears the selection', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    clickOn(noteEl(a));
    expect(selectionCount()).toBe(1);

    // a shift-drag that never travels is a click: it clears, it selects nothing
    pointerOn(viewportEl(), 'pointerdown', { clientX: 500, clientY: 500, shiftKey: true });
    pointerOn(viewportEl(), 'pointerup', { clientX: 500, clientY: 500, shiftKey: true });
    expect(selectionCount()).toBe(0);
  });

  // TC-20
  it('adds only the objects fully inside the rect to the selection', () => {
    const { doc } = renderBoard();
    // boxes: A (0..200), B (700..900), C (850..1050, 500..700) - C is clipped
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 800, y: 800 });
    newNote(doc, { x: 950, y: 700 });

    clickOn(noteEl(a)); // the selection the marquee must ADD to, not replace

    marqueeDrag(screenPoint(650, 650), screenPoint(950, 950));
    expect(marqueeElement()).not.toBeNull(); // visible while dragging
    marqueeEnd(screenPoint(950, 950));

    expect(selectedIds()).toEqual([a, b].sort());
    expect(marqueeElement()).toBeNull();
  });

  // TC-21
  it('dragging empty space WITHOUT shift pans and shows no marquee (negative)', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    clickOn(noteEl(a));

    dragTo(screenPoint(400, 400), screenPoint(300, 300)); // no shift held
    expect(marqueeElement()).toBeNull();
    const cam = initialCamera();
    expect(readCamera().x).toBeCloseTo(cam.x + 100); // the pan happened...
    expect(readCamera().y).toBeCloseTo(cam.y + 100);
    expect(selectedIds()).toEqual([a]); // ...and the selection is what it was
  });

  // TC-22
  it('leaves the selection unchanged when the pointer is cancelled mid-marquee', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    newNote(doc, { x: 800, y: 800 });
    clickOn(noteEl(a));

    marqueeDrag(screenPoint(650, 650), screenPoint(950, 950), 2);
    expect(marqueeElement()).not.toBeNull();
    marqueeCancel(screenPoint(950, 950));

    expect(marqueeElement()).toBeNull();
    expect(selectedIds()).toEqual([a]); // b was inside, and is NOT selected
    expect(noteCount()).toBe(2);
  });
});

describe('the transform gesture (TC-23 to TC-26)', () => {
  // TC-23
  it('starts with the object under the pointer: only the dragged note moves and is selected', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 500, y: 100 });
    clickOn(noteEl(a));
    expect(selectedIds()).toEqual([a]);

    dragNoteById(b, 120, 40);

    expect(selectedIds()).toEqual([b]); // the old selection is gone
    const moved = noteEl(b);
    expect(Number(moved.getAttribute('data-note-x'))).toBe(400 + 120);
    expect(Number(moved.getAttribute('data-note-y'))).toBe(0 + 40);
    expect(Number(noteEl(a).getAttribute('data-note-x'))).toBe(0); // the other stays
  });

  // TC-23, the threshold boundary
  it('treats a drag of one pixel under the threshold as a click and exactly-the-threshold as a move', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });

    dragNoteById(a, DRAG_THRESHOLD_PX - 1, 0, DRAG_THRESHOLD_PX - 1);
    expect(notePosition(0).x).toBe(0); // no write: a click is a click

    dragNoteById(a, DRAG_THRESHOLD_PX, 0, DRAG_THRESHOLD_PX);
    expect(notePosition(0).x).toBe(DRAG_THRESHOLD_PX); // the gesture starts at exactly 3
  });

  // TC-24
  it('resizes through the selection box handles: width only on an edge, ratio kept at a corner', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    clickOn(noteEl(a));

    // Shift at a corner keeps the square a square (for stickies the lock is
    // always on; a corner drag asks for 300x240 and gets 300x300)
    dragHandle('se', 100, 40, true);
    const locked = rawObject(doc, a)!;
    expect(locked.get('width')).toBe(300);
    expect(locked.get('height')).toBe(300);

    // the east handle then drags the right edge 60 px: the height must not flinch
    dragHandle('e', 60, 0);
    const after = rawObject(doc, a)!;
    expect(after.get('width')).toBe(360);
    expect(after.get('height')).toBe(300);

    expect(screen.getByLabelText('Resize east')).not.toBeNull();
    expect(screen.getByLabelText('Resize southeast')).not.toBeNull();
  });

  // TC-25
  it('writes nothing to the document when the board is not editable (negative)', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    forceConnectionState('load_failed'); // the edit lock: view only

    // nothing may be selected or moved while locked
    dragNoteById(a, 80, 20);
    expect(notePosition(0).x).toBe(0);

    // the marquee writes nothing either
    marqueeDrag({ x: 0, y: 0 }, { x: 900, y: 900 });
    marqueeEnd({ x: 900, y: 900 });
    expect(selectionCount()).toBe(0);

    // and the keyboard stays out of the document
    const before = doc.getMap<unknown>('objects').size;
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(doc.getMap<unknown>('objects').size).toBe(before);
  });

  // TC-26
  it('marks the drag with exactly one start and one end, and a cancel keeps the last position', async () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });

    const observed: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        observed.push(String((record.target as HTMLElement).dataset.dragging));
      }
    });
    observer.observe(noteEl(a), { attributes: true, attributeFilter: ['data-dragging'] });

    // stepped so the observer sees the state between the events, the way a
    // real browser renders between real events; a plain synchronous drag
    // would batch begin+end into one render that never shows "dragging"
    await dragNoteObserved(a, 60, 0, 'up');
    observer.disconnect();
    expect(observed).toEqual(['true', 'false']); // exactly one start, exactly one end

    // a cancel mid-drag keeps the last applied position
    dragNoteById(a, 200, 0, 10, { endWith: 'cancel' });
    const x = Number(noteEl(a).getAttribute("data-note-x"));
    expect(x).toBeGreaterThan(60); // the cancel stopped the drag...
    expect(noteEl(a).getAttribute('data-dragging')).toBe('false'); // ...and ended the gesture
  });
});

describe('the keyboard (TC-27 to TC-31)', () => {
  // TC-27
  it('selects every object on Ctrl+A and Cmd+A, with the default prevented', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 100, y: 100 });
    newNote(doc, { x: 500, y: 100 });

    const ctrl = pressKey('a', { ctrlKey: true });
    expect(selectionCount()).toBe(2);
    expect(ctrl.defaultPrevented).toBe(true);

    pressKey('Escape');
    expect(selectionCount()).toBe(0);
    const cmd = pressKey('a', { metaKey: true });
    expect(selectionCount()).toBe(2);
    expect(cmd.defaultPrevented).toBe(true);
  });

  // TC-28
  it('is a harmless no-op to Ctrl+A on an empty board (negative)', () => {
    renderBoard();
    const event = pressKey('a', { ctrlKey: true });
    expect(selectionCount()).toBe(0);
    expect(event.defaultPrevented).toBe(true); // stealing "select all" from a
    // browser that has nothing to select is still not what the board means
  });

  // TC-29
  it('nudges by one world unit, ten with Shift, and the page does not scroll', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    clickOn(noteEl(a));
    const camera = readCamera();

    pressKey('ArrowRight');
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    expect(notePosition(0).x).toBe(3 * NUDGE_STEP_WORLD);

    const up = fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    flushFrames();
    expect(up).toBe(false); // preventDefault: the browser was told not to scroll
    expect(notePosition(0).y).toBe(-NUDGE_LARGE_STEP_WORLD);

    expect(readCamera()).toEqual(camera); // the camera never moved
    expect(window.scrollY).toBe(0);
  });

  // TC-30
  it('leaves the note alone while editing: Backspace edits text, it does not delete', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    doubleClickOn(noteEl(a));
    const editor = editorElement();
    expect(editor).not.toBeNull();

    pressKeyOn(editor, 'Backspace'); // would delete the note outside an editor
    typeInto('kept');
    expect(noteCount()).toBe(1);
    expect(modelText(doc, a)).toBe('kept');
    expect(selectionCount()).toBe(1); // Escape-less: the note is still selected
  });

  // TC-31
  it('deletes every selected object on Delete and empties the selection', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 500, y: 100 });
    const c = newNote(doc, { x: 900, y: 100 });
    clickOn(noteEl(a));
    shiftClick(noteEl(b));
    expect(selectionCount()).toBe(2);

    pressKey('Delete');
    expect(noteCount()).toBe(1); // c survives
    expect(selectedIds()).toEqual([]);
    expect(noteElements().length).toBe(1);
    expect(rawObject(doc, a)).toBeNull();
    expect(rawObject(doc, b)).toBeNull();
    expect(rawObject(doc, c)).not.toBeNull();
  });

  // the note that the keyboard also owns: Enter opens the editor, Escape clears
  it('opens the editor on Enter with exactly one note selected', () => {
    const { doc } = renderBoard();
    const a = newNote(doc, { x: 100, y: 100 });
    const b = newNote(doc, { x: 500, y: 100 });

    clickOn(noteEl(a));
    shiftClick(noteEl(b));
    pressKey('Enter');
    expect(editorElement()).toBeNull(); // two selected: Enter does nothing

    pressKey('Escape');
    clickOn(noteEl(a));
    pressKey('Enter');
    expect(editorElement()).not.toBeNull();
  });
});
