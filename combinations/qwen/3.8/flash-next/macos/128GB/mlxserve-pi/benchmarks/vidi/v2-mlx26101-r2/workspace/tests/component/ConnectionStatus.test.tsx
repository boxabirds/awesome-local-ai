import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus.js';
import { connectBoard } from '../../src/client/sync/connectBoard.js';
import type { ConnectionState } from '../../src/client/sync/connectBoard.js';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config.js';
import { act, cleanup, render, screen } from './tl.js';
import { FakeLink, advance, setStatus } from './fake-link.js';
import {
  createNote,
  docNotes,
  escapeFromEditor,
  keydown,
  noteElements,
  noteText,
  renderApp,
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
    const link = renderApp();
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
    const link = renderApp();
    setStatus(link, 'connected');
    setStatus(link, 'disconnected', false);
    expect(badge().tabIndex).toBe(-1);
    expect(badge().querySelector('button, a, input, [role="button"]')).toBeNull();
  });

  it('sits in the board layout without hiding the toolbar, the zoom controls or the hint', () => {
    const link = renderApp();
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
