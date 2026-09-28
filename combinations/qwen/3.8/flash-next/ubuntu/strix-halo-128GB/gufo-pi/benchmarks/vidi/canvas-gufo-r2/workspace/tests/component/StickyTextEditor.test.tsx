/**
 * Component (jsdom) tests for sticky text editor: TC-23, TC-24, TC-38.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function getNote(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

describe('sticky text editor', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    if (doc) doc.destroy();
    vi.useRealTimers();
  });

  function setup() {
    doc = new Y.Doc();
  }

  function mount() {
    render(<App doc={doc} />);
  }

  function selectNote(id: string) {
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
    return el;
  }

  function enterEditing(id: string) {
    const el = noteEl(id);
    fireEvent.doubleClick(el);
    // Flush the setTimeout inside StickyTextEditor that installs the document pointerdown listener
    act(() => { vi.advanceTimersByTime(5); });
    return el.querySelector('textarea') as HTMLTextAreaElement;
  }

  describe('TC-23: Enter on selected starts editing, caret at end', () => {
    it('presses Enter on a selected note with existing text, textarea focused, caret at end', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
      ytext.insert(0, 'hello');
      mount();
      selectNote(id);
      // Press Enter to start editing
      fireEvent.keyDown(window, { key: 'Enter' });
      const el = noteEl(id);
      const textarea = el.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();
      // Note is editing
      expect(el.getAttribute('data-editing')).toBe('true');
      // caret at end (jsdom setSelectionRange works)
      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });
  });

  describe('TC-24: Escape ends editing, text preserved', () => {
    it('types text, presses Escape, text remains and state is Selected', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const textarea = enterEditing(id);
      // Type via fireEvent.input on textarea (React controlled value)
      fireEvent.change(textarea, { target: { value: 'my note text' } });
      // Now press Escape
      fireEvent.keyDown(textarea, { key: 'Escape' });
      // Text preserved
      expect(getNote(doc, id)!.text).toBe('my note text');
      // Note no longer editing but still selected
      const el = noteEl(id);
      expect(el.getAttribute('data-editing')).not.toBe('true');
      expect(el.getAttribute('data-selected')).toBe('true');
    });
  });

  describe('TC-38: type abc, click outside -> editor unmounted, text kept, Unselected', () => {
    it('unmounts editor, Y.Text is "abc", state Unselected', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      const textarea = enterEditing(id);
      // Flush the setTimeout that installs the outside pointerdown listener
      act(() => { vi.advanceTimersByTime(5); });
      fireEvent.change(textarea, { target: { value: 'abc' } });
      // Click outside the note: fire pointerdown on the board element (outside editor root)
      const board = screen.getByTestId('board');
      act(() => {
        board.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
      });
      // The outside handler fires onEnd('unselected')
      expect(getNote(doc, id)!.text).toBe('abc');
      const el = noteEl(id);
      expect(el.getAttribute('data-editing')).not.toBe('true');
      expect(el.getAttribute('data-selected')).not.toBe('true');
      // textarea no longer in DOM
      expect(el.querySelector('textarea')).toBeNull();
    });
  });

  describe('text counter visibility', () => {
    it('shows counter near the limit', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
      const text951 = 'x'.repeat(951);
      ytext.insert(0, text951);
      mount();
      const textarea = enterEditing(id);
      // counter should be visible (951 chars, 49 remaining, threshold 50)
      expect(screen.getByTestId('sticky-counter')).toBeInTheDocument();
      // paste 1200 chars -> clamps to 1000
      fireEvent.change(textarea, { target: { value: 'x'.repeat(1200) } });
      expect(screen.getByTestId('sticky-counter').textContent).toBe('1000/1000');
      expect(getNote(doc, id)!.text.length).toBe(1000);
    });
  });
});
