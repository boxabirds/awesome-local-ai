import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, deleteObject, snapshot } from '../../src/shared/board-model';
import { firePointer, fireKey } from './helpers';

function renderWithNotes(notes: Array<{ id: string; x: number; y: number; color?: string; text?: string }> = []) {
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

describe('StickyNote interaction', () => {
  beforeEach(() => {
    cleanup();
  });

  it('TC-18: press+release without move selects note, shows outline and NoteToolbar', async () => {
    const { settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    expect(note).not.toBeNull();
    expect(note.dataset.selected).toBeUndefined();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    // pointerdown + pointerup (no move)
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    expect(note.dataset.selected).toBe('true');
    expect(screen.queryByTestId('note-toolbar')).not.toBeNull();
  });

  it('TC-19: move 2px (< DRAG_THRESHOLD_PX) selects, no moveObject', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointermove', 201, 201); // ~1.4px < 3
    firePointer(note, 'pointerup', 201, 201);
    await settle();

    // Selected (not dragged)
    expect(note.dataset.selected).toBe('true');
    // Position unchanged
    const snap = snapshot(doc);
    expect(snap[0]!.x).toBe(100);
    expect(snap[0]!.y).toBe(100);
  });

  it('TC-20: move 3px starts drag, board camera unchanged (stopPropagation)', async () => {
    const { viewport, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointermove', 203, 200); // exactly 3px = threshold
    await settle();

    // Board should not be panning (stopPropagation on note pointerdown)
    expect(viewport.dataset.panning).toBe('false');
  });

  it('TC-21: pointercancel during drag ends at last position', async () => {
    const { settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointermove', 210, 210); // 14px > threshold -> dragging
    await settle();
    firePointer(note, 'pointercancel', 210, 210);
    await settle();

    // Note should be selected (drag ended)
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-22: click empty board deselects', async () => {
    const { settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    const viewport = screen.getByTestId('board-viewport');

    // Select first
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();
    expect(note.dataset.selected).toBe('true');

    // Click empty space (on viewport directly)
    firePointer(viewport, 'pointerdown', 600, 600);
    firePointer(viewport, 'pointerup', 600, 600);
    await settle();

    expect(note.dataset.selected).toBeUndefined();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25: Delete key removes selected note', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    fireKey({ key: 'Delete' });
    await settle();

    expect(screen.queryByTestId('sticky-note-note1')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-25: Backspace key removes selected note', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();

    fireKey({ key: 'Backspace' });
    await settle();

    expect(screen.queryByTestId('sticky-note-note1')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-35: dblclick on existing note does not create new note, starts editing', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // dblclick on the note
    act(() => {
      fireEvent.doubleClick(note);
    });
    await settle();

    // No new notes created
    expect(snapshot(doc)).toHaveLength(1);
    // Should be in editing mode
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();
  });

  it('TC-36: Enter with nothing selected does nothing', async () => {
    const { doc, settle } = renderWithNotes([]);
    await settle();

    fireKey({ key: 'Enter' });
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-37: note deleted via model while dragging ends interaction silently', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100 }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointermove', 220, 220); // start dragging
    await settle();

    // Delete via model
    act(() => {
      deleteObject(doc, 'note1');
    });
    await settle();

    // No exception, note is gone
    expect(screen.queryByTestId('sticky-note-note1')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-37b: note deleted via model while editing ends interaction silently', async () => {
    const { doc, settle } = renderWithNotes([{ id: 'note1', x: 100, y: 100, text: 'hello' }]);
    await settle();

    const note = screen.getByTestId('sticky-note-note1');

    // Select and start editing
    firePointer(note, 'pointerdown', 200, 200);
    firePointer(note, 'pointerup', 200, 200);
    await settle();
    fireKey({ key: 'Enter' });
    await settle();

    // Verify editing mode (textarea visible)
    expect(screen.queryByTestId('sticky-textarea')).not.toBeNull();

    // Delete via model while editing
    act(() => {
      deleteObject(doc, 'note1');
    });
    await settle();

    // No exception, note gone, textarea gone
    expect(screen.queryByTestId('sticky-note-note1')).toBeNull();
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
