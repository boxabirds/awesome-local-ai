// @vitest-environment jsdom
// tests/component/Toolbars.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { App } from '../../src/client/App';

// Define pointer capture methods for jsdom
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

beforeEach(() => {
  cleanup();
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

describe('sticky.toolbar (component)', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  describe('TC-27: colour swatch', () => {
    it('clicking pink swatch changes note colour and keeps selection', () => {
      render(<App />);
      
      // Create a note
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // End editing
      act(() => {
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
      });
      
      // Select the note
      const note = screen.getAllByRole('group', { name: 'Sticky note' })[0];
      act(() => {
        fireEvent.pointerDown(note, { pointerId: 1 });
        fireEvent.pointerUp(note, { pointerId: 1 });
      });
      
      // NoteToolbar should be visible
      const toolbar = screen.getByTestId('note-toolbar');
      expect(toolbar).toBeDefined();
      
      // Click the pink swatch
      const pinkSwatch = screen.getByTestId('swatch-pink');
      act(() => {
        fireEvent.click(pinkSwatch);
      });
      
      // Note should still be selected
      expect(note.hasAttribute('data-selected')).toBe(true);
      
      // The pink swatch should be pressed
      expect(pinkSwatch.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  describe('TC-28: create from toolbar button', () => {
    it('creates a note and starts editing', () => {
      render(<App />);
      
      // Click the Sticky note button
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => {
        fireEvent.click(createBtn);
      });
      
      // A note should exist
      const notes = screen.getAllByRole('group', { name: 'Sticky note' });
      expect(notes).toHaveLength(1);
      
      // Should be in editing mode
      expect(screen.getByTestId('sticky-text-editor')).toBeDefined();
    });
  });

  // TC-29: bin button → note removed, selection cleared
  describe('TC-29: delete via bin button', () => {
    it('deletes the note and clears selection', () => {
      render(<App />);
      
      // Create a note
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // End editing
      act(() => {
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
      });
      
      // Select the note
      const note = screen.getAllByRole('group', { name: 'Sticky note' })[0];
      act(() => {
        fireEvent.pointerDown(note, { pointerId: 1 });
        fireEvent.pointerUp(note, { pointerId: 1 });
      });
      
      // Click the delete button
      const deleteBtn = screen.getByTestId('delete-note-btn');
      act(() => {
        fireEvent.click(deleteBtn);
      });
      
      // Note should be gone
      expect(screen.queryAllByRole('group', { name: 'Sticky note' })).toHaveLength(0);
    });
  });
});
