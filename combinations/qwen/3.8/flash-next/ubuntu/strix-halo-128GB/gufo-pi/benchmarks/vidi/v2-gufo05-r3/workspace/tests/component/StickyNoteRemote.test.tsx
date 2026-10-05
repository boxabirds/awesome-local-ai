import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, setStickyColor, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import {
  clickNote,
  noteEl,
  renderBoard,
  stubViewportSize,
  textarea,
} from './boardHarness';

stubViewportSize();

/** jsdom normalises colours to rgb(); compare against the config value. */
function rgb(hex: string): string {
  const v = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
  return `rgb(${parts.join(', ')})`;
}

/**
 * Story 3 puts this document on the network. Until then a second `Y.Doc`, joined
 * by the same handshake a provider performs, stands in for the other person: it
 * drives exactly the code path a remote update will (an incoming transaction
 * whose origin is not `LOCAL_ORIGIN`).
 */
function withPeer(): { doc: Y.Doc; peer: Y.Doc } {
  const doc = new Y.Doc();
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== peer) Y.applyUpdate(peer, update, doc);
  });
  peer.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== doc) Y.applyUpdate(doc, update, peer);
  });
  return { doc, peer };
}

describe('sticky.sync: another person editing the same note', () => {
  it('their typing appears in the open editor and both texts survive my next keystroke', () => {
    const { doc, peer } = withPeer();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const editor = textarea(container)!;
    fireEvent.change(editor, { target: { value: 'AAA' } });

    // The other person types into the same note.
    act(() => {
      getStickyText(peer, id)?.insert(0, 'BBB');
    });

    expect(editor.value).toBe('BBBAAA');
    expect(snapshot(doc)[0].text).toBe('BBBAAA');

    // My next keystroke is applied on top of theirs instead of overwriting it.
    const caret = editor.selectionStart;
    expect(caret).toBe(6);
    act(() => {
      editor.setSelectionRange(caret, caret);
      fireEvent.change(editor, { target: { value: 'BBBAAA!' } });
    });
    expect(snapshot(doc)[0].text).toBe('BBBAAA!');
    expect(getStickyText(peer, id)?.toString()).toBe('BBBAAA!');
  });

  it('their typing in the middle keeps my caret after my own text', () => {
    const { doc, peer } = withPeer();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    clickNote(noteEl(container, id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const editor = textarea(container)!;
    fireEvent.change(editor, { target: { value: 'mine' } });

    // They append to the beginning of the note.
    act(() => {
      getStickyText(peer, id)?.insert(0, 'theirs-');
    });
    expect(editor.selectionStart).toBe('mine'.length + 'theirs-'.length);
  });

  it('their colour change repaints the note without touching my selection', () => {
    const { doc, peer } = withPeer();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    const note = noteEl(container, id);
    clickNote(note);

    act(() => {
      setStickyColor(peer, id, 'green');
    });

    expect((snapshot(doc)[0] as any).color).toBe('green');
    expect(note.style.backgroundColor).toBe(rgb(STICKY_COLORS.green));
    expect(note.getAttribute('data-selected')).toBe('true');
    // The swatch row follows the shared colour.
    expect(screen.getByRole('button', { name: 'Green colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('their delete while I am typing closes the editor quietly', () => {
    const { doc, peer } = withPeer();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    clickNote(noteEl(container, id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const editor = textarea(container)!;
    fireEvent.change(editor, { target: { value: 'work in progress' } });

    act(() => {
      deleteObject(peer, id);
    });

    expect(textarea(container)).toBeNull();
    expect(container.querySelector('[data-sticky-note]')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    // Nothing is written back for the vanished note.
    expect(() => {
      act(() => {
        fireEvent.change(editor, { target: { value: 'more' } });
      });
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('their delete while I am dragging ends the drag without moving a ghost', () => {
    const { doc, peer } = withPeer();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    const note = noteEl(container, id);

    fireEvent.pointerDown(note, { clientX: 30, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 80, clientY: 60, button: 0, pointerId: 1 });

    act(() => {
      deleteObject(peer, id);
    });

    expect(container.querySelector('[data-sticky-note]')).toBeNull();
    fireEvent.pointerMove(note, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    expect(snapshot(doc)).toHaveLength(0);
  });
});
