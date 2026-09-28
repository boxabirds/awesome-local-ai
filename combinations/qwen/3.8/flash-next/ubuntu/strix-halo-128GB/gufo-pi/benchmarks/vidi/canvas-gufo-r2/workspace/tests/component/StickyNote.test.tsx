/**
 * Component (jsdom) tests for sticky note interaction: TC-18 to TC-26, TC-35 to TC-37.
 *
 * A real Y.Doc is the store (design mandates real Yjs everywhere).
 * jsdom has no layout: screen px map 1:1 to world px at zoom 1 (deltas only matter).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import {
  createSticky,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function notesOf(doc: Y.Doc) {
  return snapshot(doc);
}

function getNote(doc: Y.Doc, id: string) {
  return notesOf(doc).find((n) => n.id === id);
}

describe('sticky note interaction', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    cleanup();
    doc.destroy();
  });

  function mount() {
    render(<App doc={doc} />);
  }

  describe('TC-18: select without drag', () => {
    it('press+release without move selects the note, shows toolbar', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
      expect(el.getAttribute('data-selected')).toBe('true');
      expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    });
  });

  describe('TC-19: move below threshold selects, no moveObject', () => {
    it('moves 2px (< DRAG_THRESHOLD_PX): stays Selected, note does not move', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      const before = getNote(doc, id)!;
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 + 2, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500 + 2, clientY: 400 });
      const after = getNote(doc, id)!;
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(el.getAttribute('data-selected')).toBe('true');
    });
  });

  describe('TC-20: move beyond threshold drags', () => {
    it('moves 3px (= threshold): Dragging starts, board camera unchanged', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const cameraBefore = snapshot(doc); // model positions snapshot
      const boardBefore = screen.getByTestId('board').dataset;
      const camX = boardBefore.cameraX;
      const camY = boardBefore.cameraY;
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 + DRAG_THRESHOLD_PX, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500 + DRAG_THRESHOLD_PX, clientY: 400 });
      // Board camera must be unchanged (no pan)
      const boardAfter = screen.getByTestId('board').dataset;
      expect(boardAfter.cameraX).toBe(camX);
      expect(boardAfter.cameraY).toBe(camY);
      // The note should have moved by 3 world units (at zoom 1)
      const after = getNote(doc, id)!;
      expect(after.x).toBeGreaterThan(cameraBefore.find((n) => n.id === id)!.x);
    });
  });

  describe('TC-21: pointercancel during drag keeps last position', () => {
    it('drags then cancels, note stays at last position', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 + 50, clientY: 400 });
      fireEvent.pointerCancel(el, { pointerId: 1, clientX: 500 + 50, clientY: 400 });
      const after = getNote(doc, id)!;
      expect(after.x).toBeGreaterThan(500 - 100); // moved right from the -100 start (centered)
    });
  });

  describe('TC-22: click empty board clears selection', () => {
    it('clicks empty board after selection -> Unselected, toolbar gone', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
      expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

      // Click empty board area. Note stops propagation, so empty click reaches the viewport.
      const board = screen.getByTestId('board');
      fireEvent.pointerDown(board, { button: 0, pointerId: 2, clientX: 900, clientY: 700 });
      fireEvent.pointerUp(board, { pointerId: 2, clientX: 900, clientY: 700 });
      expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    });
  });

  describe('TC-25: Delete/Backspace remove selected note', () => {
    it.each(['Delete', 'Backspace'])('presses %s', (key) => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.keyDown(window, { key });
      expect(getNote(doc, id)).toBeUndefined();
    });
  });

  describe('TC-26: Backspace while editing edits text, not the note', () => {
    it("Backspace in editing mode with text 'ab' leaves 'a'", () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      // Pre-fill text via Y.Text
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
      ytext.insert(0, 'ab');
      mount();
      // Select the note
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
      // Enter editing via dblclick
      fireEvent.doubleClick(el);
      const textarea = el.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();
      // Position caret at end and press backspace
      textarea.setSelectionRange(2, 2);
      fireEvent.keyDown(textarea, { key: 'Backspace' });
      // Simulate browser deleting the char: set value and fire input
      fireEvent.input(textarea, { target: { value: 'a' } });
      expect(getNote(doc, id)).toBeDefined(); // note still present
      expect(getNote(doc, id)!.text).toBe('a');
    });
  });

  describe('TC-35: dblclick existing note -> edit, not create', () => {
    it('double-clicking an existing note does not create a new one', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.doubleClick(el);
      // Still only one note
      expect(notesOf(doc)).toHaveLength(1);
      // The existing note is now in editing state
      expect(el.getAttribute('data-editing')).toBe('true');
    });
  });

  describe('TC-36: Enter with nothing selected -> no note created', () => {
    it('pressing Enter with no selection creates nothing', () => {
      mount();
      expect(notesOf(doc)).toHaveLength(0);
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(notesOf(doc)).toHaveLength(0);
    });
  });

  describe('TC-37: note deleted via model while dragging or editing', () => {
    it('editing note deleted externally -> interaction ends, no exception, no recreate', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.doubleClick(el);
      expect(screen.queryByTestId('sticky-counter')).not.toBeInTheDocument();
      // Delete it via the model
      act(() => {
        deleteObject(doc, id);
      });
      // Should not crash and note should stay deleted
      expect(getNote(doc, id)).toBeUndefined();
      // Further typing (via stale textarea if still mounted) should not crash
      expect(() => {
        fireEvent.keyDown(window, { key: 'a' });
      }).not.toThrow();
      expect(getNote(doc, id)).toBeUndefined();
    });

    it('dragging note deleted externally -> drag ends, no exception, no recreate', () => {
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const el = noteEl(id);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 500 + 20, clientY: 400 });
      // Delete via model
      act(() => {
        deleteObject(doc, id);
      });
      expect(() => {
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 500 + 20, clientY: 400 });
      }).not.toThrow();
      expect(getNote(doc, id)).toBeUndefined();
    });
  });
});
