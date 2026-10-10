import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { worldToScreen } from '../../src/client/canvas/camera';
import { initialCamera } from './helpers';

// Full wiring in jsdom: real Y.Doc, real UndoManager, real gesture hook.
const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

const cam0 = initialCamera();
const s = (wx: number, wy: number) => worldToScreen(cam0, { x: wx, y: wy });

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc, cx = 0, cy = 0): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: cx, y: cy });
  });
  return id;
}

function noteAt(i = 0): HTMLElement {
  return screen.getAllByTestId('sticky-note')[i];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
}

function key(k: string, init: Record<string, unknown> = {}): boolean {
  const prevented = fireEvent.keyDown(document.body, { key: k, ...init });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  return prevented;
}

function view(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

function pos(doc: Y.Doc, id: string): { x: number; y: number } {
  const n = view(doc, id);
  return n === undefined ? { x: Number.NaN, y: Number.NaN } : { x: n.x, y: n.y };
}

function colorOf(doc: Y.Doc, id: string): string | undefined {
  return view(doc, id)?.color;
}

// Press on the note and drag it right, one rAF frame per step. The loop runs
// in a few real milliseconds, i.e. far inside UNDO_CAPTURE_TIMEOUT_MS.
function dragNote(doc: Y.Doc, id: string, dx: number, frames = 30): void {
  const n = view(doc, id);
  if (n === undefined) throw new Error('note is gone');
  const centre = s(n.x + (n.width ?? 200) / 2, n.y + (n.height ?? 200) / 2);
  fireEvent.pointerDown(noteAt(0), {
    clientX: centre.x,
    clientY: centre.y,
    pointerId: 1,
    button: 0
  });
  for (let i = 1; i <= frames; i++) {
    fireEvent.pointerMove(window, {
      clientX: centre.x + (dx * i) / frames,
      clientY: centre.y,
      pointerId: 1
    });
    act(() => {
      vi.advanceTimersByTime(16);
    });
  }
  fireEvent.pointerUp(window, { clientX: centre.x + dx, clientY: centre.y, pointerId: 1 });
}

function undoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Undo' });
}

function clickUndo(): void {
  expect(undoButton()).toBeEnabled();
  fireEvent.click(undoButton());
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.boundaries (gesture)', () => {
  it('TC-14 a 30-frame drag is a single undo step back to the start', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    dragNote(doc, id, 150);
    expect(pos(doc, id).x).toBeGreaterThan(-100);
    clickUndo();
    expect(pos(doc, id)).toEqual({ x: -100, y: -100 });
    // One step: the next undo is the note creation itself.
    clickUndo();
    expect(snapshot(doc).map((n) => n.id)).not.toContain(id);
  });

  it('TC-15 a colour change right after a drag is a second step', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    dragNote(doc, id, 150);
    const afterDrag = pos(doc, id);
    // Well inside the capture window in real time: only the gesture-end
    // boundary keeps these two changes apart.
    fireEvent.click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(colorOf(doc, id)).toBe('violet');
    clickUndo();
    expect(colorOf(doc, id)).toBe('yellow');
    expect(pos(doc, id)).toEqual(afterDrag); // the move is untouched
    clickUndo();
    expect(pos(doc, id)).toEqual({ x: -100, y: -100 });
  });

  it('TC-17 pointercancel mid-drag still leaves exactly one step', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    const n = view(doc, id);
    if (n === undefined) throw new Error('note is gone');
    const centre = s(n.x + 100, n.y + 100);
    fireEvent.pointerDown(noteAt(0), {
      clientX: centre.x,
      clientY: centre.y,
      pointerId: 1,
      button: 0
    });
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(window, { clientX: centre.x + i * 20, clientY: centre.y, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    fireEvent.pointerCancel(window, { clientX: centre.x + 100, clientY: centre.y, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    clickUndo();
    expect(pos(doc, id)).toEqual({ x: -100, y: -100 });
  });
});

describe('undo.boundaries (text editing)', () => {
  it('TC-16 Ctrl+Z inside the editor undoes the typing, not the earlier move', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    dragNote(doc, id, 150);
    const afterDrag = pos(doc, id);
    tap(noteAt(0));
    key('Enter');
    const area = screen.getByTestId('sticky-textarea');
    fireEvent.input(area, { target: { value: 'hello' } });
    expect(getStickyText(doc, id)?.toString()).toBe('hello');
    // The editor owns the key: it is default-prevented and routed to the
    // shared controller instead of the textarea's native history.
    expect(fireEvent.keyDown(area, { key: 'z', ctrlKey: true })).toBe(false);
    expect(getStickyText(doc, id)?.toString()).toBe('');
    expect(area).toHaveValue('');
    expect(pos(doc, id)).toEqual(afterDrag); // the move is not undone
  });
});
