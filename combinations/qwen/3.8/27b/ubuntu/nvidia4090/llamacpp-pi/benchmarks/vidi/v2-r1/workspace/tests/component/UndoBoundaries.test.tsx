// Story 8 component tests (TC-14 to TC-17): undo.boundaries wiring in jsdom
// with a real Y.Doc, the real controller (via the board page) and the story
// 7 gesture hook. y-websocket is mocked file-wide (no network traffic).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { act } from 'react';

const hoisted = vi.hoisted(() => {
  class FakeProvider {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    wsconnected = false;
    constructor(_url: string, _room: string, _doc: unknown, _opts: unknown) {}
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    destroy() {}
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: hoisted.FakeProvider }));

// Import app modules after the mock registration above (vi.mock hoists).
import { renderApp, hooks, addNote, note as noteInfo, click, dragTo, pointerUp, flushRaf } from './helpers';

function noteEl(id: string): Element {
  const el = document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`);
  if (!el) throw new Error('note not found: ' + id);
  return el;
}

function shiftClick(el: Element): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true, bubbles: true });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true, bubbles: true });
}

function undoOnce(): void {
  act(() => {
    hooks().undo();
  });
}

afterEach(() => {
  cleanup();
});

describe('undo.boundaries (component, real controller)', () => {
  it('TC-14: a 30-frame drag of a selection is one undo step restoring every object', async () => {
    await renderApp();
    const ids = [addNote(0, 0), addNote(300, 0), addNote(600, 0)];
    const start: Record<string, NonNullable<ReturnType<typeof noteInfo>>> = {};
    for (const id of ids) start[id] = noteInfo(id)!;

    // Select all three and drag the selection over 30 pointer frames.
    click(noteEl(ids[0]));
    shiftClick(noteEl(ids[1]));
    shiftClick(noteEl(ids[2]));
    dragTo(noteEl(ids[0]), 50, 30, 30);
    pointerUp(noteEl(ids[0]), 50, 30);
    await flushRaf();
    for (const id of ids) {
      expect(noteInfo(id)!.x).toBeCloseTo(start[id].x + 50);
      expect(noteInfo(id)!.y).toBeCloseTo(start[id].y + 30);
    }

    // One undo restores every object's start position.
    expect(hooks().canUndo()).toBe(true);
    undoOnce();
    for (const id of ids) {
      expect(noteInfo(id)!.x).toBeCloseTo(start[id].x);
      expect(noteInfo(id)!.y).toBeCloseTo(start[id].y);
    }
  });

  it('TC-15: a colour change right after a drag is a separate step (boundary at gesture end)', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const start = noteInfo(a)!;

    click(noteEl(a));
    dragTo(noteEl(a), 40, 0, 3);
    pointerUp(noteEl(a), 40, 0);
    await flushRaf();
    expect(noteInfo(a)!.x).toBeCloseTo(start.x + 40);

    // Recolour immediately (well inside the 500 ms capture window): the
    // gesture-end boundary must still keep this a separate step. The note
    // is still selected, so the note toolbar is on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(noteInfo(a)!.color).toBe('pink');

    // Undo 1: the colour change alone is reverted.
    undoOnce();
    expect(noteInfo(a)!.color).toBe('yellow');
    expect(noteInfo(a)!.x).toBeCloseTo(start.x + 40); // drag intact

    // Undo 2: the drag.
    undoOnce();
    expect(noteInfo(a)!.x).toBeCloseTo(start.x);
  });

  it('TC-16: Ctrl+Z inside the editor undoes the typing, not the earlier move (negative)', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const start = noteInfo(a)!;

    // Move the note, then open it for editing.
    click(noteEl(a));
    dragTo(noteEl(a), 30, 0, 3);
    pointerUp(noteEl(a), 30, 0);
    await flushRaf();
    expect(noteInfo(a)!.x).toBeCloseTo(start.x + 30);

    fireEvent.dblClick(noteEl(a));
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    editor.value = 'hello';
    fireEvent.input(editor, { target: { value: 'hello' } });
    expect(noteInfo(a)!.text).toBe('hello');

    // Ctrl+Z inside the textarea goes through the board controller.
    const notPrevented = fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(false); // the editor prevents the native undo

    // The typing is undone…
    expect(editor.value).toBe('');
    expect(noteInfo(a)!.text).toBe('');
    // …but the earlier move is not (it remains the next undo step).
    expect(noteInfo(a)!.x).toBeCloseTo(start.x + 30);
    expect(hooks().canUndo()).toBe(true);
  });

  it('TC-17: pointercancel mid-drag leaves one step that restores the start position', async () => {
    await renderApp();
    const a = addNote(0, 0);
    const start = noteInfo(a)!;

    click(noteEl(a));
    const el = noteEl(a);
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, bubbles: true });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 20, clientY: 0, bubbles: true });
    await flushRaf(); // +20 applied
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 40, clientY: 0, bubbles: true });
    await flushRaf(); // +40 applied
    fireEvent.pointerCancel(el, { pointerId: 1, clientX: 60, clientY: 0, bubbles: true });
    await flushRaf(); // the unflushed tail is dropped

    // The cancelled drag kept its last applied position…
    expect(noteInfo(a)!.x).toBeCloseTo(start.x + 40);
    // …and is exactly one undo step away from the start position.
    undoOnce();
    expect(noteInfo(a)!.x).toBeCloseTo(start.x);
    expect(noteInfo(a)!.y).toBeCloseTo(start.y);
  });
});
