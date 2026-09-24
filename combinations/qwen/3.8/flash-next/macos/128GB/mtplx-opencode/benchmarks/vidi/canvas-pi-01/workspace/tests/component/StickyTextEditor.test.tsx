/**
 * Story 2 · task 7 — text editing component tests (TC-23, TC-24, TC-26,
 * TC-38) in jsdom against a real `Y.Doc`.
 *
 * jsdom performs no text editing on keydown and lays nothing out, so where a
 * scenario is really "keystroke, then the resulting text", we drive the
 * textarea's change/input event with the post-keystroke value (the shape a
 * browser hands us) and assert on the resulting `Y.Text`. Whether a key
 * reaches the note at all is exercised for real by the Playwright suite.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function pressEnter() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/** Select a note then press Enter to enter edit mode. */
function enterEditing(id: string) {
  selectNote(id);
  pressEnter();
}

function ytextOf(doc: Y.Doc, id: string): Y.Text {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('text') as Y.Text;
}

describe('editor lifecycle (TC-23, TC-24)', () => {
  it('TC-23: Enter on a selected note opens the editor, focused with caret at the end', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 }, text: 'Retro' }]);
    renderBoard(doc);

    selectNote(ids[0]);
    expect(noteEl(ids[0]).dataset.selected).toBe('true');
    pressEnter();

    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('Retro');
    // Caret is moved to the end (collapsed, not selected-all).
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);
  });

  it('TC-24: Escape returns to read mode with the text unchanged', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 }, text: 'one\ntwo\nthree' }]);
    renderBoard(doc);

    enterEditing(ids[0]);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('one\ntwo\nthree');

    fireEvent.keyDown(editor, { key: 'Escape' });

    // Back to read mode ...
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    // ... and the shared text is untouched (no mutation written on exit).
    expect(ytextOf(doc, ids[0]).toString()).toBe('one\ntwo\nthree');
    expect(noteEl(ids[0])).toBeTruthy();
  });
});

describe('keyboard belongs to text while editing (TC-26)', () => {
  it('Backspace edits characters and only deletes when not editing', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 }, text: 'ab' }]);
    renderBoard(doc);

    // Being edited: Backspace must not remove the note (window handler skips
    // typing targets / editing state).
    enterEditing(ids[0]);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    act(() => {
      editor.setSelectionRange(2, 2);
    });
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(noteEl(ids[0])).toBeTruthy();
    expect(doc.getMap('objects').size).toBe(1);

    // The resulting text change arrives as an input/change event.
    fireEvent.change(editor, { target: { value: 'a' } });
    expect(ytextOf(doc, ids[0]).toString()).toBe('a');

    // Not being edited: Backspace removes the selected note.
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('click outside commits (TC-38)', () => {
  it('double-click creates an editing note; clicking outside commits and unmounts', () => {
    const doc = seedDoc().doc; // empty board
    renderBoard(doc);
    const surface = screen.getByTestId('board-viewport');

    // Double-click empty surface → a note is created at that world point and
    // immediately enters edit mode.
    fireEvent(surface, new MouseEvent('dblclick', { bubbles: true, clientX: 400, clientY: 300 }));
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
    const created = [...doc.getMap('objects').keys()];
    expect(created).toHaveLength(1);
    const id = created[0];

    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'abc' } });
    expect(ytextOf(doc, id).toString()).toBe('abc');

    // Click a point that is not the note → commit, unmount, unselect.
    fireEvent(surface, pointer('pointerdown', 50, 50));
    fireEvent(surface, pointer('pointerup', 50, 50));

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(ytextOf(doc, id).toString()).toBe('abc');
    expect(noteEl(id).dataset.selected).toBe('false');
  });
});