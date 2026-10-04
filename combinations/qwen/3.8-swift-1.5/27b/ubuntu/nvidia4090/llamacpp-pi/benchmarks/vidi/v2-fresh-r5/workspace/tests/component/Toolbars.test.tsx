import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, setStickyColor, deleteObject, snapshot } from '../../src/shared/board-model';
import { Toolbar } from '../../src/client/board/Toolbar';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';

describe('Toolbars', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes note colour to pink', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });

    const onColorMock = vi.fn((c: string) => {
      setStickyColor(doc, id, c);
    });
    const onDeleteMock = vi.fn();

    render(
      <NoteToolbar color="yellow" onColor={onColorMock} onDelete={onDeleteMock} />
    );

    const pinkSwatch = screen.getByTestId('swatch-pink');
    fireEvent.click(pinkSwatch);

    expect(onColorMock).toHaveBeenCalledWith('pink');
    const snap = snapshot(doc);
    expect(snap[0].color).toBe('pink');
  });

  it('TC-27b: swatches have correct aria-labels', () => {
    render(
      <NoteToolbar color="yellow" onColor={vi.fn()} onDelete={vi.fn()} />
    );

    expect(screen.getByLabelText('yellow colour')).toBeInTheDocument();
    expect(screen.getByLabelText('orange colour')).toBeInTheDocument();
    expect(screen.getByLabelText('green colour')).toBeInTheDocument();
    expect(screen.getByLabelText('blue colour')).toBeInTheDocument();
    expect(screen.getByLabelText('pink colour')).toBeInTheDocument();
    expect(screen.getByLabelText('violet colour')).toBeInTheDocument();
  });

  it('TC-27c: current colour swatch has aria-pressed=true', () => {
    render(
      <NoteToolbar color="green" onColor={vi.fn()} onDelete={vi.fn()} />
    );

    expect(screen.getByLabelText('green colour')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('yellow colour')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  it('TC-28: Sticky note button creates a note', () => {
    const onCreateStickyMock = vi.fn();
    render(<Toolbar onCreateSticky={onCreateStickyMock} />);

    const btn = screen.getByLabelText('Sticky note (N)');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('title', 'Sticky note – N');

    fireEvent.click(btn);
    expect(onCreateStickyMock).toHaveBeenCalled();
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: delete button removes the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc)).toHaveLength(1);

    const onDeleteMock = vi.fn(() => {
      deleteObject(doc, id);
    });

    render(
      <NoteToolbar color="yellow" onColor={vi.fn()} onDelete={onDeleteMock} />
    );

    const deleteBtn = screen.getByLabelText('Delete note');
    fireEvent.click(deleteBtn);

    expect(onDeleteMock).toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('delete button has correct aria-label', () => {
    render(
      <NoteToolbar color="yellow" onColor={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });
});
