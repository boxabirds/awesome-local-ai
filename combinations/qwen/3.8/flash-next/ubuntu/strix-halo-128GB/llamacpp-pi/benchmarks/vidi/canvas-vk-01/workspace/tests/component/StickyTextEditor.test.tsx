import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, getStickyText } from '../../src/shared/board-model';
import { firePointer, fireKey } from './helpers';

function renderWithNotes(notes: Array<{ id: string; x: number; y: number; text?: string }> = []) {
  const doc = new Y.Doc();
  initDoc(doc);

  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  for (const n of notes) {
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', n.x);
      map.set('y', n.y);
      map.set('color', 'yellow');
      map.set('text', new Y.Text(n.text ?? ''));
      map.set('z', 1);
      map.set('createdAt', Date.now());
      objects.set(n.id, map);
    });
  }

  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    viewport: screen.getByTestId('board-viewport'),
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
  };
}

describe('StickyTextEditor', () => {
  beforeEach(() => {
    cleanup();
  });

  it('TC-23: Enter on selected starts editing, textarea focused, caret at end', async () => {
    const { settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100, text: 'hello' }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select the note
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    // Press Enter
    fireKey({ key: 'Enter' });
    await settle();

    // Textarea should appear
    const textarea = screen.queryByTestId('sticky-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    // Caret at end
    expect(textarea!.selectionStart).toBe(5);
    expect(textarea!.selectionEnd).toBe(5);
  });

  it('TC-24: Escape ends editing, text preserved', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100, text: 'hello world' }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select and start editing
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();
    fireKey({ key: 'Enter' });
    await settle();

    let textarea = screen.queryByTestId('sticky-textarea');
    expect(textarea).not.toBeNull();

    // Press Escape
    act(() => {
      fireEvent.keyDown(textarea!, { key: 'Escape' });
    });
    await settle();

    // Textarea should be gone
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    // Text preserved in doc
    const ytext = getStickyText(doc, 'note1');
    expect(ytext!.toString()).toBe('hello world');
    // Still selected
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-26: Backspace while editing edits text, does not delete note', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100, text: 'ab' }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select and start editing
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();
    fireKey({ key: 'Enter' });
    await settle();

    const textarea = screen.queryByTestId('sticky-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // Simulate backspace: set value to 'a' and fire input
    act(() => {
      textarea!.value = 'a';
      fireEvent.input(textarea!);
    });
    await settle();

    // Note still exists
    expect(screen.queryByTestId('sticky-note-note1')).not.toBeNull();
    // Text is 'a'
    const ytext = getStickyText(doc, 'note1');
    expect(ytext!.toString()).toBe('a');
  });

  it('TC-38: type "abc" then click outside -> editor unmounted, Y.Text is "abc", unselected', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    const viewport = screen.getByTestId('board-viewport');

    // Select and start editing
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();
    fireKey({ key: 'Enter' });
    await settle();

    const textarea = screen.queryByTestId('sticky-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // Type 'abc'
    act(() => {
      textarea!.value = 'abc';
      fireEvent.input(textarea!);
    });
    await settle();

    // Click outside
    firePointer(viewport, 'pointerdown', 600, 600);
    firePointer(viewport, 'pointerup', 600, 600);
    await settle();

    // Editor should be gone
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    // Text in doc
    const ytext = getStickyText(doc, 'note1');
    expect(ytext!.toString()).toBe('abc');
    // Unselected
    expect(note.dataset.selected).toBeUndefined();
  });
});
