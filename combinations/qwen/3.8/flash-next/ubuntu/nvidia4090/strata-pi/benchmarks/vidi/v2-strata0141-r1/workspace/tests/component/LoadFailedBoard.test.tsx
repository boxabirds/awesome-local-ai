import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import type { BoardProvider, ProviderStatus } from '../../src/client/sync/connectBoard';
import {
  boardElement,
  clickElement,
  docNotes,
  doubleClickElement,
  editorElement,
  flushFrame,
  noteElement,
  noteOf,
  noteToolbarElement,
  pressKey,
  renderBoard,
} from './harness';

/**
 * TC-23 (anchor `persist.client_status`, requirement `persist.load_failure`).
 *
 * A board the room could not load shows what it is: the message from TC-22, and
 * no way to change a document nobody was given. Every way to edit a board is
 * tried - double-click the board, the toolbar button, the Delete key on a
 * selected note, editing a note - and the document is then compared byte for
 * byte with what it was before.
 */

class FakeProvider implements BoardProvider {
  private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  private closeHandlers: ((event: { code: number } | null) => void)[] = [];

  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  on(name: 'connection-close', handler: (event: { code: number } | null) => void): void;
  on(
    name: 'status' | 'sync' | 'connection-close',
    handler:
      | ((event: { status: ProviderStatus }) => void)
      | ((synced: boolean) => void)
      | ((event: { code: number } | null) => void),
  ): void {
    if (name === 'status') {
      this.statusHandlers.push(handler as (event: { status: ProviderStatus }) => void);
    } else if (name === 'sync') {
      this.syncHandlers.push(handler as (synced: boolean) => void);
    } else {
      this.closeHandlers.push(handler as (event: { code: number } | null) => void);
    }
  }

  /** The room refused to load this board. */
  refuseToLoad(): void {
    for (const handler of this.statusHandlers) {
      handler({ status: 'connecting' });
    }
    for (const handler of this.closeHandlers) {
      handler({ code: CLOSE_BOARD_LOAD_FAILED });
    }
  }

  /** The room answered and synced: the same page is live again. */
  serves(): void {
    for (const handler of this.statusHandlers) {
      handler({ status: 'connecting' });
      handler({ status: 'connected' });
    }
    for (const handler of this.syncHandlers) {
      handler(true);
    }
  }

  destroy(): void {}
}

const CENTRE = { x: 300, y: 200 };

/** The document as one opaque blob, so "nothing changed" can be compared. */
const docBytes = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

const boardEditable = (): string | undefined =>
  screen.getByTestId('app').dataset.boardEditable;

describe('a board that could not be loaded is not editable (persist.client_status)', () => {
  it('TC-23: double-click, toolbar, Delete and editing all do nothing while the board is in load_failed', async () => {
    const doc = new Y.Doc();
    const noteId = createSticky(doc, CENTRE);
    const provider = new FakeProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();

    // Before the failure the board is editable, and this is the state every
    // later assertion is compared with.
    expect(boardEditable()).toBe('true');
    const before = docBytes(doc);
    expect(docNotes(doc).map((note) => note.id)).toContain(noteId);

    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();

    expect(screen.getByTestId('connection-status').dataset.connectionState).toBe('load_failed');
    expect(boardEditable()).toBe('false');

    // 1. Double-click the board: normally this creates a note.
    doubleClickElement(boardElement(), CENTRE.x, CENTRE.y);
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);

    // 2. The toolbar button is disabled, and clicking it anyway still changes
    //    nothing (a disabled button is not a security boundary; the guard is).
    const create = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);

    // 3. Delete on a selected note: normally this removes it.
    clickElement(noteElement(noteId), 10, 10);
    await flushFrame();
    expect(noteElement(noteId).dataset.selected).toBe('true');
    // Its own toolbar (colour, bin) is gone with it.
    expect(noteToolbarElement()).toBeNull();
    pressKey('Delete');
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);
    expect(noteOf(doc, noteId).id).toBe(noteId);

    // 4. Double-clicking the note does not open its text editor.
    doubleClickElement(noteElement(noteId), 10, 10);
    await flushFrame();
    expect(editorElement()).toBeNull();

    // 5. The note cannot be dragged either.
    fireEvent.pointerDown(noteElement(noteId), { clientX: 10, clientY: 10, pointerId: 3, button: 0 });
    fireEvent.pointerMove(noteElement(noteId), { clientX: 120, clientY: 130, pointerId: 3, button: 0 });
    fireEvent.pointerUp(noteElement(noteId), { clientX: 120, clientY: 130, pointerId: 3, button: 0 });
    await flushFrame();
    expect(noteOf(doc, noteId).x).toBeCloseTo(CENTRE.x - STICKY_SIZE_WORLD / 2, 6);
    expect(noteOf(doc, noteId).y).toBeCloseTo(CENTRE.y - STICKY_SIZE_WORLD / 2, 6);

    // Nothing at all was written.
    expect(docBytes(doc)).toEqual(before);
  });

  it('the same board becomes editable again when the room serves it, with no reload', async () => {
    const doc = new Y.Doc();
    const provider = new FakeProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();

    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();
    expect(boardEditable()).toBe('false');

    // The provider keeps retrying by itself; when the room answers, the same
    // page edits again (this is the half of TC-24 that needs no browser).
    act(() => {
      provider.serves();
    });
    await flushFrame();
    expect(boardEditable()).toBe('true');

    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);
  });
});
