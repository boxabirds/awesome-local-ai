import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { flushFrame, pointer, renderApp } from './helpers';

// jsdom has no layout: the camera starts centred on world (0, 0) at 100%.
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const screenOf = (world: { x: number; y: number }) => ({ x: CENTRE.x + world.x, y: CENTRE.y + world.y });

/** The undo controller reads Date.now(); tests move it explicitly. */
let now = 1_000_000;
const advanceClock = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A sticky note whose top-left is at `at` (world), made before the board opens (not in anyone's history). */
function note(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, { x: at.x + STICKY_SIZE_WORLD / 2, y: at.y + STICKY_SIZE_WORLD / 2 });
  if (id === false) throw new Error('create rejected');
  return id;
}

const positions = (doc: Y.Doc) => new Map(objectsSnapshot(doc).map((o) => [o.id, { x: o.x, y: o.y }]));
const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const ctrlZ = (target: Element | Document = document.body) => fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
const undoButton = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
const editor = () => screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;

/** Drags object `id` by (dx, dy) screen px in `frames` pointer moves, one animation frame each. */
function drag(
  doc: Y.Doc,
  id: string,
  dx: number,
  dy: number,
  frames: number,
  opts: { end?: 'up' | 'cancel'; pauseMs?: number } = {},
) {
  const el = objectEl(id);
  const at = positions(doc).get(id)!;
  const start = screenOf({ x: at.x + 20, y: at.y + 20 });
  pointer(el, 'down', start.x, start.y);
  for (let i = 1; i <= frames; i++) {
    pointer(el, 'move', start.x + (dx * i) / frames, start.y + (dy * i) / frames);
    flushFrame();
    // Frames are ~16 ms apart; an optional long pause mid-drag must not split the step.
    advanceClock(i === Math.floor(frames / 2) && opts.pauseMs ? opts.pauseMs : 16);
  }
  pointer(el, opts.end ?? 'up', start.x + dx, start.y + dy);
  flushFrame();
}

function setup(count: number) {
  const doc = newDoc();
  const ids = Array.from({ length: count }, (_, i) => note(doc, { x: i * 250, y: 0 }));
  renderApp(doc);
  return { doc, ids };
}

describe('undo.boundaries (App wiring)', () => {
  it('TC-14 a 30-frame drag of a selection is one step restoring every start position', () => {
    const { doc, ids } = setup(3);
    const before = positions(doc);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    drag(doc, ids[0]!, 300, 150, 30, { pauseMs: UNDO_CAPTURE_TIMEOUT_MS * 2 });
    const after = positions(doc);
    for (const id of ids) expect(after.get(id)).toEqual({ x: before.get(id)!.x + 300, y: before.get(id)!.y + 150 });

    expect(ctrlZ()).toBe(false); // preventDefault
    expect(positions(doc)).toEqual(before);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('TC-15 a colour change 200 ms after a drag is a separate step', () => {
    const { doc, ids } = setup(1);
    const id = ids[0]!;
    drag(doc, id, 100, 0, 5);
    advanceClock(200);
    fireEvent.click(screen.getByRole('button', { name: 'Green colour' }));
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 100, color: 'green' });

    ctrlZ();
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 100, color: 'yellow' });
    ctrlZ();
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 0, color: 'yellow' });
  });

  it('TC-16 Ctrl+Z inside the editor undoes typing but not the earlier move', () => {
    const { doc, ids } = setup(1);
    const id = ids[0]!;
    drag(doc, id, 100, 0, 5);
    advanceClock(50);
    fireEvent.doubleClick(objectEl(id));
    const el = editor();
    for (const value of ['h', 'he', 'hel', 'hell', 'hello']) {
      fireEvent.input(el, { target: { value } });
      advanceClock(100);
    }
    expect(getStickyText(doc, id)!.toString()).toBe('hello');

    expect(ctrlZ(el)).toBe(false); // the browser's own textarea undo is prevented
    expect(getStickyText(doc, id)!.toString()).toBe('');
    expect(el.value).toBe('');
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 100 });

    // Nothing else to undo inside this edit: the move stays.
    ctrlZ(el);
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 100 });

    // Redo inside the editor brings the typing back.
    fireEvent.keyDown(el, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(el.value).toBe('hello');

    // After leaving the note, undo continues through earlier actions.
    fireEvent.keyDown(el, { key: 'Escape' });
    ctrlZ();
    expect(getStickyText(doc, id)!.toString()).toBe('');
    ctrlZ();
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 0 });
  });

  it('TC-16 typing pauses of UNDO_CAPTURE_TIMEOUT_MS split typing into steps', () => {
    const { doc, ids } = setup(1);
    const id = ids[0]!;
    fireEvent.doubleClick(objectEl(id));
    const el = editor();
    fireEvent.input(el, { target: { value: 'one' } });
    advanceClock(UNDO_CAPTURE_TIMEOUT_MS);
    fireEvent.input(el, { target: { value: 'one two' } });
    ctrlZ(el);
    expect(getStickyText(doc, id)!.toString()).toBe('one');
    ctrlZ(el);
    expect(getStickyText(doc, id)!.toString()).toBe('');
  });

  it('TC-17 a drag cancelled mid-way is one step restoring the start position', () => {
    const { doc, ids } = setup(2);
    const before = positions(doc);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    drag(doc, ids[1]!, -120, 80, 12, { end: 'cancel' });
    expect(positions(doc)).not.toEqual(before);
    ctrlZ();
    expect(positions(doc)).toEqual(before);
    expect(undoButton().disabled).toBe(true);
  });
});
