// story 4 (ui-component): what the client does when the room could not read the
// board's own storage. Two separate promises, and the difference between them is
// the whole test:
//
//   sync.client  "This board could not be loaded", and nothing pretends otherwise.
//   sync.edit    the board stops taking changes, because a change made here has
//                nowhere to be kept.
//
// A board that is merely offline is the contrast case in both: it keeps taking
// edits, since those go into the local document and are sent when the link returns.

import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { useEffect, useState, type JSX } from 'react';
import {
  canEdit,
  mapConnectionState,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNote } from '../../src/client/objects/StickyNote';
import type { EndEditNext } from '../../src/client/board/useSelection';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import {
  clickOn,
  doubleClickBoard,
  doubleClickOn,
  dragNote,
  FakeConnectionEmitter,
  flushFrames,
  forceConnectionState,
  newNote,
  noteAt,
  noteCount,
  noteToolbarOpen,
  pressKey,
  renderBoard,
  useBoardTestLifecycle,
} from './helpers';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

// --------------------------------------------------------------------------------
// The badge (TC-22)
// --------------------------------------------------------------------------------

function badgeText(): string | null {
  return screen.queryByTestId('connection-status')?.textContent ?? null;
}

function badgeState(): string | undefined {
  return screen.queryByTestId('connection-status')?.dataset.state;
}

/**
 * Renders the badge over the state machine, the way the app does, and returns the
 * states it was given, newest last - the state behind the text, which is what
 * decides whether the board takes edits.
 */
function renderBadge(emitter: FakeConnectionEmitter): ConnectionState[] {
  const seen: ConnectionState[] = [];
  function Harness(): JSX.Element {
    const [state, setState] = useState<ConnectionState>('connecting');
    useEffect(
      () =>
        mapConnectionState(emitter, (next) => {
          seen.push(next);
          setState(next);
        }),
      [emitter],
    );
    return <ConnectionStatus state={state} />;
  }
  render(<Harness />);
  return seen;
}

/** The state the board is in right now, according to the last render. */
function latest(seen: readonly ConnectionState[]): ConnectionState {
  const last = seen[seen.length - 1];
  if (last === undefined) throw new Error('the badge was never given a state');
  return last;
}

describe('board load failure badge (TC-22)', () => {
  useBoardTestLifecycle();

  it('TC-22 the load-failure close shows the load-failure message', () => {
    const emitter = new FakeConnectionEmitter();
    renderBadge(emitter);
    // Arriving, then the room reads its storage and cannot.
    act(() => emitter.emitStatus('connected'));
    expect(badgeText()).toBe('Connecting…');
    act(() => emitter.emitClose(CLOSE_BOARD_LOAD_FAILED));

    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    expect(badgeState()).toBe('load_failed');
    // "red" as the badge renders it, and announced the way a status is announced.
    expect(screen.getByTestId('connection-status').classList.contains('connection-status--load_failed')).toBe(true);
    expect(screen.getByTestId('connection-status').getAttribute('role')).toBe('status');
  });

  it('TC-22 the message is held while the provider keeps trying, and ends when the board arrives', () => {
    const emitter = new FakeConnectionEmitter();
    renderBadge(emitter);
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitClose(CLOSE_BOARD_LOAD_FAILED);
    });
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);

    // The provider opens the next attempt. Saying "Connecting…" or "Reconnecting…"
    // here would be a promise about the board that the room has already refused.
    act(() => emitter.emitStatus('connecting'));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    act(() => emitter.emitStatus('connected'));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);

    // A second refusal says the same thing; the message does not change or flicker.
    act(() => {
      emitter.emitClose(CLOSE_BOARD_LOAD_FAILED);
      emitter.emitStatus('connecting');
    });
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);

    // The board turns up: the badge is gone, because the board is there now.
    act(() => emitter.emitSync(true));
    expect(badgeText()).toBeNull();
  });

  it('TC-22 a board that synced and then was refused on a later visit goes from nothing to the message', () => {
    const emitter = new FakeConnectionEmitter();
    renderBadge(emitter);
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitSync(true);
    });
    expect(badgeText()).toBeNull();

    act(() => emitter.emitClose(CLOSE_BOARD_LOAD_FAILED));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    // The provider's own status change after the close must not overwrite the news.
    act(() => emitter.emitStatus('disconnected'));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
  });
});

// --------------------------------------------------------------------------------
// Close codes (TC-28)
// --------------------------------------------------------------------------------

