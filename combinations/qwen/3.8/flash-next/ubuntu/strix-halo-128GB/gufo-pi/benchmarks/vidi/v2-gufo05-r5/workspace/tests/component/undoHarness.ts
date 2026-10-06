/**
 * Shared harness for the story 8 component tests.
 *
 * The app is rendered for real, so the history under test is the one the app itself made. Two
 * kinds of change are available:
 *
 * - `mine...` calls the same board model the interface calls, so the change carries
 *   `LOCAL_ORIGIN` and lands in this screen's history;
 * - `colleague()` / `theirs...` build a separate document from this one, change it there and
 *   hand the update over the way the room hands it over - a different origin, invisible to the
 *   history, exactly as in a browser.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { createPeerDoc, link, peerChange, type PeerLink } from '../unit/peer';
import { runFrames } from './helpers';

export function boardDoc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

export function notes(): readonly StickySnapshot[] {
  return window.__vidi6?.getNotes() ?? [];
}

export function noteOf(id: string): StickySnapshot {
  const found = notes().find((note) => note.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

export function noteElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

/** Where a note is, and on top of what: a move writes both. */
export function placeOf(id: string): [number, number, number] {
  const note = noteOf(id);
  return [note.x, note.y, note.z];
}

export function textOf(id: string): string {
  return getStickyText(boardDoc(), id)?.toString() ?? '';
}

/** The undo strip, in the left toolbar. */
export const undoButton = (): HTMLElement => screen.getByTestId('undo-button');
export const redoButton = (): HTMLElement => screen.getByTestId('redo-button');

// ---- changes this screen makes ----

export async function mineNote(x = 0, y = 0): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(boardDoc(), { x, y });
  });
  return id;
}

export async function mineMove(id: string, x: number, y: number): Promise<void> {
  await act(() => {
    moveObject(boardDoc(), id, x, y);
  });
}

export async function mineColor(id: string, color: StickyColor): Promise<void> {
  await act(() => {
    setStickyColor(boardDoc(), id, color);
  });
}

export async function mineDelete(id: string): Promise<void> {
  await act(() => {
    deleteObject(boardDoc(), id);
  });
}

// ---- changes a colleague makes, arriving as the room delivers them ----

/**
 * A colleague on this board: a second document, joined to the one this screen holds, whose changes
 * arrive marked as remote - which is precisely what the history must not be able to reverse.
 */
const live: PeerLink[] = [];
afterEach(() => {
  for (const handle of live.splice(0)) handle.disconnect();
});

export function colleague(): Y.Doc {
  const peer = createPeerDoc();
  const linkHandle: PeerLink = link(peer, boardDoc());
  live.push(linkHandle);
  return peer;
}

/** The colleague changes their copy; the link delivers it here as a remote change. */
export async function theirs(
  peer: Y.Doc,
  id: string,
  changed: Record<string, unknown>,
): Promise<void> {
  await act(() => {
    peerChange(peer, () => {
      const note = peer.getMap<Y.Map<unknown>>('objects').get(id);
      if (!(note instanceof Y.Map)) throw new Error(`the colleague has no note ${id}`);
      for (const [key, value] of Object.entries(changed)) {
        if (key === 'text') {
          const text = note.get('text');
          if (text instanceof Y.Text) {
            text.delete(0, text.length);
            text.insert(0, String(value));
          }
        } else {
          note.set(key, value);
        }
      }
    });
  });
}

/** The colleague deletes a note of their own. */
export async function theirsDelete(peer: Y.Doc, id: string): Promise<void> {
  await act(() => {
    peerChange(peer, () => {
      peer.getMap<Y.Map<unknown>>('objects').delete(id);
    });
  });
}

// ---- pointer ----

export const pointer = (clientX: number, clientY: number, opts: Record<string, unknown> = {}) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

/** A plain click on a note: selects it, the way pressing and releasing does. */
export async function tapNote(id: string, x = 300, y = 300): Promise<void> {
  fireEvent.pointerDown(noteElement(id), pointer(x, y));
  fireEvent.pointerUp(noteElement(id), pointer(x, y));
  await runFrames();
}

/** Press a note, move the pointer in `steps` steps, then release it - or cancel the pointer. */
export async function dragNote(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 30,
  end: 'up' | 'cancel' = 'up',
): Promise<void> {
  fireEvent.pointerDown(noteElement(id), pointer(from.x, from.y));
  await runFrames();
  for (let index = 1; index <= steps; index += 1) {
    const x = from.x + ((to.x - from.x) * index) / steps;
    const y = from.y + ((to.y - from.y) * index) / steps;
    fireEvent.pointerMove(document, pointer(x, y));
  }
  await runFrames();
  if (end === 'cancel') fireEvent.pointerCancel(document, pointer(to.x, to.y));
  else fireEvent.pointerUp(document, pointer(to.x, to.y));
  await runFrames();
}
