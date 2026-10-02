import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import {
  initDoc,
  createSticky,
  setStickyColor,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model';


describe('Toolbars', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes note colour to pink', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    const onColor = vi.fn((c: string) => {
      setStickyColor(doc, id, c);
    });
    const onDelete = vi.fn();

    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />);

    const pinkSwatch = screen.getByTestId('swatch-pink');
    fireEvent.click(pinkSwatch);

    expect(onColor).toHaveBeenCalledWith('pink');
    const snap = snapshot(doc).find((s) => s.id === id)!;
    expect(snap.color).toBe('pink');
  });

  it('TC-27: swatch has aria-pressed for current colour', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();

    render(<NoteToolbar color="green" onColor={onColor} onDelete={onDelete} />);

    const greenSwatch = screen.getByTestId('swatch-green');
    const yellowSwatch = screen.getByTestId('swatch-yellow');
    expect(greenSwatch).toHaveAttribute('aria-pressed', 'true');
    expect(yellowSwatch).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-28: Sticky note button → one note created
  it('TC-28: clicking Sticky note button calls onCreateSticky', () => {
    const onCreateSticky = vi.fn();

    render(<Toolbar onCreateSticky={onCreateSticky} />);

    const btn = screen.getByTestId('sticky-note-btn');
    expect(btn).toHaveAttribute('aria-label', 'Sticky note');
    expect(btn).toHaveAttribute('title', 'Sticky note – or double-click the board');

    fireEvent.click(btn);
    expect(onCreateSticky).toHaveBeenCalled();
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: clicking delete button removes the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    const onDelete = vi.fn(() => {
      deleteObject(doc, id);
    });

    render(<NoteToolbar color="yellow" onColor={vi.fn()} onDelete={onDelete} />);

    const deleteBtn = screen.getByTestId('delete-note-btn');
    expect(deleteBtn).toHaveAttribute('aria-label', 'Delete note');

    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });

  // Additional: NoteToolbar has all 6 swatches
  it('NoteToolbar renders all 6 colour swatches', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();

    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />);

    expect(screen.getByTestId('swatch-yellow')).toBeTruthy();
    expect(screen.getByTestId('swatch-orange')).toBeTruthy();
    expect(screen.getByTestId('swatch-green')).toBeTruthy();
    expect(screen.getByTestId('swatch-blue')).toBeTruthy();
    expect(screen.getByTestId('swatch-pink')).toBeTruthy();
    expect(screen.getByTestId('swatch-violet')).toBeTruthy();
  });
});
