import { readFileSync } from 'node:fs';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus.js';
import { connectBoard } from '../../src/client/sync/connectBoard.js';
import type { ConnectionState } from '../../src/client/sync/connectBoard.js';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config.js';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol.js';
import { act, cleanup, render, screen } from './tl.js';
import { FakeLink, advance, closeSocket, failToLoad, setStatus } from './fake-link.js';
import {
  badge as badgeOf,
  canEdit as canEditOf,
  createNote,
  docNotes,
  escapeFromEditor,
  keydown,
  noteElements,
  noteText,
  renderBoard,
} from './helpers.js';

const BOARD_ID = 'vN8d2mKx1pQ0tY7rZ4wL3A';

/**
 * The badge, driven by the real status machine over a fake provider — which is
 * how App.tsx drives it. `states` records every state the machine reported, in
 * order, so a test can read the mapping as well as the DOM.
 */
function Harness({ link, states }: { link: FakeLink; states: ConnectionState[] }): ReactElement {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const connection = connectBoard(
      new Y.Doc(),
      BOARD_ID,
      (next) => {
        states.push(next);
        setState(next);
      },
      { createLink: () => link },
    );
    return () => connection.destroy();
  }, [link, states]);

  return <ConnectionStatus state={state} />;
}

function renderHarness(link = new FakeLink()): { states: ConnectionState[]; link: FakeLink } {
  cleanup();
  const states: ConnectionState[] = [];
  act(() => {
    render(<Harness link={link} states={states} />);
  });
  return { states, link };
}

/** Only the timers the badge needs; the frame queue in setup.ts stays real. */
const badgeTimers: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ['setTimeout', 'clearTimeout', 'Date'],
};

