import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import {
  initDoc,
  createSticky,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model.ts';

function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

// jsdom's PointerEvent carries no clientX; dispatch a MouseEvent of the pointer
// type instead (React delegates by event name and coordinates arrive correctly).
function firePointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}

function fireKey(key: string) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

function worldView(): { scale: number; tx: number; ty: number } {
  const t = screen.getByTestId('world-layer').style.transform;
  const s = /scale\(([-\d.]+)\)/.exec(t);
  const tr = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t);
  return { scale: Number(s?.[1]), tx: Number(tr?.[1]), ty: Number(tr?.[2]) };
}

let doc: Y.Doc;
let id: string;

function setup(x = 400, y = 300) {
  doc = new Y.Doc();
  initDoc(doc);
  id = createSticky(doc, { x, y }); // top-left = (x-100, y-100)
  render(<BoardApp doc={doc} />);
}

function noteEl(): HTMLElement {
  return document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
}
function pos(idArg: string) {
  return snapshot(doc).find((n) => n.id === idArg)!;
}
function selectNote() {
  firePointer(noteEl(), 'pointerdown', 150, 150);
  firePointer(noteEl(), 'pointerup', 150, 150);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.interaction', () => {
  it('TC-18 press + release without moving selects: outline + note toolbar shown', () => {
    setup();
    selectNote();
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-19 move 2px (below threshold) selects but does NOT moveObject', () => {
    setup();
    const before = pos(id);
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointermove', 152, 150);
    firePointer(noteEl(), 'pointerup', 152, 150);
    flush();
    const after = pos(id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(noteEl().getAttribute('data-selected')).toBe('true');
  });

  it('TC-20 move 3px (at threshold) drags; the board camera is unchanged', () => {
    setup();
    const before = pos(id);
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointermove', 153, 150); // +3 world (zoom 1)
    flush();
    const after = pos(id);
    expect(after.x).toBeCloseTo(before.x + 3, 6);
    // Dragging must not pan the board: camera stays at the initial view.
    const v = worldView();
    expect(v.scale).toBeCloseTo(1, 6);
    expect(v.tx).toBeCloseTo(0, 6);
    expect(v.ty).toBeCloseTo(0, 6);
    expect(screen.getByTestId('nav-hint')).toBeInTheDocument();
  });

  it('TC-21 pointercancel during a drag keeps the last applied position', () => {
    setup();
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointermove', 153, 150);
    flush();
    firePointer(noteEl(), 'pointermove', 160, 150); // pending +10, not yet flushed
    firePointer(noteEl(), 'pointercancel', 160, 150);
    flush();
    const after = pos(id);
    // The last pointer was at +10 world from the drag start (top-left x 300).
    expect(after.x).toBeCloseTo(310, 6);
    expect(noteEl().getAttribute('data-selected')).toBe('true');
  });

  it('TC-22 clicking empty board clears the selection and the toolbar', () => {
    setup();
    selectNote();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 40, 40);
    firePointer(vp, 'pointerup', 40, 40);
    flush();
    expect(noteEl().getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('TC-25 Delete on a selected (non-editing) note removes it', () => {
    setup();
    selectNote();
    fireKey('Delete');
    flush();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('TC-25b Backspace on a selected (non-editing) note removes it', () => {
    setup();
    selectNote();
    fireKey('Backspace');
    flush();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-35 double-clicking an existing note edits it and creates no new note', () => {
    setup();
    act(() => {
      noteEl().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-text-editor')).toBeInTheDocument();
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp doc={doc} />);
    fireKey('Enter');
    flush();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
  });

  it('TC-37 a note deleted via the model mid-drag ends the interaction, no recreation', () => {
    setup();
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointermove', 153, 150); // drag started
    flush();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
        vi.advanceTimersByTime(48);
      });
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });

  it('TC-37b a note deleted via the model mid-edit ends editing, no recreation', () => {
    setup();
    selectNote();
    fireKey('Enter'); // start editing
    expect(screen.getByTestId('sticky-text-editor')).toBeInTheDocument();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
        vi.advanceTimersByTime(48);
      });
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
  });
});
