/**
 * Component tests for a board the room could not load (persist.client_status,
 * TC-22, TC-23, TC-28).
 *
 * There is one thing to get right here and it is a pair of opposites: a board that
 * cannot be *reached* stays editable, and a board that cannot be *read* stops being
 * editable. The first is a delay — what is typed goes into the document and travels
 * when the socket comes back, so taking the keyboard away would only lose work. The
 * second is a verdict: the room has said there is no board behind this socket, and a
 * note made now would be made in a document that is about to be thrown away. The only
 * signal that tells them apart is the close code, which is why these tests drive close
 * codes rather than sockets, and why the badge's colour is a consequence of the code
 * rather than a thing decided on its own.
 *
 * The fake below emits the three events the real provider does — `status`, `sync` and
 * `connection-close` — and nothing else, so a test cannot lean on a signal a provider
 * never sends. No timers are involved: a refusal is not on a clock.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { BoardPage, canEdit } from '../../src/client/pages/BoardPage';
import type { BoardConnector } from '../../src/client/board/useBoardDoc';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createConnectionTracker } from '../../src/client/sync/connectBoard';
import type { ConnectionState, ConnectionTracker, ProviderStatus } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import {
  BOARD_ID,
  boardExists,
  clickStickyButton,
  createSelectedNote,
  doc,
  hasTextarea,
  noteElementById,
  noConnection,
  pointerDown,
  pointerMove,
  pointerUp,
  stickyById,
  stickies,
  surface,
  textarea,
  typeText,
} from './helpers/stickyBoard';

/** What the room says about a board it could not read, word for word. */
const LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";

function badgeOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="connection-status"]');
}

function badge(): HTMLElement {
  const element = badgeOrNull();
  if (!element) throw new Error('the badge is not showing');
  return element;
}

/**
 * A room that reports itself the way `WebsocketProvider` does.
 *
 * `refuse(code)` is the reason this file exists: the close code is the only thing a
 * client is told about a board that is not there, and it is delivered as a socket
 * close, not as a message — so the client has to read meaning into a number.
 */
class FakeRoom {
  private readonly trackers = new Set<ConnectionTracker>();
  /** Every state the board was told about, in order. */
  readonly seen: ConnectionState[] = [];

  asConnector(): BoardConnector {
    return (_document, _boardId, onState) => {
      const publish = (state: ConnectionState): void => {
        this.seen.push(state);
        onState(state);
      };
      const tracker = createConnectionTracker(publish);
      this.trackers.add(tracker);
      publish('connecting');
      return {
        destroy: (): void => {
          this.trackers.delete(tracker);
          tracker.destroy();
        },
      };
    };
  }

  /** What a badge wired to this room was told, so a test can read the mapping back. */
  record(state: ConnectionState): void {
    this.seen.push(state);
  }

  attach(tracker: ConnectionTracker): () => void {
    this.trackers.add(tracker);
    return () => {
      this.trackers.delete(tracker);
      tracker.destroy();
    };
  }

  /** The socket is open. */
  open(): void {
    this.status('connected');
  }

  /** The socket is being dialled again. */
  dial(): void {
    this.status('connecting');
  }

  /** The socket dropped and will be tried again. */
  drop(): void {
    this.status('disconnected');
  }

  /** The two documents agree: the board is live. */
  agree(): void {
    for (const tracker of [...this.trackers]) tracker.synced(true);
  }

  /**
   * The room closed the socket, and then — as the provider does for a close that is
   * not terminal — reports the connection as down. A room refusing a board does this
   * *without* a preceding `agree`, because there was nothing to agree about.
   */
  refuse(code: number): void {
    for (const tracker of [...this.trackers]) tracker.close(code);
    this.status('disconnected');
  }

  private status(status: ProviderStatus): void {
    for (const tracker of [...this.trackers]) tracker.status(status);
  }
}

/** The badge, wired to a fake room the way the board wires itself to a real one. */
function Badge({ provider }: { provider: FakeRoom }): JSX.Element | null {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const tracker = createConnectionTracker((next) => {
      provider.record(next);
      setState(next);
    });
    return provider.attach(tracker);
  }, [provider]);
  return <ConnectionStatus state={state} />;
}

/** Fire an action and let whatever React and Yjs it starts settle. */
async function then(action?: () => void): Promise<void> {
  await act(async () => {
    action?.();
    await Promise.resolve();
  });
}