describe('close codes (TC-28)', () => {
  useBoardTestLifecycle();

  /**
   * Drive a badge to a live state, close it with `code`, then let the provider
   * report what it is doing next (after any close it goes to `disconnected`, and
   * starts another attempt). Returns the state the close left behind.
   */
  function afterClose(code: number | null): { text: string | null; state: string | undefined } {
    // One badge per code, so the codes are compared against the same starting state.
    cleanup();
    const emitter = new FakeConnectionEmitter();
    renderBadge(emitter);
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitSync(true);
    });
    act(() => emitter.emitClose(code));
    act(() => emitter.emitStatus('disconnected'));
    return { text: badgeText(), state: badgeState() };
  }

  it('TC-28 the load-failure code is the one close code with a message of its own', () => {
    expect(afterClose(CLOSE_BOARD_LOAD_FAILED)).toEqual({
      text: LOAD_FAILED_TEXT,
      state: 'load_failed',
    });
    // Even though the provider went straight on trying, the message did not become
    // "Reconnecting…": the room has said the board itself is unreadable.
  });

  it('TC-28 an ordinary close stays a connection state: the link is down, not the board', () => {
    // 1006 no close frame at all (network), 1011 the room's own storage failure,
    // 4501 the next code in the retry-anywhere range: none of them is a refusal of
    // this board, so none of them stops the board taking edits.
    for (const code of [1006, 1011, 1012, 1003, 1000, 4501]) {
      const badge = afterClose(code);
      expect(badge.state, `close code ${code}`).not.toBe('load_failed');
      expect(badge.text, `close code ${code}`).toBe('Reconnecting…');
    }
    // A storage failure in particular must not read as "couldn't be loaded", and
    // must not stop the board taking edits: the changes are kept locally and go
    // with the next connection.
    expect(canEdit(afterClose(1011).state as ConnectionState)).toBe(true);
  });

  it('TC-28 a permanent close code is not read as a load failure either', () => {
    // 4400-4499 is the range y-websocket itself treats as "reconnecting cannot fix
    // this" and stops on. This app never sends one; if it ever did, the badge would
    // go stale rather than claim the board is unreadable.
    for (const code of [4400, 4404, 4499]) {
      const badge = afterClose(code);
      expect(badge.state, `close code ${code}`).not.toBe('load_failed');
    }
  });

  it('TC-28 a sync after a load failure re-enables editing without a reload', () => {
    const emitter = new FakeConnectionEmitter();
    const seen = renderBadge(emitter);
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitClose(CLOSE_BOARD_LOAD_FAILED);
    });
    expect(latest(seen)).toBe('load_failed');
    expect(canEdit(latest(seen))).toBe(false);

    // The room read the board on a later attempt. No page reload happened, and the
    // board is a board again.
    act(() => emitter.emitSync(true));
    expect(badgeText()).toBeNull();
    expect(latest(seen)).toBe('connected');
    expect(canEdit(latest(seen))).toBe(true);
  });

  it('TC-28 a close that came from our own disconnect is not a load failure', () => {
    // The provider reports a locally closed connection with no event at all.
    expect(afterClose(null).state).not.toBe('load_failed');
  });
});

// --------------------------------------------------------------------------------
// The edit lock (TC-23)
// --------------------------------------------------------------------------------

