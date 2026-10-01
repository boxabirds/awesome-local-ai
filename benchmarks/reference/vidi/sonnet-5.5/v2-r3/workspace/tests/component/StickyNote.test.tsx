import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { createSticky, deleteObject, initDoc } from '../../src/shared/board-model';
import { clickEmptyBoard, clickNote, createByDblClick, flush, moveTo, notes, press, release, viewport } from './helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** App with one unselected, non-editing note. */
function withNote() {
  render(<App />);
  const created = createByDblClick();
  clickEmptyBoard();
  expect(created.dataset.selected).toBe('false');
  expect(created.dataset.editing).toBe('false');
  return created;
}

const style = (el: HTMLElement) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), z: el.style.zIndex });
const readCamera = () => screen.getByTestId('board-world').style.transform;

describe('StickyNote interaction', () => {
  it('TC-18 press and release selects: outline and toolbar', () => {
    const note = withNote();
    clickNote(note);
    expect(note.dataset.selected).toBe('true');
    expect(note.style.outline).toContain('solid');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Green colour' })).toBeTruthy();
  });

  it('TC-19 moving 2px stays a click (no drag, no restack)', () => {
    const note = withNote();
    const before = style(note);
    press(note, 100, 100);
    moveTo(note, 102, 100);
    flush();
    release(note, 102, 100);
    expect(note.dataset.selected).toBe('true');
    expect(style(note)).toEqual(before);
  });

  it('TC-20 moving exactly 3px drags the note and never pans the board', () => {
    const note = withNote();
    const before = style(note);
    const camera = readCamera();
    press(note, 100, 100);
    moveTo(note, 103, 100);
    flush();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull(); // toolbar hidden while dragging
    moveTo(note, 150, 130);
    flush();
    expect(style(note).left).toBe(before.left + 50);
    expect(style(note).top).toBe(before.top + 30);
    release(note, 150, 130);
    expect(readCamera()).toBe(camera);
    expect(note.dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('dragging brings the note above the others', () => {
    render(<App />);
    const a = createByDblClick(300, 300);
    clickEmptyBoard();
    const b = createByDblClick(500, 300);
    clickEmptyBoard();
    expect(Number(a.style.zIndex)).toBeLessThan(Number(b.style.zIndex));
    press(a, 0, 0);
    moveTo(a, 20, 0);
    flush();
    release(a, 20, 0);
    expect(Number(a.style.zIndex)).toBeGreaterThan(Number(b.style.zIndex));
  });

  it('TC-21 pointercancel keeps the last applied position and selects', () => {
    const note = withNote();
    const start = style(note);
    press(note, 100, 100);
    moveTo(note, 140, 100);
    flush();
    fireEvent.pointerCancel(note, { pointerId: 1 });
    moveTo(note, 400, 400);
    flush();
    expect(style(note).left).toBe(start.left + 40);
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const note = withNote();
    clickNote(note);
    clickEmptyBoard();
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s removes the selected note', (key) => {
    const note = withNote();
    clickNote(note);
    fireEvent.keyDown(window, { key });
    expect(notes()).toHaveLength(0);
    expect(note.isConnected).toBe(false);
  });

  it('TC-35 double-click on a note edits it and creates no new note', () => {
    const note = withNote();
    fireEvent.doubleClick(note);
    expect(notes()).toHaveLength(1);
    expect(note.dataset.editing).toBe('true');
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const note = withNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(notes()).toHaveLength(1);
    expect(note.dataset.editing).toBe('false');
  });

  it('TC-37 note deleted mid-drag ends the interaction silently', () => {
    const note = withNote();
    press(note, 100, 100);
    moveTo(note, 150, 100);
    flush();
    // Delete via the document model, as another client would.
    const del = () => fireEvent.keyDown(window, { key: 'Delete' });
    del(); // selected by drag start, not editing
    expect(() => {
      moveTo(note, 200, 100);
      flush();
      release(note, 200, 100);
    }).not.toThrow();
    expect(notes()).toHaveLength(0);
  });

  it('TC-37 note removed from the document while editing ends editing and is not re-created', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    function Harness() {
      const { notes: list } = useBoardDoc(doc);
      const sel = useSelection();
      useEffect(() => {
        sel.startEdit(id);
      }, []);
      return (
        <>
          {list.map((n) => (
            <StickyNote
              key={n.id}
              note={n}
              doc={doc}
              zoom={1}
              selected={sel.selectedId === n.id}
              editing={sel.editingId === n.id}
              onSelect={sel.select}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          ))}
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(() => act(() => void deleteObject(doc, id))).not.toThrow();
    expect(notes()).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(notes()).toHaveLength(0);
  });

  it('double-click on empty space creates a yellow note centred there, in edit mode', () => {
    render(<App />);
    const note = createByDblClick(400, 300);
    // jsdom viewport 1024x768 with the camera centred on the origin: world = screen - (512, 384).
    expect(style(note).left).toBe(400 - 512 - 100);
    expect(style(note).top).toBe(300 - 384 - 100);
    expect(note.dataset.color).toBe('yellow');
    expect(note.dataset.editing).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(viewport()).toBeTruthy();
  });
});
