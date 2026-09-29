// Story 8 `undo.boundaries` component cases (TC-14 to TC-17), plus the step
// boundaries the story's acceptance criteria need around them.
//
// These mount the real board — `BoardApp` with its gestures, its keyboard and its
// text editor — and inject the tab's `UndoController`, so what a test reads is the
// step count the wiring produced. What is under test is not `Y.UndoManager` (the
// unit files cover that) but whether the board closes the capture window where one
// user action ends and opens one where the next begins.
//
// Timers are faked so a gesture's frames can be stepped through. Note what that
// does *not* fake: yjs reads the clock through `lib0/time`, which the component
// project leaves alone, so inside one test every transaction lands at the same
// millisecond and would merge into a single step if nothing separated them. That is
// what makes these tests bite: without a boundary, every one of them collapses into
// one step and fails.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import {
  createSticky,
  getStickyText,
  initDoc,
  objectBounds,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import type { StickyColor } from '../../src/shared/config.ts';

interface Seed {
  text?: string;
  x: number;
  y: number;
  color?: StickyColor;
}

let doc: Y.Doc;
let undo: UndoController;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The board as the user finds it: notes already on it, controller mounted with it. */
function mountBoard(seeds: Seed[]): string[] {
  doc = new Y.Doc();
  initDoc(doc);
  const ids = seeds.map((seed) => {
    const id = createSticky(doc, { x: seed.x, y: seed.y }, seed.color);
    if (seed.text) getStickyText(doc, id)!.insert(0, seed.text);
    return id;
  });
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
  return ids;
}

function firePointer(el: EventTarget, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}
function fireKey(
  key: string,
  target: EventTarget = window,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}
