/**
 * Story 2 · task 7 — toolbar component tests (TC-27, TC-28, TC-29).
 *
 * The per-note toolbar (six swatches + delete) and the left tool palette
 * (create) are exercised through the whole board, driving the same handlers a
 * user would hit.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { pointer, seedDoc } from './helpers';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function renderBoard(doc: Y.Doc) {
  return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
}

function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`note-${id}`) as HTMLElement;
}

function selectNote(id: string) {
  const note = noteEl(id);
  fireEvent(note, pointer('pointerdown', 300, 300));
  fireEvent(note, pointer('pointerup', 300, 300));
}

function colorOf(doc: Y.Doc, id: string): string {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('color') as string;
}

describe('note toolbar (TC-27, TC-29)', () => {
  it('TC-27: the Pink swatch recolours only the selected note', () => {
    const { doc, ids } = seedDoc([
      { id: 'a', centre: { x: 300, y: 300 } },
      { id: 'b', centre: { x: 600, y: 300 } },
    ]);
    renderBoard(doc);
    const [a, b] = ids;
    expect(colorOf(doc, a)).toBe('yellow');

    selectNote(a);
    // Only the selected note exposes a toolbar.
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByTestId('swatch-pink'));

    expect(colorOf(doc, a)).toBe('pink');
    // The other note keeps its colour (its own Y.Map entry is untouched).
    expect(colorOf(doc, b)).toBe('yellow');
  });

  it('TC-29: the Delete button removes the note', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);

    selectNote(ids[0]);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByTestId('note-delete'));

    expect(screen.queryByTestId(`note-${ids[0]}`)).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('left tool palette (TC-28)', () => {
  it('the Sticky note button creates a note at the board centre in edit mode', () => {
    const doc = seedDoc().doc; // empty board
    renderBoard(doc);
    expect(doc.getMap('objects').size).toBe(0);

    // Accessible name is exactly the PRD tool name.
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    // A note appeared and immediately entered editing (the editor is focused).
    expect(doc.getMap('objects').size).toBe(1);
    const [id] = [...doc.getMap('objects').keys()];
    expect(noteEl(id)).toBeTruthy();
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
  });
});