import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { Toolbar } from '@client/board/Toolbar';
import { NoteToolbar } from '@client/objects/NoteToolbar';
import { createSticky, setStickyColor, deleteObject, initDoc, snapshot } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';
import type { StickyColor } from '@shared/config';

describe('Toolbar', () => {
  // TC-28: Sticky note button creates a note centred on viewport centre, editing
  it('TC-28: sticky note button calls onCreateSticky', () => {
    const onCreateSticky = vi.fn();
    render(<Toolbar onCreateSticky={onCreateSticky} />);
    const btn = document.querySelector('[aria-label="Sticky note (N)"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onCreateSticky).toHaveBeenCalledTimes(1);
  });

  it('toolbar stops pointer propagation', () => {
    const parentHandler = vi.fn();
    const onCreateSticky = vi.fn();
    function TestWrapper() {
      return (
        <div onPointerDown={parentHandler}>
          <Toolbar onCreateSticky={onCreateSticky} />
        </div>
      );
    }
    render(<TestWrapper />);
    const btn = document.querySelector('[aria-label="Sticky note (N)"]') as HTMLButtonElement;
    fireEvent.pointerDown(btn, { button: 0 });
    expect(parentHandler).not.toHaveBeenCalled();
  });
});

describe('NoteToolbar', () => {
  // TC-27: Pink swatch -> model colour pink, selection kept
  it('TC-27: clicking pink swatch calls onColor with pink', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />);
    const pinkSwatch = document.querySelector('[aria-label="Pink colour"]') as HTMLButtonElement;
    expect(pinkSwatch).not.toBeNull();
    fireEvent.click(pinkSwatch);
    expect(onColor).toHaveBeenCalledWith('pink');
  });

  it('shows all 6 colour swatches', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />);
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    for (const c of colors) {
      const swatch = document.querySelector(`[aria-label="${c.charAt(0).toUpperCase() + c.slice(1)} colour"]`);
      expect(swatch).not.toBeNull();
    }
  });

  // TC-29: bin button deletes and clears selection
  it('TC-29: delete button calls onDelete', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />);
    const deleteBtn = document.querySelector('[aria-label="Delete note"]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('marks current colour as pressed', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();
    render(<NoteToolbar color="green" onColor={onColor} onDelete={onDelete} />);
    const greenSwatch = document.querySelector('[aria-label="Green colour"]');
    expect(greenSwatch?.getAttribute('aria-pressed')).toBe('true');
    const yellowSwatch = document.querySelector('[aria-label="Yellow colour"]');
    expect(yellowSwatch?.getAttribute('aria-pressed')).toBe('false');
  });

  it('note toolbar stops pointer propagation', () => {
    const parentHandler = vi.fn();
    const onColor = vi.fn();
    const onDelete = vi.fn();
    function TestWrapper() {
      return (
        <div onPointerDown={parentHandler}>
          <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />
        </div>
      );
    }
    render(<TestWrapper />);
    const deleteBtn = document.querySelector('[aria-label="Delete note"]') as HTMLButtonElement;
    fireEvent.pointerDown(deleteBtn, { button: 0 });
    expect(parentHandler).not.toHaveBeenCalled();
  });

  // Integration: model path for color + delete
  it('setStickyColor + deleteObject work together', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    setStickyColor(doc, id, 'pink');
    expect((snapshot(doc)[0] as StickySnapshot).color).toBe('pink');
    deleteObject(doc, id);
    expect(snapshot(doc).length).toBe(0);
  });
});