function fireInput(ta: HTMLElement) {
  act(() => {
    ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

const el = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const editor = () => screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
const viewport = () => screen.getByTestId('viewport');
const obj = (id: string): ObjectSnapshot => objectSnapshots(doc).find((o) => o.id === id)!;
const bounds = (id: string) => objectBounds(obj(id));
const where = (id: string) => {
  const b = bounds(id);
  return { x: b.x, y: b.y };
};
const textOf = (id: string) => obj(id).text ?? '';
const colorOf = (id: string) => obj(id).color;
const selected = () => document.querySelectorAll('[data-selected="true"]');

/** One character at a time, the way a person types. */
function typeChars(ta: HTMLTextAreaElement, text: string) {
  for (const ch of text) {
    act(() => {
      ta.value = ta.value + ch;
    });
    fireInput(ta);
  }
}

function openEditor(id: string) {
  act(() => {
    el(id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  flush();
}
/** Click empty space: the note commits its text and stops being edited. */
function clickBackground() {
  firePointer(viewport(), 'pointerdown', 40, 40);
  firePointer(viewport(), 'pointerup', 40, 40);
  flush();
}

/**
 * A whole drag of `frames` moves, ended by `end` — release, or the pointercancel a
 * pointer that left the window produces. The frames are what a 30-frame drag really
 * is: dozens of writes, one intention.
 */
function dragNote(id: string, dx: number, dy: number, frames = 30, end = 'pointerup') {
  firePointer(el(id), 'pointerdown', 40, 40);
  for (let i = 1; i <= frames; i++) {
    firePointer(window, 'pointermove', 40 + (dx * i) / frames, 40 + (dy * i) / frames);
    flush();
  }
  firePointer(window, end, 40 + dx, 40 + dy);
  flush();
}

function clickOn(id: string) {
  firePointer(el(id), 'pointerdown', 40, 40);
  firePointer(el(id), 'pointerup', 40, 40);
  flush();
}

describe('story 8 undo.boundaries (TC-14 to TC-17)', () => {
  it('TC-14 a 30-frame drag is one step, and undo puts the note back where it started', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300 }]);
    const start = where(a);
    expect(undo.canUndo()).toBe(false); // opening the board is not my change

    dragNote(a, 150, 120);

    expect(where(a)).toEqual({ x: start.x + 150, y: start.y + 120 });
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(where(a)).toEqual(start); // one press reversed thirty writes
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-14 extra: dragging the same note twice is two steps, not one', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300 }]);
    const start = where(a);

    dragNote(a, 150, 120);
    const mid = where(a);
    dragNote(a, -60, 80);

    expect(undo.undo()).toBe(true);
    expect(where(a)).toEqual(mid);
    expect(undo.undo()).toBe(true);
    expect(where(a)).toEqual(start);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-15 a move and a colour chosen straight after it are two steps', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300, color: 'yellow' }]);
    const start = where(a);

    dragNote(a, 120, 60); // the gesture ends...
    const moved = where(a);
    // ...and the colour is chosen immediately after, well inside the capture window.
    fireEvent.click(screen.getByLabelText('Green colour'));
    flush();
    expect(colorOf(a)).toBe('green');

    expect(undo.undo()).toBe(true);
    expect(colorOf(a)).toBe('yellow'); // the colour is its own step...
    expect(where(a)).toEqual(moved); // ...and the move stands

    expect(undo.undo()).toBe(true);
    expect(where(a)).toEqual(start); // ...the move is the other one
    expect(colorOf(a)).toBe('yellow');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-16 Ctrl/Cmd+Z inside the editor reverses the line just typed, not the move before it', () => {
    const [a] = mountBoard([{ x: 300, y: 300 }]);
    const start = where(a);
    dragNote(a, 150, 120);
    const moved = where(a);

    openEditor(a);
    typeChars(editor(), 'a fresh line');
    expect(textOf(a)).toBe('a fresh line');

    const ev = fireKey('z', editor(), { ctrl: true });
    flush();

    expect(ev.defaultPrevented).toBe(true); // the textarea kept no history of its own
    expect(textOf(a)).toBe(''); // the line is gone...
    expect(editor().value).toBe(''); // ...from the document and from the box
    expect(where(a)).toEqual(moved); // ...and the move was left alone
    expect(undo.canRedo()).toBe(true);

    // Cmd is the same chord on macOS, and this press is the step before the typing:
    // the move. Undo walks my own history back one action at a time.
    fireKey('z', editor(), { meta: true });
    flush();
    expect(where(a)).toEqual(start);
    expect(textOf(a)).toBe('');

    // Ctrl+Shift+Z in the same box puts my steps back, oldest first: the move
    // returns, and only then the line I typed.
    fireKey('z', editor(), { ctrl: true, shift: true });
    flush();
    expect(where(a)).toEqual(moved);
    fireKey('z', editor(), { ctrl: true, shift: true });
    flush();
    expect(textOf(a)).toBe('a fresh line');
    expect(where(a)).toEqual(moved);
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-17 a drag the pointer cancels halfway is still one step, back to the start', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300 }]);
    const start = where(a);

    dragNote(a, 200, 100, 30, 'pointercancel');

    expect(undo.canUndo()).toBe(true);
    expect(where(a).x).toBeGreaterThan(start.x); // it moved before it was cancelled
    expect(undo.undo()).toBe(true);
    expect(where(a)).toEqual(start); // one press, back to where the drag began
    expect(undo.canUndo()).toBe(false);
    // The note is still the selected one, and its toolbar is back: the cancelled
    // gesture left nothing half-finished behind.
    expect(selected()).toHaveLength(1);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('typing and then recolouring are two steps that undo one at a time', () => {
    const [a] = mountBoard([{ x: 300, y: 300, color: 'yellow' }]);
    openEditor(a);
    typeChars(editor(), 'a sentence');
    clickBackground();
    expect(snapshot(doc)).toHaveLength(1);
    clickOn(a); // selected again, so the note's own toolbar is up
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Green colour'));
    flush();
    expect(colorOf(a)).toBe('green');

    expect(undo.undo()).toBe(true);
    expect(colorOf(a)).toBe('yellow');
    expect(textOf(a)).toBe('a sentence'); // the typing stands on its own

    expect(undo.undo()).toBe(true);
    expect(textOf(a)).toBe('');
    expect(colorOf(a)).toBe('yellow');
    expect(undo.canUndo()).toBe(false); // no half-written step was left behind
  });

  it('select-all and Delete is one step for everything, and the undo after it touches nobody else\u2019s text', () => {
    const [a, colleague, c] = mountBoard([
      { text: 'mine', x: 300, y: 300 },
      { text: 'written by a colleague', x: 700, y: 300, color: 'green' },
      { text: 'also mine', x: 300, y: 620, color: 'blue' },
    ]);
    const board = () =>
      snapshot(doc)
        .map((n) => `${n.text}|${n.color}|${n.x},${n.y}`)
        .sort()
        .join('\n');
    const untouched = board();

    fireKey('a', window, { ctrl: true });
    flush();
    expect(selected()).toHaveLength(3);

    fireKey('Delete');
    flush();
    expect(snapshot(doc)).toHaveLength(0); // three objects gone in one action
    expect(selected()).toHaveLength(0);

    expect(undo.undo()).toBe(true); // one press brings all three back together
    expect(board()).toBe(untouched);

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false); // and there is nothing else of mine to press
    expect(textOf(colleague)).toBe('written by a colleague');
    expect(textOf(a)).toBe('mine');
    expect(textOf(c)).toBe('also mine');
  });

  it('a nudge and a delete pressed straight after each other are two steps', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300 }]);
    const start = where(a);

    clickOn(a);
    fireKey('ArrowRight');
    flush();
    const nudged = where(a);
    expect(nudged.x).not.toBe(start.x); // it did move

    fireKey('Delete'); // one after the other, inside the same capture window
    flush();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true); // the deletion is the last thing I did
    expect(snapshot(doc)).toHaveLength(1);
    expect(where(a)).toEqual(nudged); // and it comes back where I had left it
    expect(undo.undo()).toBe(true); // the nudge is the step before that
    expect(where(a)).toEqual(start);
    expect(undo.canUndo()).toBe(false);
  });

  it('two colours picked one after the other are two steps', () => {
    const [a] = mountBoard([{ text: 'X', x: 300, y: 300, color: 'yellow' }]);

    clickOn(a);
    fireEvent.click(screen.getByLabelText('Green colour'));
    flush();
    fireEvent.click(screen.getByLabelText('Blue colour'));
    flush();
    expect(colorOf(a)).toBe('blue');

    expect(undo.undo()).toBe(true);
    expect(colorOf(a)).toBe('green');
    expect(undo.undo()).toBe(true);
    expect(colorOf(a)).toBe('yellow');
    expect(undo.canUndo()).toBe(false);
  });

  it('creating a note with the tool is one step', () => {
    mountBoard([{ text: 'X', x: 300, y: 300 }]);
    const before = snapshot(doc).map((o) => o.id).sort();

    fireEvent.click(screen.getByTestId('sticky-note-tool'));
    flush();
    expect(snapshot(doc)).toHaveLength(before.length + 1);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).map((o) => o.id).sort()).toEqual(before);
    expect(undo.canUndo()).toBe(false);
  });
});
