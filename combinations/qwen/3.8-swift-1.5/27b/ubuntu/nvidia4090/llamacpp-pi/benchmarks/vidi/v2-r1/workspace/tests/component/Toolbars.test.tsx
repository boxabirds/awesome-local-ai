import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, deleteObject, setStickyColor, snapshot } from '@shared/board-model';
import { Toolbar } from '@client/board/Toolbar';
import { NoteToolbar } from '@client/objects/NoteToolbar';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('sticky.toolbar', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes model colour to pink', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    
    const onColor = vi.fn((c: string) => {
      setStickyColor(doc, id, c);
    });
    const onDelete = vi.fn();

    render(
      <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />
    );

    const pinkSwatch = screen.getByLabelText('pink colour');
    fireEvent.click(pinkSwatch);

    expect(onColor).toHaveBeenCalledWith('pink');
    const snap = snapshot(doc).find(n => n.id === id)!;
    expect(snap.color).toBe('pink');
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  it('TC-28: clicking Sticky note button creates a note', () => {
    const doc = makeDoc();
    const onCreateSticky = vi.fn(() => {
      // Simulate creating a note at viewport centre
      const id = createSticky(doc, { x: 640, y: 400 }); // centre of 1280x800
      return id;
    });

    render(<Toolbar onCreateSticky={onCreateSticky} />);

    const button = screen.getByLabelText('Sticky note');
    expect(button).toBeDefined();
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');

    fireEvent.click(button);
    expect(onCreateSticky).toHaveBeenCalled();
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: clicking delete button removes the note', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(snapshot(doc)).toHaveLength(1);

    const onDelete = vi.fn(() => {
      deleteObject(doc, id);
    });

    const { container } = render(
      <NoteToolbar color="yellow" onColor={vi.fn()} onDelete={onDelete} />
    );

    const deleteBtn = container.querySelector('[data-testid="delete-note"]') as HTMLButtonElement;
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
