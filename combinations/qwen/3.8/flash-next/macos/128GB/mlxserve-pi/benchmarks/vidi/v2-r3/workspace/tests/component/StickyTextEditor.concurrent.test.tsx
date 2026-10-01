// Story 3, `sync.client`: a change that arrives while somebody is typing.
//
// This is where a story-3 bug would show up as something personal: the
// characters a person typed, gone. The textarea is a DOM node whose value is
// also somebody else's document, so three things have to hold and none of them
// are stated by the merge rules — an arriving change has to *appear*, the caret
// must not be thrown away by it, and an input method in mid-word must not be
// cut short or have its word overwritten.
//
// The other person here is a second `Y.Doc` connected by hand, because what is
// under test is this side of the wire: what the editor does with an update that
// came from elsewhere. (That the update itself is identical on both sides is
// the room's own tests' business.)
import { act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSticky, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import {
  createNote,
  flushFrame,
  noteEl,
  pressOn,
  releaseOn,
  renderBoard,
  setNoteText,
  textareaEl,
  typeInto,
} from './helpers';

let doc: Doc;
let peer: Doc;
let id: string;

/** Another browser on the same board: the same updates, arriving by hand. */
function connectPeer(mine: Doc): Doc {
  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine));
  const relay = Symbol('peer.relay');
  mine.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== relay) Y.applyUpdate(theirs, update, relay);
  });
  theirs.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== relay) Y.applyUpdate(mine, update, relay);
  });
  return theirs;
}

// A change from the other side of the board reaches this document inside a
// socket callback, which React has no part in; in a test the nearest thing to
// that is the update arriving inside act(), so that the repaint it causes
// happens when the test says so rather than whenever React gets round to it.
function peerWrites(what: () => void): void {
  act(() => {
    what();
  });
}

/** The other person replaces the note's text. */
function peerSetsText(text: string): void {
  peerWrites(() => {
    const ytext = getStickyText(peer, id);
    if (ytext === undefined) throw new Error('the peer does not have this note');
    Y.transact(
      peer,
      () => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, text);
      },
      'peer',
    );
  });
}

/** The other person adds characters at one offset and keeps the rest. */
function peerInsertsAt(offset: number, text: string): void {
  peerWrites(() => {
    const ytext = getStickyText(peer, id);
    if (ytext === undefined) throw new Error('the peer does not have this note');
    Y.transact(peer, () => ytext.insert(offset, text), 'peer');
  });
}

function startEditing(): HTMLTextAreaElement {
  pressOn(noteEl(id), 100, 100);
  releaseOn(noteEl(id), 100, 100);
  fireEvent.keyDown(window, { key: 'Enter' });
  return textareaEl();
}

const textOf = (where: Doc): string => snapshot(where).find((note) => note.id === id)?.text ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
  peer = connectPeer(doc);
  id = createNote(doc, 0, 0);
  setNoteText(doc, id, 'green');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a change that arrives while the note is open', () => {
  it('appears in the editor, in the document, and nowhere else', () => {
    const editor = startEditing();
    expect(editor.value).toBe('green');

    peerInsertsAt(5, ' blue');

    // It is on screen: the person is looking at the note when the change lands,
    // and it has appeared while they were looking at it.
    expect(editor.value).toBe('green blue');
    // It is in the document, and it is the only version of it.
    expect(textOf(doc)).toBe('green blue');
    expect(textOf(peer)).toBe('green blue');
    // The note is still one note, still the same note.
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('is the only note that is drawn when the other person adds one', () => {
    startEditing();
    // A second note appears on the board, created by the other person: the only
    // change this side gets is an update, and the note is there.
    let other = '';
    peerWrites(() => {
      other = createSticky(peer, { x: 20, y: 20 });
    });
    expect(snapshot(doc).map((note) => note.id).sort()).toEqual([id, other].sort());
  });

  it('leaves the caret the same distance from the end of the text', () => {
    const editor = startEditing();
    editor.focus();
    // The caret is two characters from the end of "green": between the "r" and
    // the "e", which is where this person's next keystroke would go. (jsdom
    // does not move a caret with arrow keys, so it is put where the person
    // would have moved it.)
    editor.setSelectionRange(3, 3);
    const fromEnd = editor.value.length - editor.selectionStart;
    expect(fromEnd).toBe(2);

    // The other person adds a word at the start of the line.
    peerInsertsAt(0, 'very ');

    expect(editor.value).toBe('very green');
    // The caret has come with the text: still two characters from the end, not
    // back at the beginning and not at the end.
    expect(editor.value.length - editor.selectionStart).toBe(fromEnd);
  });

  it('does not interrupt a word being composed, and keeps both words afterwards', () => {
    const editor = startEditing();
    editor.focus();

    // The person is mid-word with an input method: the text on screen is not
    // theirs yet, it is the input method's.
    fireEvent.compositionStart(editor);
    typeInto(editor, 'green红');
    expect(textOf(doc)).toBe('green');

    // A change arrives from the other side of the board in the middle of it.
    peerInsertsAt(5, ' blue');
    expect(textOf(doc)).toBe('green blue');

    // The composition is not cut short and not replaced: the screen still shows
    // what the input method was showing.
    expect(editor.value).toBe('green红');

    // The word is finished. Both people's text is in the document, in one order,
    // and the editor shows that order.
    fireEvent.compositionEnd(editor, { data: '红' });
    const both = textOf(doc);
    expect(both).toContain('green');
    expect(both).toContain('红');
    expect(both).toContain('blue');
    expect(textOf(peer)).toBe(both);
    expect(editor.value).toBe(both);
  });

  it('keeps the characters a person typed when the other side deletes the note under them', () => {
    const editor = startEditing();
    typeInto(editor, 'green and growing');
    expect(textOf(doc)).toBe('green and growing');

    // The note is deleted elsewhere while the text is in the editor.
    peerWrites(() => deleteObject(peer, id));
    flushFrame();

    // Nothing throws, the note is gone from this side too, and the text this
    // person typed is not left behind anywhere.
    expect(snapshot(doc)).toHaveLength(0);
    expect(() => textareaEl()).toThrow();
    expect(textOf(doc)).toBe('');
  });

  it('shows the text as the room has it when a change arrives and the person is not typing', () => {
    const editor = startEditing();
    peerSetsText('a whole new note');
    expect(editor.value).toBe('a whole new note');
    expect(textOf(doc)).toBe('a whole new note');
  });
});

