import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, objectSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { dispatchPrevented, key, nextFrame, noteEl, pointer, press, renderApp, setCamera } from './helpers';

/** Three notes in a row with their top-left at x = 0, 300, 600 (y = 0), plus one with text. */
function board() {
  const doc = new Y.Doc();
  initDoc(doc);
  const at = (x: number, y: number) => createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  const ids = [at(0, 0), at(300, 0), at(600, 0)];
  const texted = at(0, 400);
  getStickyText(doc, texted)!.insert(0, 'Start');
  return { doc, ids, texted };
}

function renderAt(doc: Y.Doc) {
  const utils = renderApp(doc);
  setCamera({ x: 0, y: 0, zoom: 1 });
  return utils;
}

function mod(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  return dispatchPrevented(
    target,
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...init }),
  );
}

const undo = (target?: EventTarget) => mod('z', {}, target);

/** renderApp fakes only animation frames; also fake the clock the capture timeout reads. */
function fakeClock() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
}

function positions(doc: Y.Doc) {
  return objectSnapshot(doc).map((o) => ({ id: o.id, x: o.x, y: o.y }));
}

function stateOf(doc: Y.Doc) {
  return JSON.stringify(snapshot(doc));
}

describe('undo step boundaries (undo.boundaries)', () => {
  it('TC-14 a 30-frame drag of a selection is one step; one undo restores every start position', () => {
    const { doc, ids } = board();
    renderAt(doc);
    const before = stateOf(doc);
    mod('a');
    const el = noteEl(ids[0]);
    pointer(el, 'down', 10, 10);
    for (let i = 1; i <= 30; i++) {
      pointer(el, 'move', 10 + i * 7, 10 + i * 3);
      nextFrame();
    }
    pointer(el, 'up', 220, 100);
    expect(positions(doc).find((p) => p.id === ids[1])).toMatchObject({ x: 510, y: 90 });
    expect(undo()).toBe(true);
    expect(stateOf(doc)).toBe(before); // positions and stacking
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });

  it('a drag held still for longer than the capture timeout is still one step', () => {
    const { doc, ids } = board();
    renderAt(doc);
    fakeClock();
    const before = stateOf(doc);
    const el = noteEl(ids[0]);
    pointer(el, 'down', 10, 10);
    pointer(el, 'move', 50, 10);
    nextFrame();
    vi.setSystemTime(Date.now() + UNDO_CAPTURE_TIMEOUT_MS * 4);
    pointer(el, 'move', 90, 10);
    nextFrame();
    pointer(el, 'up', 90, 10);
    undo();
    expect(stateOf(doc)).toBe(before);
  });

  it('TC-15 a drag and a colour change 200 ms later are two separate steps', () => {
    const { doc, ids } = board();
    renderAt(doc);
    fakeClock();
    const el = noteEl(ids[1]);
    pointer(el, 'down', 310, 10);
    pointer(el, 'move', 360, 60);
    nextFrame();
    pointer(el, 'up', 360, 60);
    vi.setSystemTime(Date.now() + 200);
    act(() => screen.getByRole('button', { name: 'Pink colour' }).click());
    expect(snapshot(doc).find((n) => n.id === ids[1])).toMatchObject({ x: 350, y: 50, color: 'pink' });
    undo();
    expect(snapshot(doc).find((n) => n.id === ids[1])).toMatchObject({ x: 350, y: 50, color: 'yellow' });
    undo();
    expect(snapshot(doc).find((n) => n.id === ids[1])).toMatchObject({ x: 300, y: 0, color: 'yellow' });
  });

  it('TC-16 Ctrl+Z while editing undoes the typing in that note, never the earlier move', async () => {
    const { doc, texted } = board();
    renderAt(doc);
    const el = noteEl(texted);
    pointer(el, 'down', 10, 410);
    pointer(el, 'move', 60, 410);
    nextFrame();
    pointer(el, 'up', 60, 410);
    expect(snapshot(doc).find((n) => n.id === texted)).toMatchObject({ x: 50 });
    key('Enter', noteEl(texted));
    const ta = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    await userEvent.setup({ delay: null }).keyboard(' hello');
    expect(getStickyText(doc, texted)!.toString()).toBe('Start hello');
    expect(undo(ta)).toBe(true); // default prevented: no native textarea undo
    expect(getStickyText(doc, texted)!.toString()).toBe('Start');
    expect(ta.value).toBe('Start');
    // Nothing more to undo inside this note: the move stays.
    expect(undo(ta)).toBe(true);
    expect(snapshot(doc).find((n) => n.id === texted)).toMatchObject({ x: 50, text: 'Start' });
    // Redo inside the editor brings the typing back.
    expect(mod('z', { shiftKey: true }, ta)).toBe(true);
    expect(ta.value).toBe('Start hello');
    // After leaving the note, undo continues through earlier actions.
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    undo();
    expect(getStickyText(doc, texted)!.toString()).toBe('Start');
    undo();
    expect(snapshot(doc).find((n) => n.id === texted)).toMatchObject({ x: 0, y: 400 });
  });

  it('typing after a pause of UNDO_CAPTURE_TIMEOUT_MS is a separate step', async () => {
    const { doc, texted } = board();
    renderAt(doc);
    fakeClock();
    press(noteEl(texted), 10, 410);
    key('Enter', noteEl(texted));
    const ta = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    const user = userEvent.setup({ delay: null });
    await user.keyboard(' one');
    vi.setSystemTime(Date.now() + UNDO_CAPTURE_TIMEOUT_MS);
    await user.keyboard(' two');
    undo(ta);
    expect(ta.value).toBe('Start one');
    undo(ta);
    expect(ta.value).toBe('Start');
  });

  it('TC-17 pointercancel mid-drag still leaves one step that restores the start', () => {
    const { doc, ids } = board();
    renderAt(doc);
    const before = stateOf(doc);
    mod('a');
    const el = noteEl(ids[2]);
    pointer(el, 'down', 610, 10);
    for (let i = 1; i <= 5; i++) {
      pointer(el, 'move', 610 + i * 20, 10);
      nextFrame();
    }
    pointer(el, 'cancel', 710, 10);
    expect(positions(doc).find((p) => p.id === ids[2])).toMatchObject({ x: 700 });
    // The next change is a step of its own.
    act(() => {
      createSticky(doc, { x: 2000, y: 2000 });
    });
    undo();
    expect(snapshot(doc)).toHaveLength(4);
    expect(positions(doc).find((p) => p.id === ids[2])).toMatchObject({ x: 700 });
    undo();
    expect(stateOf(doc)).toBe(before);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});