/**
 * Writes counted at the document itself. The component tests ask whether the interface
 * did something; this answers whether anything arrived, which is the question the
 * design's "no model mutation calls" actually poses — a component that hid a mutation
 * behind a `return` it forgot to write would still pass a test about pixels.
 */
function watchForWrites(): { count(): number; stop(): void } {
  const board = doc();
  let writes = 0;
  const before = (transaction: Y.Transaction): void => {
    if (transaction.local) writes += 1;
  };
  board.on('beforeTransaction', before);
  return { count: () => writes, stop: () => board.off('beforeTransaction', before) };
}

/**
 * The whole document, encoded: a write that leaves the notes looking exactly as they
 * did — a note raised to the top, a note moved onto itself — is still a write, and a
 * note count would miss it.
 */
function documentBytes(): string {
  return Y.encodeStateAsUpdateV2(doc()).toString();
}

describe('a board that could not be loaded', () => {
  it('says so, in red, and keeps saying it while the room retries (TC-22)', async () => {
    const provider = new FakeRoom();
    const view = render(<Badge provider={provider} />);

    expect(badge().textContent).toBe('Connecting…');
    await then(() => provider.agree());
    expect(badgeOrNull()).toBeNull();

    // The room reads its board and cannot: the socket is closed with 4500.
    await then(() => provider.refuse(CLOSE_BOARD_LOAD_FAILED));

    const element = badge();
    expect(element.textContent).toBe(LOAD_FAILED_MESSAGE);
    // A polite live region, like every other state: the person editing is told, and
    // told by the text itself rather than by an attribute a screen reader has to know.
    expect(element.getAttribute('role')).toBe('status');
    expect(element.getAttribute('data-state')).toBe('load_failed');
    // Red is the stylesheet's doing, not this test's — jsdom loads no CSS — so what is
    // asserted is the hook the stylesheet hangs the colour on, the same one
    // `.connection-status--load_failed` is written for.
    expect(element.className).toContain('connection-status--load_failed');

    // It does not flicker. The retry dials, drops, dials again, and all of that is
    // still the same news: the message that asks somebody to stop editing must not
    // spend the wait pretending to be a connection problem.
    await then(() => provider.dial());
    expect(badge().textContent).toBe(LOAD_FAILED_MESSAGE);
    await then(() => provider.drop());
    expect(badge().textContent).toBe(LOAD_FAILED_MESSAGE);
    await then(() => provider.dial());
    expect(badge().textContent).toBe(LOAD_FAILED_MESSAGE);

    view.unmount();
  });

  it('takes every means of changing the board away, and leaves the board itself on screen (TC-23)', async () => {
    const provider = new FakeRoom();
    render(<BoardPage id={BOARD_ID} connect={provider.asConnector()} check={boardExists} />);
    await then(() => provider.agree());

    // A board to lose: two notes, the second of them selected, made while the board
    // worked. They are told apart by which one is new, because the document lists them
    // by stacking number and the newer note is on top by then.
    await createSelectedNote(200, 150, 'keep me');
    const first = stickies()[0];
    if (!first) throw new Error('the first note did not reach the board');
    const made = new Set(stickies().map((note) => note.id));
    await createSelectedNote(500, 400, 'and me');
    const second = stickies().find((note) => !made.has(note.id));
    if (!second) throw new Error('the second note did not reach the board');
    await then();

    await then(() => provider.refuse(CLOSE_BOARD_LOAD_FAILED));
    expect(badge().textContent).toBe(LOAD_FAILED_MESSAGE);

    const writes = watchForWrites();
    const before = stickies().map((note) => [note.id, note.x, note.y, note.text, note.color, note.z]);
    const writtenBefore = documentBytes();

    // The button that makes a note is out of use, and says so rather than going quiet.
    const button = screen.getByTestId('create-sticky');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);

    // Double-clicking the board is the other way to make a note, and the one nobody
    // reaches for a second time after being refused.
    fireEvent.doubleClick(surface(), { clientX: 320, clientY: 260 });
    expect(hasTextarea()).toBe(false);

    // A note cannot be edited, moved, recoloured or deleted. Pressing Delete on the
    // selected note is the most expensive of these to get wrong: the note is really
    // gone from a document that is about to be discarded, so the person loses it twice.
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(hasTextarea()).toBe(false);

    const note = noteElementById(first.id);
    pointerDown(note, 210, 160);
    pointerMove(note, 610, 560);
    pointerUp(note, 610, 560);
    expect(hasTextarea()).toBe(false);

    // Nothing answered any of it: no note made, no note moved, no note deleted, and
    // nothing written to the document at all — not a stacking number, not a selection.
    expect(writes.count()).toBe(0);
    expect(documentBytes()).toBe(writtenBefore);
    expect(stickies().map((note2) => [note2.id, note2.x, note2.y, note2.text, note2.color, note2.z])).toEqual(before);
    expect(stickyById(first.id).text).toBe('keep me');
    expect(stickyById(second.id).text).toBe('and me');

    // And the red message is the only thing standing between the person and an empty
    // board: the notes that were there are still shown. A failure that blanked the
    // screen would be indistinguishable from a board that was empty all along.
    expect(noteElementsPresent()).toBe(2);
    writes.stop();
  });

  it('reads the close code, not the fact of a closed socket: 4500 locks, 1011 and 1003 do not (TC-28)', async () => {
    const provider = new FakeRoom();
    const view = render(<Badge provider={provider} />);
    await then(() => provider.agree());

    // 1011: the room could not write the board down. The board is readable and the
    // changes are held to be sent again, so this is a wait, not a verdict.
    await then(() => provider.refuse(CLOSE_STORAGE_FAILURE));
    expect(badge().textContent).toBe('Reconnecting…');
    expect(provider.seen.at(-1)).toBe('reconnecting');
    expect(canEdit(provider.seen.at(-1) as ConnectionState)).toBe(true);

    // 1003: a message the room could not read, which says nothing about the board.
    await then(() => provider.agree());
    await then(() => provider.refuse(CLOSE_UNSUPPORTED_DATA));
    expect(badge().textContent).toBe('Reconnecting…');
    expect(canEdit('reconnecting')).toBe(true);

    // 4500: no board. Everything else on this list was a delay.
    await then(() => provider.agree());
    await then(() => provider.refuse(CLOSE_BOARD_LOAD_FAILED));
    expect(provider.seen.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);

    // Recovery, without a reload: the room retried, read the board, and the first
    // sync turns editing back on and takes the message away.
    await then(() => provider.open());
    await then(() => provider.agree());
    expect(provider.seen.at(-1)).toBe('connected');
    expect(badgeOrNull()).toBeNull();
    view.unmount();
  });

  it('holds the board while it is refused, and hands it back on the sync that loads it', async () => {
    const provider = new FakeRoom();
    render(<BoardPage id={BOARD_ID} connect={provider.asConnector()} check={boardExists} />);
    await then(() => provider.agree());

    await then(() => provider.refuse(CLOSE_BOARD_LOAD_FAILED));
    const writes = watchForWrites();

    // Editing is off, and it is off in the interface that offers it: the button, the
    // board, the note. Not merely a flag somewhere that a component may or may not
    // have consulted.
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(writes.count()).toBe(0);

    // The room comes back with the board in hand. Editing is on again without the
    // page being reloaded, and without being told twice: the message goes when the
    // board arrives, not a moment later.
    await then(() => provider.agree());
    expect(badgeOrNull()).toBeNull();
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);

    await clickStickyButton();
    expect(stickies()).toHaveLength(1);
    expect(writes.count()).toBeGreaterThan(0);

    // And typing into it is back too, which is the part a person notices.
    typeText('back again');
    expect(textarea().value).toBe('back again');
    writes.stop();
  });

  it('says nothing about a board it has, and never claims a board it has not read', async () => {
    // `canEdit` is the whole rule, in one line, and is worth stating on its own:
    // every state that is a delay leaves the board editable, and exactly one does not.
    for (const state of ['connecting', 'connected', 'reconnecting', 'confirmed'] as ConnectionState[]) {
      expect(canEdit(state), `state ${state}`).toBe(true);
    }
    expect(canEdit('load_failed')).toBe(false);

    // The badge has no words for `connected`: a board that works is not news.
    const connected = render(<ConnectionStatus state="connected" />);
    expect(connected.container.innerHTML).toBe('');
    connected.unmount();

    // A board that has never been told anything keeps its first message and stays
    // editable: not knowing is not the same as failing.
    render(<BoardPage id={BOARD_ID} connect={noConnection} check={boardExists} />);
    expect(badge().textContent).toBe('Connecting…');
    expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);
  });
});

function noteElementsPresent(): number {
  return document.querySelectorAll('[data-note-id]').length;
}
