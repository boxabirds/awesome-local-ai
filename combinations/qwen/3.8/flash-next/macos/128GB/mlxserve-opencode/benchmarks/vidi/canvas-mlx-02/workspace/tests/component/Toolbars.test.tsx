import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  renderBoard,
  createViaToolbar,
  escape,
  notePos,
  colorOf,
  hex,
} from './stickyTestUtils.tsx';
import { Toolbar } from '../../src/client/board/Toolbar.tsx';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar.tsx';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model.ts';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.ts';

describe('toolbars (sticky.toolbar)', () => {
  // TC-27: clicking a colour swatch recolours the selected note and keeps the
  // selection.
  it('TC-27 recolours the selected note and keeps selection', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    expect(h.note(0).getAttribute('data-selected')).toBe('true');
    const posBefore = notePos(h.note(0));

    fireEvent.click(h.view.getByTestId('swatch-pink'));

    expect(colorOf(h.note(0))).toBe(hex('pink'));
    expect(h.note(0).getAttribute('data-selected')).toBe('true');
    // position unchanged by a colour change
    expect(notePos(h.note(0))).toEqual(posBefore);
  });

  // TC-28: the toolbar button creates one note centred on the visible area and
  // starts editing it.
  it('TC-28 creates one centred note in edit mode', () => {
    const h = renderBoard();
    createViaToolbar(h);

    expect(h.notes()).toHaveLength(1);
    // Fresh App camera is the reset camera, so the viewport centre is world (0,0);
    // the note's top-left is therefore -STICKY_SIZE_WORLD / 2.
    const pos = notePos(h.note(0));
    expect(pos.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 1);
    expect(pos.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 1);
    expect(h.editor()).toBeTruthy();
    expect(document.activeElement).toBe(h.editor());
  });

  // TC-29: the bin button deletes the note and clears the selection.
  it('TC-29 deletes the note and clears the selection', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    expect(h.view.queryByTestId('note-toolbar')).toBeTruthy();

    fireEvent.click(h.view.getByTestId('note-delete'));

    expect(h.notes()).toHaveLength(0);
    expect(h.view.queryByTestId('note-toolbar')).toBeNull();
  });

  // The Sticky note button is reachable by keyboard and has the required
  // accessible name and tooltip.
  it('the create button has an accessible name and tooltip', () => {
    renderBoard();
    const btn = screen.getByRole('button', { name: 'Sticky note' });
    expect(btn.getAttribute('title')).toBe('Sticky note – or double-click the board');
  });

  // Swatches are distinguishable by name, not only by colour.
  it('swatches expose a colour name and pressed state', () => {
    const onColor = vi.fn();
    render(<NoteToolbar color="yellow" onColor={onColor} onDelete={() => {}} />);
    const pink = screen.getByRole('button', { name: 'pink colour' });
    expect(pink.getAttribute('aria-pressed')).toBe('false');
    const yellow = screen.getByRole('button', { name: 'yellow colour' });
    expect(yellow.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pink);
    expect(onColor).toHaveBeenCalledWith('pink');
  });

  // Toolbar creation is wired to onCreateSticky (world-centre handled by App).
  it('Toolbar invokes onCreateSticky', () => {
    const onCreate = vi.fn();
    render(<Toolbar onCreateSticky={onCreate} />);
    fireEvent.click(screen.getByTestId('sticky-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  // Creating at the viewport centre through a far-panned camera still centres the
  // note in the visible area (world centre equals the panned camera centre).
  it('createSticky honours an arbitrary centre point in the model', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 1234, y: -500 });
    const s = snapshot(doc)[0];
    expect(s.id).toBe(id);
    expect(s.x).toBeCloseTo(1234 - STICKY_SIZE_WORLD / 2, 6);
    expect(s.y).toBeCloseTo(-500 - STICKY_SIZE_WORLD / 2, 6);
  });
});
