// Component tests for sticky note text editing (sticky.text):
// TC-23, TC-24, TC-26, TC-38.

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppAt } from './render-app';

function notes(): Array<{ id: string; x: number; y: number; color: string; text: string; z: number }> {
  return window.__vidi6?.getStickyNotes() ?? [];
}

function windowKey(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.text', () => {
  it('TC-23: Enter on a selected note starts Editing; textarea focused with caret at text end', async () => {
    await renderAppAt();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    // Type a bit of text, then end editing.
    fireEvent.change(screen.getByTestId('sticky-editor-input'), { target: { value: 'Hello' } });
    fireEvent.keyDown(screen.getByTestId('sticky-editor-input'), { key: 'Escape' });
    expect(notes()[0].text).toBe('Hello');
    expect(screen.queryByTestId('sticky-editor-input')).toBeNull(); // no longer editing

    windowKey('Enter');

    const ta = screen.getByTestId('sticky-editor-input') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(5); // caret at the end of the existing text
  });

  it('TC-24: Escape → Selected; typed text preserved', async () => {
    await renderAppAt();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.change(screen.getByTestId('sticky-editor-input'), { target: { value: 'Hello' } });
    fireEvent.keyDown(screen.getByTestId('sticky-editor-input'), { key: 'Escape' });

    expect(screen.queryByTestId('sticky-editor-input')).toBeNull();
    const note = screen.getByTestId('sticky-note');
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(notes()[0].text).toBe('Hello');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-26: Backspace while editing text does not delete the note; the text is edited', async () => {
    await renderAppAt();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const ta = screen.getByTestId('sticky-editor-input');
    fireEvent.change(ta, { target: { value: 'a' } });
    fireEvent.change(ta, { target: { value: 'ab' } });

    // Backspace deletes the character inside the text (the note stays).
    fireEvent.keyDown(ta, { key: 'Backspace' });
    fireEvent.change(ta, { target: { value: 'a' } });

    expect(notes()).toHaveLength(1);
    expect(notes()[0].text).toBe('a');
  });

  it('TC-38: type text then blur → editor unmounted, Y.Text has the text, note stays Selected', async () => {
    await renderAppAt();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const ta = screen.getByTestId('sticky-editor-input');
    fireEvent.change(ta, { target: { value: 'abc' } });

    // Blurring the editor ends editing (story 7: blur keeps the selection,
    // like Escape; a separate empty-board click is what clears it).
    act(() => {
      ta.blur();
    });

    expect(screen.queryByTestId('sticky-editor-input')).toBeNull();
    expect(notes()[0].text).toBe('abc');
    // Blur → Selected: outline stays, and the single-sticky bar is the NoteToolbar.
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });
});
