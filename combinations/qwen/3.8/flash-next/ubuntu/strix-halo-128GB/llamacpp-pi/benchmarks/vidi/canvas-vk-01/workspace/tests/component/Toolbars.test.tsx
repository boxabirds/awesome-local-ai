import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { firePointer } from './helpers';

function renderWithNotes(notes: Array<{ id: string; x: number; y: number; color?: string }> = []) {
  const doc = new Y.Doc();
  initDoc(doc);

  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  for (const n of notes) {
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', n.x);
      map.set('y', n.y);
      map.set('color', n.color ?? 'yellow');
      map.set('text', new Y.Text(''));
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

describe('Toolbars', () => {
  beforeEach(() => {
    cleanup();
  });

  it('TC-27: click Pink swatch changes model colour, selection kept', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100, color: 'yellow' }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select the note
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    // Click pink swatch
    const pinkBtn = screen.getByTestId('color-pink');
    act(() => {
      fireEvent.click(pinkBtn);
    });
    await settle();

    // Model colour is pink
    const snap = snapshot(doc);
    expect(snap[0]!.color).toBe('pink');
    // Still selected
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-28: Sticky note button creates one note centred on viewport, in Editing mode', async () => {
    const { doc, settle } = renderWithNotes([]);
    await settle();

    const createBtn = screen.getByTestId('create-sticky');
    act(() => {
      fireEvent.click(createBtn);
    });
    await settle();

    // One note should exist
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    // Should be editing (textarea present)
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });

  it('TC-29: bin button deletes note, clears selection', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select the note
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    // Click delete button
    const deleteBtn = screen.getByTestId('delete-note');
    act(() => {
      fireEvent.click(deleteBtn);
    });
    await settle();

    // Note removed
    expect(screen.queryByTestId('sticky-note-note1')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    // No toolbar
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
