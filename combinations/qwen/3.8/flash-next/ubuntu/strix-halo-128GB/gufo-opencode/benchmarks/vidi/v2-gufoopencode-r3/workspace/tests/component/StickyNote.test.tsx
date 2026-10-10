import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  snapshot
} from '../../src/shared/board-model';
import { worldTransform } from './helpers';
import { initialCamera } from './helpers';

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc, x = 0, y = 0, text = ''): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y });
    if (text !== '') getStickyText(doc, id)!.insert(0, text);
  });
  return id;
}

function noteAt(i = 0): HTMLElement {
  return screen.getAllByTestId('sticky-note')[i];
}

function tap(el: HTMLElement, x = 100, y = 100): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.note (StickyNote)', () => {
  it('TC-18 click selects the note and shows the note toolbar', () => {
    const doc = mount();
    addNote(doc);
    tap(noteAt());
    expect(noteAt()).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-19 2px press-release selects without moving (below threshold)', () => {
    const doc = mount();
    const id = addNote(doc, 10, 20);
    const el = noteAt();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 102, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 102, clientY: 100, pointerId: 1 });
    vi.advanceTimersByTime(100);
    expect(snapshot(doc)[0]).toMatchObject({ id, x: -90, y: -80 });
    expect(noteAt()).toHaveAttribute('data-selected', 'true');
  });

  it('TC-20 dragging a note never pans the camera and moves it by the pointer delta / zoom', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    const cam0 = initialCamera();
    expect(screen.getByTestId('world-layer').style.transform).toBe(worldTransform(cam0));

    const el = noteAt();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 103, clientY: 104, pointerId: 1 });
    vi.advanceTimersByTime(100);
    expect(snapshot(doc)[0]).toMatchObject({ id, x: -97, y: -96 });
    expect(screen.getByTestId('world-layer').style.transform).toBe(worldTransform(cam0));

    fireEvent.pointerUp(el, { clientX: 103, clientY: 104, pointerId: 1 });
    expect(snapshot(doc)[0]).toMatchObject({ x: -97, y: -96 });
  });

  it('TC-21 pointercancel mid-drag keeps last applied position and selects', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0);
    const el = noteAt();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 110, clientY: 100, pointerId: 1 });
    vi.advanceTimersByTime(100);
    expect(snapshot(doc)[0]).toMatchObject({ id, x: -90, y: -100 });
    fireEvent.pointerMove(el, { clientX: 118, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(el, { pointerId: 1 });
    vi.advanceTimersByTime(100);
    // The pending (not yet applied) move is discarded; the last applied stays.
    expect(snapshot(doc)[0]).toMatchObject({ x: -90, y: -100 });
    expect(noteAt()).toHaveAttribute('data-selected', 'true');
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const doc = mount();
    addNote(doc);
    tap(noteAt());
    expect(noteAt()).toHaveAttribute('data-selected', 'true');
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(noteAt()).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('TC-25 Delete and Backspace remove the selected note; nothing selected → no-op', () => {
    const doc = mount();
    addNote(doc);
    tap(noteAt());
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);

    const id = addNote(doc, 50, 50);
    tap(noteAt());
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    void id;

    // Nothing selected: keys do nothing and must not throw.
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-35 double-click on a note edits it and creates no new note', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0, 'keep');
    fireEvent.doubleClick(noteAt());
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    expect(snapshot(doc)[0]).toMatchObject({ id, x: -100, y: -100 });
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const doc = mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  it('TC-37 note deleted via the model mid-drag or mid-edit leaves no exceptions', () => {
    const doc = mount();
    const id = addNote(doc, 0, 0, 'a');
    const el = noteAt();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 110, clientY: 100, pointerId: 1 });
    vi.advanceTimersByTime(100);
    act(() => {
      deleteObject(doc, id);
    });
    expect(() => {
      fireEvent.pointerMove(el, { clientX: 120, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(el, { clientX: 120, clientY: 100, pointerId: 1 });
      vi.advanceTimersByTime(100);
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);

    const id2 = addNote(doc, 30, 30, 'b');
    fireEvent.doubleClick(noteAt());
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    act(() => {
      deleteObject(doc, id2);
    });
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
