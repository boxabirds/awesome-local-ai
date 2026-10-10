/**
 * live.merge where it is easiest to get wrong: one note, open in an editor on
 * this screen, with somebody else's characters arriving from the room while the
 * caret is inside it. TC-23 proves the whole path in the browser; this proves
 * the editor itself takes those characters in, keeps them when it types on, and
 * does not park the caret at the end of the line.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import {
  dispatchKey,
  noteById,
  pointerEvent,
  renderStickyBoard,
  seedSticky,
  textOf,
} from './helpers/board';
import { getStickyText } from '../../src/shared/board-model';

const NOTE = { x: 400, y: 300 };
const INSIDE = { x: NOTE.x + 50, y: NOTE.y + 50 };

let doc: YDoc;
let id: string;

beforeEach(() => {
  doc = new Doc();
  id = seedSticky(doc, { ...NOTE, text: 'green' });
  renderStickyBoard(doc);
});

afterEach(cleanup);

function textarea(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
}

/** An `input` event carrying the whole string, like a browser does. */
function type(value: string): void {
  fireEvent.change(textarea(), { target: { value } });
}

/** Start editing the seeded note; the caret ends up at the end of 'green'. */
function startEditing(): HTMLTextAreaElement {
  const note = noteById(id);
  pointerEvent('pointerDown', note, INSIDE);
  pointerEvent('pointerUp', note, INSIDE);
  dispatchKey({ key: 'Enter' });
  return textarea();
}

/**
 * Another person in the room: a second document holding the same board, typing
 * into the same note, whose change comes back as an update. The origin stands
 * for the websocket message that carried it — anything but this client's own
 * typing, that is.
 */
function remoteChange(at: number, text: string): void {
  const other = new Doc();
  applyUpdate(other, encodeStateAsUpdate(doc));
  const theirs = getStickyText(other, id);
  if (!theirs) throw new Error('the other person cannot see the note');
  theirs.insert(at, text);
  act(() => {
    applyUpdate(doc, encodeStateAsUpdate(other), 'room');
  });
}

describe('live.merge: typing in a note other people are typing in (TC-23)', () => {
  it('takes their characters in, keeps them, and does not move the caret past them', () => {
    const area = startEditing();
    type('green');
    expect(area.value).toBe('green');
    expect(area.selectionStart).toBe(5);

    remoteChange(5, ' blue'); // their word lands after this caret

    expect(area.value).toBe('green blue');
    expect([area.selectionStart, area.selectionEnd]).toEqual([5, 5]);

    // Typing on from here is an input event on the merged string, so their
    // characters are in it: nothing of theirs can be destroyed.
    type('green blu');
    expect(textOf(doc, id)).toBe('green blu');
    expect(area.value).toBe('green blu');
  });

  it('moves the caret along with what arrives in front of it', () => {
    const area = startEditing();
    remoteChange(0, 'red '); // their word lands in front of this caret

    expect(area.value).toBe('red green');
    expect(area.selectionStart).toBe(9);
    type('red greenx'); // typing at the caret
    expect(textOf(doc, id)).toBe('red greenx');
    expect(area.selectionStart).toBe(10);
  });

  it('keeps a selection that their change did not touch where it was', () => {
    const area = startEditing();
    area.setSelectionRange(0, 5);
    remoteChange(5, 'x');

    expect(area.value).toBe('greenx');
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, 5]);
  });

  it('moves a selection that their text landed in front of, instead of leaving it behind', () => {
    const area = startEditing();
    area.setSelectionRange(2, 5); // 'een'
    remoteChange(1, 'ab'); // their text lands in front of this selection
    expect(area.value).toBe('gabreen');
    expect([area.selectionStart, area.selectionEnd]).toEqual([4, 7]); // still 'een'
  });

  it('shrinks a selection when their change deleted text under it', () => {
    const area = startEditing();
    area.setSelectionRange(2, 5); // 'een'
    const other = new Doc();
    applyUpdate(other, encodeStateAsUpdate(doc));
    const theirs = getStickyText(other, id);
    if (!theirs) throw new Error('the other person cannot see the note');
    theirs.delete(3, 2); // they remove 'en', keeping 'gre'
    act(() => {
      applyUpdate(doc, encodeStateAsUpdate(other), 'room');
    });
    expect(area.value).toBe('gre');
    expect(area.selectionStart).toBe(2);
    expect(area.selectionEnd).toBe(3); // what is left of 'een' is 'e'
  });
});