describe('board edit lock (TC-23)', () => {
  useBoardTestLifecycle();

  it('TC-23 only a board that could not be read refuses edits; a board that is merely offline takes them', () => {
    expect(canEdit('load_failed')).toBe(false);
    // Everything short of that keeps its edits: they go into the local document and
    // are sent when the link comes back.
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
  });

  it('TC-23 the sticky note tool is switched off, and says why', () => {
    const onCreateSticky = vi.fn();
    render(
      <Toolbar
        onCreateSticky={onCreateSticky}
        disabled
        disabledReason={LOAD_FAILED_TEXT}
      />,
    );

    const button = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // The reason is in the text a person sees when they hover, or a reader speaks.
    expect(button.getAttribute('title')).toBe(LOAD_FAILED_TEXT);

    fireEvent.click(button);
    expect(onCreateSticky).not.toHaveBeenCalled();
  });

  it('TC-23 the tool is available on a board that is simply offline', () => {
    render(<Toolbar onCreateSticky={vi.fn()} disabled={false} />);
    const button = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('title')).toContain('double-click');
  });

  describe('the whole board', () => {
    /** Every way a person changes this board, attempted in turn. */
    function tryToChangeTheBoard(): void {
      // the sticky note tool
      fireEvent.click(screen.getByTestId('create-sticky'));
      // a double-click on empty board
      doubleClickBoard(500, 400);
      // a double-click on the note, and the keys that would type into it
      doubleClickOn(noteAt(0));
      pressKey('Enter');
      fireEvent.keyDown(document, { key: 'a' });
      // dragging the note somewhere else
      dragNote(0, 120, 90);
      flushFrames();
      // selecting it and pressing its delete key
      clickOn(noteAt(0));
      pressKey('Delete');
      pressKey('Backspace');
      flushFrames();
    }

    it('TC-23 a board that could not be loaded is shown as such and takes no changes at all', () => {
      const { doc } = renderBoard();
      newNote(doc, { x: 0, y: 0 });
      forceConnectionState('load_failed');
      flushFrames();

      // Said where it cannot be missed: the badge, and over the board itself.
      expect(screen.getByTestId('connection-status').textContent).toBe(LOAD_FAILED_TEXT);
      expect(screen.getByTestId('board-load-failed').textContent).toContain(LOAD_FAILED_TEXT);
      // The board is still the board - its notes are drawn, not hidden.
      expect(noteCount()).toBe(1);
      // And the tool says it is off.
      expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(true);

      const before = JSON.stringify(snapshot(doc));
      tryToChangeTheBoard();

      expect(JSON.stringify(snapshot(doc))).toBe(before);
      // No editor opened, and the swatches and bin that recolour and delete never
      // appeared, because the note cannot even be selected.
      expect(screen.queryByTestId('sticky-input')).toBeNull();
      expect(noteToolbarOpen()).toBe(false);
    });

    it('TC-23 a board that is simply offline takes every one of those changes', () => {
      const { doc } = renderBoard();
      newNote(doc, { x: 0, y: 0 });
      // The contrast case: the link is down, so there is nowhere to send a change
      // yet - but the change is kept, and that is the point of the local document.
      forceConnectionState('reconnecting');
      flushFrames();

      expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);
      const before = JSON.stringify(snapshot(doc));
      tryToChangeTheBoard();

      expect(JSON.stringify(snapshot(doc))).not.toBe(before);
      // The tool and the double-click each made a note. (The delete key went to the
      // note that had just opened for typing, where the key belongs to the text -
      // which is the story 2 rule, not the lock.)
      expect(noteCount()).toBeGreaterThan(1);
      // (There is no badge to read here: this board has no connection at all, which
      // is the one state the app keeps to itself. See TC-22 for the badge itself.)
    });
  });

  describe('a locked note', () => {
    let doc: Y.Doc;
    let selections: string[];
    let edits: string[];

    /** One note, rendered on its own with the board's own edit state. */
    function renderLockedNote(editable: boolean): void {
      doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 40, y: 60 });
      selections = [];
      edits = [];
      const onSelect = (id: string): void => {
        selections.push(id);
      };
      const onStartEdit = (id: string): void => {
        edits.push(id);
      };
      const onEndEdit = (next: EndEditNext): void => {
        void next;
      };

      function Harness(): JSX.Element {
        const [notes, setNotes] = useState(snapshot(doc));
        useEffect(() => {
          const objects = doc.getMap('objects');
          const handle = (): void => setNotes(snapshot(doc));
          objects.observeDeep(handle);
          return () => objects.unobserveDeep(handle);
        }, []);
        return (
          <>
            {notes.map((note) => (
              <StickyNote
                key={note.id}
                note={note}
                doc={doc}
                zoom={1}
                selected={false}
                editing={false}
                editable={editable}
                onSelect={onSelect}
                onStartEdit={onStartEdit}
                onEndEdit={onEndEdit}
              />
            ))}
          </>
        );
      }
      render(<Harness />);
    }

    it('TC-23 cannot be dragged, and the document does not change', () => {
      renderLockedNote(false);
      expect(noteAt(0).dataset.editable).toBe('false');
      const where = snapshot(doc)[0];

      dragNote(0, 100, 80);
      flushFrames();

      // Neither the document nor the note's own coordinates moved a pixel.
      expect(snapshot(doc)[0]).toMatchObject({ x: where.x, y: where.y });
      expect(noteAt(0).dataset.noteX).toBe(String(where.x));
      expect(noteAt(0).dataset.noteY).toBe(String(where.y));
    });

    it('TC-23 cannot be opened for editing, selected, or reached by its delete button', () => {
      renderLockedNote(false);

      doubleClickOn(noteAt(0));
      expect(edits).toEqual([]);
      expect(screen.queryByTestId('sticky-input')).toBeNull();

      clickOn(noteAt(0));
      expect(selections).toEqual([]);
      // The colour swatches and the bin live in the toolbar a selection reveals;
      // with no selection there is nothing to recolour or delete with.
      expect(noteToolbarOpen()).toBe(false);
    });

    it('TC-23 the same note takes all of it when the board is editable', () => {
      renderLockedNote(true);
      expect(noteAt(0).dataset.editable).toBe('true');
      const where = snapshot(doc)[0];

      dragNote(0, 100, 80);
      flushFrames();
      expect(snapshot(doc)[0]).toMatchObject({ x: where.x + 100, y: where.y + 80 });

      doubleClickOn(noteAt(0));
      expect(edits.length).toBe(1);
    });
  });
});
