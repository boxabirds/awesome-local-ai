// undo.boundaries wiring (TC-14 to TC-17): the real App with a real Y.Doc, real controller and
// the story 7 gesture hook; one user action = one undo step.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { initialCamera } from './helpers';
import { editor, renderApp } from './stickyHelpers';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function nextFrame(ms = 16) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function toClient(world: { x: number; y: number }) {
  const cam = initialCamera();
  return { x: world.x - cam.x, y: world.y - cam.y };
}

function docWithNotes(...corners: [number, number][]) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = corners.map(
    ([x, y]) =>
      createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 }) as string,
  );
  return { doc, ids };
}

const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!;
const at = (doc: Y.Doc, id: string) => objectsSnapshot(doc).find((o) => o.id === id);
const positions = (doc: Y.Doc) => objectsSnapshot(doc).map(({ id, x, y }) => ({ id, x, y }));
const undoButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' });

let pointerId = 100;
function clickEl(el: Element, init: { shiftKey?: boolean } = {}) {
  const id = ++pointerId;
  fireEvent.pointerDown(el, { clientX: 5, clientY: 5, button: 0, pointerId: id, ...init });
  fireEvent.pointerUp(el, { clientX: 5, clientY: 5, button: 0, pointerId: id, ...init });
  fireEvent.click(el, init);
}

/** Drags `el` by (dx, dy) screen px over `frames` animation frames; ends with `end`. */
function dragFrames(
  el: Element,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  frames: number,
  end: 'up' | 'cancel' = 'up',
) {
  const id = ++pointerId;
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: id });
  for (let i = 1; i <= frames; i++) {
    fireEvent.pointerMove(el, {
      clientX: from.x + (delta.x * i) / frames,
      clientY: from.y + (delta.y * i) / frames,
      pointerId: id,
    });
    nextFrame();
  }
  const last = { clientX: from.x + delta.x, clientY: from.y + delta.y, pointerId: id };
  if (end === 'up') fireEvent.pointerUp(el, { ...last, button: 0 });
  else fireEvent.pointerCancel(el, last);
  nextFrame();
}

describe('undo.boundaries wiring', () => {
  it('TC-14 a 30-frame drag of a selection is one step restoring every start position', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0], [0, 300], [300, 300]);
    renderApp(doc);
    const start = positions(doc);
    clickEl(objectEl(ids[0]));
    for (const id of ids.slice(1)) clickEl(objectEl(id), { shiftKey: true });
    dragFrames(objectEl(ids[0]), toClient({ x: 50, y: 50 }), { x: 600, y: 450 }, 30);
    expect(at(doc, ids[0])).toMatchObject({ x: 600, y: 450 });
    expect(at(doc, ids[4])).toMatchObject({ x: 900, y: 750 });

    fireEvent.click(undoButton());
    expect(positions(doc)).toEqual(start);
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-15 a colour change 200 ms after a drag is a separate step', () => {
    const { doc, ids } = docWithNotes([0, 0]);
    renderApp(doc);
    clickEl(objectEl(ids[0]));
    dragFrames(objectEl(ids[0]), toClient({ x: 50, y: 50 }), { x: 100, y: 0 }, 5);
    nextFrame(200);
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(at(doc, ids[0])).toMatchObject({ x: 100, y: 0 });
    expect(snapshot(doc)[0].color).toBe('pink');

    fireEvent.click(undoButton());
    expect(snapshot(doc)[0].color).toBe('yellow');
    expect(at(doc, ids[0])).toMatchObject({ x: 100, y: 0 });
    fireEvent.click(undoButton());
    expect(at(doc, ids[0])).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-16 Ctrl+Z while editing undoes the typing, not the earlier move', () => {
    const { doc, ids } = docWithNotes([0, 0]);
    renderApp(doc);
    clickEl(objectEl(ids[0]));
    dragFrames(objectEl(ids[0]), toClient({ x: 50, y: 50 }), { x: 100, y: 0 }, 5);
    fireEvent.doubleClick(objectEl(ids[0]));
    const textarea = editor() as HTMLTextAreaElement;
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      fireEvent.change(textarea, { target: { value: text } });
      nextFrame(100);
    }
    expect(snapshot(doc)[0].text).toBe('hello');

    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      textarea.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(snapshot(doc)[0].text).toBe('');
    expect(textarea.value).toBe('');
    expect(at(doc, ids[0])).toMatchObject({ x: 100, y: 0 });
    // Still editing.
    expect(editor()).not.toBeNull();

    // Redo inside the editor brings the typing back.
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(snapshot(doc)[0].text).toBe('hello');
    expect(textarea.value).toBe('hello');
  });

  it('TC-17 a drag interrupted by pointercancel is still one step back to the start', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    renderApp(doc);
    clickEl(objectEl(ids[0]));
    clickEl(objectEl(ids[1]), { shiftKey: true });
    const start = positions(doc);
    dragFrames(objectEl(ids[0]), toClient({ x: 50, y: 50 }), { x: 200, y: 200 }, 10, 'cancel');
    expect(at(doc, ids[0])).toMatchObject({ x: 200, y: 200 });

    fireEvent.click(undoButton());
    expect(positions(doc)).toEqual(start);
    expect(undoButton().disabled).toBe(true);
  });
});
