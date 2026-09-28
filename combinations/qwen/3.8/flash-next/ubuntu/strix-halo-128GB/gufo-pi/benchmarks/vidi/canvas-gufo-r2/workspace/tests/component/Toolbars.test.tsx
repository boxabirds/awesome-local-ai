/**
 * Component (jsdom) tests for toolbars: TC-27, TC-28, TC-29.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function flushFrames(count = 3): void {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function getNote(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

describe('toolbars', () => {
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
    flushFrames();
  }

  function selectNote(id: string) {
    const el = noteEl(id);
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 500, clientY: 400 });
  }

  describe('TC-27: colour swatch changes colour, selection kept', () => {
    it('clicks Pink swatch -> model colour pink, selection preserved', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      selectNote(id);
      const pinkButton = screen.getByRole('button', { name: 'Pink colour' });
      fireEvent.click(pinkButton);
      const note = getNote(doc, id)!;
      expect(note.color).toBe('pink');
      // Selection preserved
      expect(noteEl(id).getAttribute('data-selected')).toBe('true');
      // Position unchanged
      expect(note.x).toBe(500 - STICKY_SIZE_WORLD / 2);
      expect(note.y).toBe(400 - STICKY_SIZE_WORLD / 2);
    });
  });

  describe('TC-28: sticky note button creates a centred note in Editing mode', () => {
    it('clicks Sticky note button -> one note in viewport centre, Editing', () => {
      setup();
      mount();
      const createButton = screen.getByRole('button', { name: 'Sticky note' });
      fireEvent.click(createButton);
      const snaps = snapshot(doc);
      expect(snaps).toHaveLength(1);
      const el = noteEl(snaps[0].id);
      expect(el.getAttribute('data-editing')).toBe('true');
    });
  });

  describe('TC-29: bin button deletes the note, clears selection', () => {
    it('clicks Delete note -> note removed, selection cleared', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      selectNote(id);
      const deleteButton = screen.getByRole('button', { name: 'Delete note' });
      fireEvent.click(deleteButton);
      expect(getNote(doc, id)).toBeUndefined();
      expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    });
  });

  describe('note toolbar hidden while editing', () => {
    it('does not render note toolbar while editing', () => {
      setup();
      const id = createSticky(doc, { x: 500, y: 400 });
      mount();
      selectNote(id);
      // Double-click to enter editing
      const el = noteEl(id);
      fireEvent.doubleClick(el);
      // Note toolbar should not be rendered
      expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    });
  });
});