beforeEach(() => {
  vi.useFakeTimers(badgeTimers);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** TC-19: the first load says "Connecting…" and then says nothing at all. */
describe('TC-19 — the badge during the first load', () => {
  it('shows "Connecting…" and hides it once the room is reached', () => {
    const { states, link } = renderHarness();

    // The provider has been created and the socket is not open yet.
    expect(states).toEqual(['connecting']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    setStatus(link, 'connected');
    expect(states).toEqual(['connecting', 'connected']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps saying "Connecting…" while the socket is up but not in step', () => {
    const { states, link } = renderHarness();

    // The provider reports the socket, then the sync; only the sync confirms it.
    setStatus(link, 'connected', false);
    expect(states).toEqual(['connecting']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    setStatus(link, 'connected', true);
    expect(states).toEqual(['connecting', 'connected']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is a live region and not a control, and cannot take a click from the board', () => {
    const { link } = renderHarness();
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-live') ?? 'polite').toBe('polite');
    expect(badge.querySelector('button, a, input')).toBeNull();
    expect(badge).toHaveTextContent('Connecting…');
    setStatus(link, 'connected');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hangs the provider up when the board unmounts', () => {
    const link = new FakeLink();
    const states: ConnectionState[] = [];
    let view!: ReturnType<typeof render>;
    act(() => {
      view = render(<Harness link={link} states={states} />);
    });
    expect(link.destroyed).toBe(false);
    view.unmount();
    expect(link.destroyed).toBe(true);
  });
});

/** TC-20: an interruption, the confirmation, and the badge going away. */
describe('TC-20 — an interruption and the way back', () => {
  it('"Reconnecting…", then "Connected" for the confirmation window, then nothing', () => {
    const { states, link } = renderHarness();
    setStatus(link, 'connected');
    expect(screen.queryByRole('status')).toBeNull();

    setStatus(link, 'disconnected', false);
    expect(states).toEqual(['connecting', 'connected', 'reconnecting']);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    setStatus(link, 'connected');
    expect(states).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'confirmed',
    ]);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connected');

    // The confirmation is shown for CONNECTED_CONFIRMATION_MS and no longer.
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(states).toHaveLength(4);

    advance(1);
    expect(states).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'confirmed',
      'connected',
    ]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes back to "Reconnecting…" if the interruption comes again immediately', () => {
    const { states, link } = renderHarness();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    setStatus(link, 'connected');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    setStatus(link, 'disconnected', false);
    expect(states.at(-1)).toBe('reconnecting');
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    // And it still comes back when the room is reached again.
    setStatus(link, 'connected');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    advance(CONNECTED_CONFIRMATION_MS);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not call the badge "Connecting…" after a connection was lost', () => {
    const { states, link } = renderHarness();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    // The provider retries: "connecting", then the socket again, then the sync.
    setStatus(link, 'connecting', false);
    expect(states.at(-1)).toBe('reconnecting');
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });
});

/** TC-21: an interruption during the confirmation window. */
describe('TC-21 — interrupted during the confirmation window', () => {
  it('shows "Reconnecting…" immediately, not after the window expires', () => {
    const { states, link } = renderHarness();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    setStatus(link, 'connected');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Partway through the window the connection drops again.
    advance(CONNECTED_CONFIRMATION_MS / 2);
    setStatus(link, 'disconnected', false);
    expect(states.at(-1)).toBe('reconnecting');
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting…');

    // The expired confirmation window must not overwrite that: nothing further
    // happens on its own.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(states.at(-1)).toBe('reconnecting');
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    // A board that was never in step with its room never shows "Reconnecting…".
    const fresh = renderHarness();
    setStatus(fresh.link, 'disconnected', false);
    expect(fresh.states).toEqual(['connecting']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
  });
});

/**
 * The negative the design asks for: the badge is information, never a lock. A
 * board whose room cannot be reached is still a board - everything the user can
 * do to it, they can do while the badge is amber.
 */
describe('the badge never locks the board out', () => {
  // The zoom percentage is a live region too (it announces zoom changes), so
  // these App-level tests take the badge by its test id and check its role.
  const badge = () => screen.getByTestId('connection-status');

  it('creates, types into and deletes notes while it says "Reconnecting…"', () => {
    const link = renderBoard();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    expect(badge()).toHaveAttribute('role', 'status');
    expect(badge()).toHaveTextContent('Reconnecting…');

    // Create with the toolbar, type into it, leave it: the whole loop.
    const id = createNote('Retro board');
    expect(noteElements()).toHaveLength(1);
    expect(noteText()).toBe('Retro board');
    escapeFromEditor();

    // And delete it, with the badge still up.
    keydown('Delete');
    expect(noteElements()).toHaveLength(0);
    expect(docNotes()).toHaveLength(0);
    expect(badge()).toHaveTextContent('Reconnecting…');
    // The note the badge-era edit created is gone from the document too, not
    // just from the DOM.
    expect(id).toBeTruthy();
  });

  it('is not focusable and holds no control', () => {
    const link = renderBoard();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    expect(badge().tabIndex).toBe(-1);
    expect(badge().querySelector('button, a, input, [role="button"]')).toBeNull();
  });

  it('sits in the board layout without hiding the toolbar, the zoom controls or the hint', () => {
    const link = renderBoard();
    expect(screen.getByTestId('board-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-controls')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-hint')).toBeInTheDocument();
    expect(badge()).toHaveClass('connection-status');
    setStatus(link, 'connected');
    expect(screen.queryByTestId('connection-status')).toBeNull();
    // The board itself is still there, and still the interactive surface.
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
  });
});

/**
 * TC-22: the message a board gives when it could not be loaded. It is not a
 * connection problem - the room answered - so it does not say "Reconnecting…",
 * and it is not amber: the board is not coming back on its own, and the user
 * should not read this as the same thing that happens when the wifi goes.
 */
describe('TC-22 — a board that could not be loaded', () => {
  /** The sentence, exactly. A message that changes wording is a different message. */
  const MESSAGE = "This board couldn't be loaded. Retrying…";

  it('says it, and says it as a live region', () => {
    const { link } = renderHarness();
    setStatus(link, 'connected');
    expect(screen.queryByRole('status')).toBeNull();

    failToLoad(link);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(MESSAGE);
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge.getAttribute('aria-live') ?? 'polite').toBe('polite');
    // Never a control: it must not be clickable, focusable, or able to swallow
    // a gesture meant for the board.
    expect(badge.querySelector('button, a, input, [role="button"]')).toBeNull();
  });

  it('is the load-failure styling, and the stylesheet paints it red', () => {
    const { link } = renderHarness();
    failToLoad(link);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveClass('connection-status--load_failed');
    expect(badge).toHaveAttribute('data-state', 'load_failed');

    // jsdom does not apply the stylesheet, so the colour is checked where it is
    // written: the state has a rule, the rule names one custom property, and
    // that property is a red. A state rendered with a class nobody styled would
    // pass a DOM-only test and show the user an amber badge.
    // Relative to the project root, which is where every test in this repo runs
    // from (vitest.config.ts); `import.meta.url` is not a file URL in jsdom.
    const css = readFileSync('src/client/styles.css', 'utf8');
    const rule = css.slice(css.indexOf('.connection-status--load_failed'));
    const declaration = rule.slice(0, rule.indexOf('}') + 1);
    expect(declaration).toMatch(/background:\s*var\(--connection-error\)/u);

    const value = /--connection-error:\s*(#[0-9a-f]{6})/iu.exec(css)?.[1];
    if (value === undefined) throw new Error('styles.css defines no --connection-error');
    const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
    expect(red > green && red > blue, `${value} is not a red`).toBe(true);
  });

  it('is not the message for a board that is merely out of reach', () => {
    const { link } = renderHarness();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    // The two sentences are different because the two situations are different.
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting\u2026');
    expect(screen.getByRole('status')).not.toHaveTextContent(MESSAGE);
  });
});

/**
 * TC-28: the close code is the whole difference between "the room is unreachable"
 * and "the board is not there to be read", and the two must not be confused in
 * either direction. A storage failure that showed as a load failure would tell
 * people their work is gone when it is not; a load failure that showed as a
 * storage failure would let them keep typing into a board they cannot save to.
 */
describe('TC-28 — what a close code means', () => {
  it('4500 is "could not be loaded", and it is the only code that is', () => {
    const codes: Array<[number | null, ConnectionState]> = [
      // A storage failure: the board is readable, the room had a problem of its
      // own, and the retry will bring it back with the unsaved changes in tow.
      [CLOSE_STORAGE_FAILURE, 'reconnecting'],
      // A close with no code at all: a dropped network, a laptop lid, a server
      // that stopped mid-sentence. Nothing here says the board is unreadable.
      [null, 'reconnecting'],
      // Rubbish on the wire (story 3): the connection is unhealthy, not lost.
      [1003, 'reconnecting'],
      [1006, 'reconnecting'],
      [4500, 'load_failed'],
    ];

    for (const [code, expected] of codes) {
      const { states, link } = renderHarness();
      setStatus(link, 'connected');
      closeSocket(link, code);
      expect(states.at(-1), `close code ${code}`).toBe(expected);
    }
  });

  it('keeps the board editable while it says "Reconnecting\u2026" and locks it when it says it could not load', () => {
    // The editable half: a storage failure is a room problem, not a user problem.
    const link = renderBoard();
    setStatus(link, 'connected');
    closeSocket(link, CLOSE_STORAGE_FAILURE);
    expect(badgeOf()).toHaveTextContent('Reconnecting\u2026');
    expect(canEditOf()).toBe(true);
    createNote('written during an outage');
    expect(docNotes()).toHaveLength(1);
    escapeFromEditor();

    // The locked half: same gestures, one digit different in the close code.
    const locked = renderBoard();
    setStatus(locked, 'connected');
    closeSocket(locked, CLOSE_BOARD_LOAD_FAILED);
    expect(badgeOf()).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(canEditOf()).toBe(false);
  });

  it('says it again, and still the same thing, when the retry fails the same way', () => {
    const { states, link } = renderHarness();
    failToLoad(link);
    expect(states.at(-1)).toBe('load_failed');

    // The provider retries on its own: the socket opens, the room refuses it
    // again, and the badge does not change its story. It never goes back to
    // "Connecting\u2026", which would say this is a first load rather than a
    // board that has refused to open four times in a row.
    const before = states.length;
    failToLoad(link);
    failToLoad(link);
    expect(states.slice(before)).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent(
      "This board couldn't be loaded. Retrying…",
    );
  });

  it('the first sync after a load failure is a connection, and editing is open again without a reload', () => {
    const { states, link } = renderHarness();
    failToLoad(link);
    expect(states.at(-1)).toBe('load_failed');
    expect(screen.getByRole('status')).toHaveTextContent('could');

    // Somewhere in the room the board got readable again - nothing on this page
    // was reloaded, no button was pressed - and the retry gets through.
    setStatus(link, 'connected');
    expect(states.at(-1)).toBe('connected');
    expect(screen.queryByRole('status')).toBeNull();

    // And it means it: the board takes an edit.
    const app = renderBoard();
    closeSocket(app, CLOSE_BOARD_LOAD_FAILED);
    expect(canEditOf()).toBe(false);
    setStatus(app, 'connected');
    expect(canEditOf()).toBe(true);
    createNote('typed after the retry');
    expect(noteText()).toBe('typed after the retry');
  });

  it('does not mistake a load failure for an interruption on a board it had', () => {
    const { states, link } = renderHarness();
    setStatus(link, 'connected');
    // A board that was in step, lost the room, and then was told the board
    // cannot be loaded: the load failure is the stronger fact, and it wins even
    // though it arrived second.
    setStatus(link, 'disconnected', false);
    expect(states.at(-1)).toBe('reconnecting');
    failToLoad(link);
    expect(states.at(-1)).toBe('load_failed');
    expect(screen.getByRole('status')).toHaveTextContent("This board couldn't be loaded");
  });
});
