import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.ts';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model.ts';

function firePointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });
}

let doc: Y.Doc;
let id: string;

function selectNote() {
  firePointer(document.querySelector(`[data-note-id="${id}"]`)!, 'pointerdown', 150, 150);
  firePointer(document.querySelector(`[data-note-id="${id}"]`)!, 'pointerup', 150, 150);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.toolbar', () => {
  it('TC-27 clicking the Pink swatch recolours and keeps the selection', () => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 400, y: 300 });
    render(<BoardApp doc={doc} />);
    selectNote();
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(snapshot(doc).find((n) => n.id === id)!.color).toBe('pink');
    expect(document.querySelector(`[data-note-id="${id}"]`)!.getAttribute('data-selected')).toBe(
      'true',
    );
  });

  it('TC-28 the Sticky note button creates one note centred in the viewport, editing', () => {
    doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp doc={doc} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const half = STICKY_SIZE_WORLD / 2;
    // Default viewport is 1280x800, camera at origin → centre world (640,400).
    expect(notes[0]!.x).toBe(640 - half);
    expect(notes[0]!.y).toBe(400 - half);
    expect(screen.getByTestId('sticky-text-editor')).toBeInTheDocument();
  });

  it('TC-29 the bin button deletes the note and clears the selection', () => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createSticky(doc, { x: 400, y: 300 });
    render(<BoardApp doc={doc} />);
    selectNote();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });
});
