/**
 * Component: the board document reacting to changes that come off the wire, and
 * an editor reacting while you are typing in it.
 *
 * TC-24 a note somebody else deleted goes, and does not come back ·
 * TC-25 a note you deleted stays gone when the wire repeats the delete ·
 * TC-23 text arriving while nobody is editing it ·
 * TC-26/TC-27 text arriving *while you are typing in the same note*: it shows up,
 * the caret rides along, and the next keystroke keeps it. (Before the textarea
 * followed the shared text, a keystroke diffed a value that was missing the other
 * person's typing and deleted it.)
 *
 * The app, the document and the sync protocol are real; only the transport is the
 * stand-in room from `setup.ts`.
 */

import * as Y from 'yjs';
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import {
  clickNote,
  dblClickNote,
  flushFrames,
  noteEl,
  renderApp,
  seedNoteWithText,
  textareaFor,
} from './stickyHarness';
import { standInRoom } from './standInRoom';

afterEach(cleanup);

/** Apply a change to the doc the way an update arriving from the room does. */
function remote(doc: Y.Doc, mutate: (doc: Y.Doc) => void): void {
  act(() => {
    doc.transact(() => mutate(doc), Symbol('from the room'));
  });
  flushFrames();
}

function textOf(doc: Y.Doc, id: string): Y.Text {
  const text = getStickyText(doc, id);
  if (!text) throw new Error(`note ${id} has no text`);
  return text;
}

/** One keystroke at the caret, the way the browser produces it. */
function press(el: HTMLTextAreaElement, char: string): void {
  act(() => {
    el.setRangeText(char, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  flushFrames();
}

/**
 * Let queued work run: the stand-in socket completes its handshake on a microtask,
 * so a test that wants to see the room's side of things has to let those run.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  flushFrames();
}

function noteCount(): number {
  return document.querySelectorAll('[data-note-id]').length;
}

describe('the board reacting to the wire', () => {
  function boardWith(...texts: string[]) {
    const doc = renderApp();
    const ids = texts.map((text, index) => seedNoteWithText(doc, text, { x: index * 300, y: 0 }));
    return { doc, ids };
  }

  it('TC-24: a note deleted by somebody else disappears from this screen', () => {
    const { doc, ids } = boardWith('mine');
    expect(noteCount()).toBe(1);

    remote(doc, () => deleteObject(doc, ids[0]!));

    expect(noteCount()).toBe(0);
  });

  it('TC-24: and it does not come back when the rest of the board changes', async () => {
    const doc = renderApp();
    await settle();
    const id = seedNoteWithText(doc, 'gone soon');
    act(() => deleteObject(doc, id));
    flushFrames();
    expect(noteCount()).toBe(0);

    // Somebody else adds a note. Their update arrives, and does not resurrect the
    // one that was deleted.
    let added = '';
    act(() => {
      standInRoom.someoneElsesChange((roomDoc) => {
        added = createSticky(roomDoc, { x: 10, y: 10 });
      });
    });
    await settle();

    expect(added).not.toBe('');
    expect(snapshot(doc).map((note) => note.id)).toEqual([added]);
    expect(noteCount()).toBe(1);
  });

  it('TC-25: a note you deleted stays deleted when the wire repeats the delete', () => {
    const { doc, ids } = boardWith('doomed');

    act(() => deleteObject(doc, ids[0]!));
    flushFrames();
    expect(noteCount()).toBe(0);

    // ...and the same delete arriving back from the room afterwards.
    remote(doc, () => deleteObject(doc, ids[0]!));
    expect(noteCount()).toBe(0);
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-25: a note you deleted does not reappear after a full state exchange', () => {
    const { doc, ids } = boardWith('doomed');
    act(() => deleteObject(doc, ids[0]!));
    flushFrames();

    // The room sends everything it holds, as it does to somebody who connects
    // later. The delete is part of the shared history, so nothing re-adds the note.
    const fromTheRoom = standInRoom.stateAsUpdate();
    act(() => {
      Y.applyUpdate(doc, fromTheRoom, Symbol('from the room'));
    });
    flushFrames();
    expect(snapshot(doc)).toEqual([]);
    expect(noteCount()).toBe(0);
  });

  it('TC-23: text that arrives while nobody is editing shows up', () => {
    const { doc, ids } = boardWith('start');

    remote(doc, () => textOf(doc, ids[0]!).insert(5, ' shared'));

    expect(noteEl(ids[0]!).textContent).toContain('start shared');
  });

  it('TC-15: a wire update to one note does not re-create the others', () => {
    const { doc, ids } = boardWith('one', 'two');
    const first = noteEl(ids[0]!);

    remote(doc, () => setStickyColor(doc, ids[1]!, 'purple'));
    remote(doc, () => moveObject(doc, ids[0]!, 12, 8));

    expect(noteEl(ids[0]!)).toBe(first);
    expect(snapshot(doc).find((note) => note.id === ids[0]!)?.x).toBe(12);
  });
});

describe('text arriving while you are editing it', () => {
  function boardWithNoteInEditor(text: string) {
    const doc = renderApp();
    const id = seedNoteWithText(doc, text);
    clickNote(id);
    dblClickNote(id);
    const el = textareaFor(id);
    if (!el) throw new Error('the note did not open its editor');
    return { doc, id, el };
  }

  it('shows up in the editor, rides the caret along, and survives the next keystroke', () => {
    const { doc, id, el } = boardWithNoteInEditor('first');

    expect(el.value).toBe('first');
    expect(el.selectionStart).toBe(5);

    // The other person types at the start of the same note.
    remote(doc, () => textOf(doc, id).insert(0, 'shared '));

    expect(el.value).toBe('shared first');
    expect(el.selectionStart).toBe(12);

    // My next keystroke goes where my caret is, and does not erase their text.
    press(el, '!');
    expect(el.value).toBe('shared first!');
    expect(textOf(doc, id).toString()).toBe('shared first!');
  });

  it('keeps every character when both people type alternately', () => {
    const doc = renderApp();
    const id = createStickyAndWait(doc);
    clickNote(id);
    dblClickNote(id);
    const el = textareaFor(id)!;

    for (const char of 'abc') press(el, char);
    remote(doc, () => textOf(doc, id).insert(1, 'xy'));
    press(el, 'd');

    expect([...textOf(doc, id).toString()].sort().join('')).toBe('abcdxy');
    expect(el.value).toBe(textOf(doc, id).toString());
  });

  it('leaves the caret at the start of the change when text is replaced under it', () => {
    const { doc, id, el } = boardWithNoteInEditor('say hello');

    // Park the caret in the middle of "hello".
    act(() => el.setSelectionRange(7, 7));
    remote(doc, () => {
      const text = textOf(doc, id);
      text.delete(4, 5);
      text.insert(4, 'goodbye');
    });

    expect(el.value).toBe('say goodbye');
    expect(el.selectionStart).toBe(4);
  });
});

/** Create an empty note and let the screen catch up. */
function createStickyAndWait(doc: Y.Doc): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
  });
  flushFrames();
  return id;
}
