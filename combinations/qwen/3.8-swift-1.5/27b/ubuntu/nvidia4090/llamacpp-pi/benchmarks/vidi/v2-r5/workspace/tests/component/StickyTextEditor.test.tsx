// @vitest-environment jsdom
// tests/component/StickyTextEditor.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { App } from '../../src/client/App';

// Mock the API so BoardPage's existence check resolves immediately
vi.mock('../../src/client/api', () => ({
  checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }),
  createBoardRequest: vi.fn(),
}));

// Define pointer capture methods for jsdom
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

beforeEach(() => {
  cleanup();
  window.history.pushState(null, '', '/b/testboardid1234567890a');
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(() => {});
});

describe('sticky.text (component)', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  describe('TC-23: Enter starts editing', () => {
    it('Enter on selected note starts editing with textarea focused', async () => {
      render(<App />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      
      // Create a note
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // End editing (the note starts in edit mode)
      act(() => {
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
      });
      
      // Select the note
      const note = screen.getAllByRole('group', { name: 'Sticky note' })[0];
      act(() => {
        fireEvent.pointerDown(note, { pointerId: 1 });
        fireEvent.pointerUp(note, { pointerId: 1 });
      });
      
      // Press Enter to start editing
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
      
      // Textarea should be present and focused
      const editor = screen.getByTestId('sticky-text-editor');
      expect(editor).toBeDefined();
      expect(document.activeElement).toBe(editor);
    });
  });

  // TC-24: Escape → Selected, text preserved
  describe('TC-24: Escape ends editing', () => {
    it('Escape ends editing and preserves text', async () => {
      render(<App />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      
      // Create a note (starts in editing mode)
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // Type some text
      const editor = screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
      act(() => {
        fireEvent.input(editor, { target: { value: 'Hello world' } });
      });
      
      // Press Escape
      act(() => {
        fireEvent.keyDown(editor, { key: 'Escape' });
      });
      
      // Editor should be gone
      expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
      
      // Note should still be present with the text
      const note = screen.getAllByRole('group', { name: 'Sticky note' })[0];
      expect(note.textContent).toContain('Hello world');
    });
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  describe('TC-26: Backspace while editing', () => {
    it('Backspace edits text, does not delete note', async () => {
      render(<App />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      
      // Create a note (starts in editing mode)
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // Type 'ab'
      const editor = screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
      act(() => {
        fireEvent.input(editor, { target: { value: 'ab' } });
      });
      
      // Press Backspace (should delete 'b', not the note)
      act(() => {
        fireEvent.keyDown(editor, { key: 'Backspace' });
      });
      
      // Note should still be present
      expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
      
      // Editor should still be present (still editing)
      expect(screen.getByTestId('sticky-text-editor')).toBeDefined();
    });
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  describe('TC-38: type then click outside', () => {
    it('clicking outside ends editing and unmounts editor', async () => {
      render(<App />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      
      // Create a note (starts in editing mode)
      const createBtn = screen.getByTestId('create-sticky-btn');
      act(() => { fireEvent.click(createBtn); });
      
      // Type 'abc'
      const editor = screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
      act(() => {
        fireEvent.input(editor, { target: { value: 'abc' } });
      });
      
      // Click on the board viewport (outside the note)
      const viewport = screen.getByTestId('board-viewport');
      act(() => {
        fireEvent.pointerDown(viewport, { pointerId: 1 });
      });
      
      // Editor should be unmounted
      expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
      
      // Note should still have the text
      const note = screen.getAllByRole('group', { name: 'Sticky note' })[0];
      expect(note.textContent).toContain('abc');
    });
  });
});
