/**
 * Component tests for the connection badge (sync.client, TC-19 to TC-21).
 *
 * The badge has one hard requirement: it must say what the connection is doing, at the
 * right moments, for exactly as long as it should. Those moments are seconds long, so
 * these tests move the clock instead of waiting for it, and drive the state machine with
 * a fake provider — the two events the real `WebsocketProvider` emits, `status` and
 * `sync` — rather than cutting a network in half.
 *
 * `createConnectionTracker` is under test as much as the badge it feeds, because the
 * rules are in the mapping: a socket that is open but has agreed with nobody is not yet
 * "Connected", and the reassurance after a drop is worth exactly `CONNECTED_CONFIRMATION_MS`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App';
import type { BoardConnector } from '../../src/client/board/useBoardDoc';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createConnectionTracker } from '../../src/client/sync/connectBoard';
import type { ConnectionState, ConnectionTracker, ProviderStatus } from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { noConnection, stickies } from './helpers/stickyBoard';

/** What the badge renders, or nothing when it has nothing to say. */
function badgeOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="connection-status"]');
}

function badge(): HTMLElement {
  const element = badgeOrNull();
  if (!element) throw new Error('the badge is not showing');
  return element;
}

function badgeText(): string | null {
  return badgeOrNull()?.textContent ?? null;
}

/**
 * A stand-in for the provider: it emits exactly the two events the real one does and
 * nothing else, so a test cannot lean on something a provider never reports. `open()`
 * and `agree()` are the two halves of a working connection — the socket is open, and
 * the documents have agreed — which the real provider reports separately, and which is
 * why "the socket is up" is not enough to tell somebody they are live.
 */
class FakeProvider {
  private readonly trackers = new Set<ConnectionTracker>();
  /** Every state the badge was told about, in order. */
  readonly seen: ConnectionState[] = [];

  /** The seam `useBoardDoc` takes, for tests that render the whole board. */
  asConnector(): BoardConnector {
    return (_doc, _boardId, onState) => {
      // `seen` is what the board was told, which is what a test can reason about.
      const publish = (state: ConnectionState): void => {
        this.seen.push(state);
        onState(state);
      };
      const tracker = createConnectionTracker(publish);
      this.trackers.add(tracker);
      // The badge is already saying "Connecting…" before the first byte is sent, which
      // is what the real connector reports here too.
      publish('connecting');
      return {
        destroy: (): void => {
          this.trackers.delete(tracker);
          tracker.destroy();
        },
      };
    };
  }

  /** A badge attached to this connection on its own. */
  attach(tracker: ConnectionTracker): () => void {
    this.trackers.add(tracker);
    return () => {
      this.trackers.delete(tracker);
      tracker.destroy();
    };
  }

  /** The socket is open, but the two documents have not agreed about anything yet. */
  open(): void {
    this.status('connected');
  }

  /** The socket dropped. The provider is already trying again, in the background. */
  drop(): void {
    this.status('disconnected');
  }

  /** The socket is being opened (what the provider says while it dials). */
  dial(): void {
    this.status('connecting');
  }

  /** The documents agree. */
  agree(): void {
    for (const tracker of this.trackers) tracker.synced(true);
  }

  private status(status: ProviderStatus): void {
    for (const tracker of [...this.trackers]) tracker.status(status);
  }
}

/** The badge, wired to a fake provider the way the board wires it to a real one. */
function Badge({
  provider,
  log = [],
}: {
  provider: FakeProvider;
  /** Every state this badge was given, in order; what a test reads back. */
  log?: ConnectionState[];
}): JSX.Element | null {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const tracker = createConnectionTracker((next) => {
      log.push(next);
      setState(next);
    });
    return provider.attach(tracker);
  }, [provider]);
  return <ConnectionStatus state={state} />;
}

/** Moves the fake clock, and lets React deal with whatever that fires. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Fires the provider events, and lets the state they cause land. */
async function then(...actions: (() => void)[]): Promise<void> {
  await act(async () => {
    for (const action of actions) action();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the connection badge', () => {
  it('says "Connecting…" while the board comes up, and nothing once it is live (TC-19)', async () => {
    const provider = new FakeProvider();
    const log: ConnectionState[] = [];
    render(<Badge provider={provider} log={log} />);

    expect(badgeText()).toBe('Connecting…');
    expect(badge().getAttribute('role')).toBe('status');

    // The socket is open and nothing has been agreed yet: still loading, not live.
    await then(() => provider.open());
    expect(badgeText()).toBe('Connecting…');
    expect(log).toEqual([]);

    await then(() => provider.agree());
    // A board that has worked all along has nothing to report, so it reports nothing.
    expect(badgeOrNull()).toBeNull();
    expect(log).toEqual(['connected']);
  });

  it('says "Reconnecting…", then "Connected" for exactly the confirmation time (TC-20)', async () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    await then(() => provider.open(), () => provider.agree());
    expect(badgeOrNull()).toBeNull();

    await then(() => provider.drop());
    expect(badgeText()).toBe('Reconnecting…');

    await then(() => provider.open(), () => provider.agree());
    expect(badgeText()).toBe('Connected');

    // The boundary. A badge that hid early would leave the person guessing whether the
    // board came back; one that never hid would become wallpaper.
    await tick(CONNECTED_CONFIRMATION_MS - 1);
    expect(badgeText()).toBe('Connected');

    await tick(1);
    expect(badgeOrNull()).toBeNull();
  });

  it('says "Reconnecting…" the moment the board drops again during the confirmation (TC-21)', async () => {
    const provider = new FakeProvider();
    const log: ConnectionState[] = [];
    render(<Badge provider={provider} log={log} />);
    await then(() => provider.open(), () => provider.agree());

    await then(() => provider.drop());
    await then(() => provider.open(), () => provider.agree());
    expect(badgeText()).toBe('Connected');

    await then(() => provider.drop());
    expect(badgeText()).toBe('Reconnecting…');

    // And the timer that was running when it dropped does not go on to hide the badge:
    // a person who is still cut off must not be told the board went quiet.
    await tick(CONNECTED_CONFIRMATION_MS * 3);
    expect(badgeText()).toBe('Reconnecting…');
    expect(log).toEqual(['connected', 'reconnecting', 'confirmed', 'reconnecting']);
  });

  it('goes back to "Reconnecting…" for a connection that has to be dialled again', async () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    await then(() => provider.open(), () => provider.agree());

    await then(() => provider.drop());
    // The provider reports the retry as `connecting`; that is still "nobody can see
    // you", and must not be shown as the loading badge of a board that never worked.
    await then(() => provider.dial());
    expect(badgeText()).toBe('Reconnecting…');

    await then(() => provider.open(), () => provider.agree());
    expect(badgeText()).toBe('Connected');
  });

  it('is a live region and never locks the board, in any state', async () => {
    const provider = new FakeProvider();
    render(<App connect={provider.asConnector()} />);

    const states: [ConnectionState, () => void][] = [
      ['connecting', () => undefined],
      ['connected', () => void (provider.open(), provider.agree())],
      ['reconnecting', () => void provider.drop()],
      ['confirmed', () => void (provider.open(), provider.agree())],
    ];

    let notes = 0;
    for (const [state, say] of states) {
      await then(say);
      if (state === 'connected') expect(badgeText()).toBeNull();
      else expect(badgeText(), `state ${state}`).not.toBeNull();

      // The negative half of the story: a board that cannot reach anybody is still a
      // board. Notes can still be made; they sit in the document and are sent as soon
      // as the connection is back, which is the next test and TC-11. (The helper that
      // usually clicks this button waits on the real clock, which is stopped here.)
      fireEvent.click(screen.getByTestId('create-sticky'));
      notes += 1;
      expect(stickies().length, `state ${state}`).toBe(notes);
      expect((screen.getByTestId('create-sticky') as HTMLButtonElement).disabled).toBe(false);
    }

    expect(provider.seen).toEqual(['connecting', 'connected', 'reconnecting', 'confirmed']);
  });

  it('says exactly what each state says, and nothing at all when connected', () => {
    const connected = render(<ConnectionStatus state="connected" />);
    expect(connected.container.innerHTML).toBe('');
    connected.unmount();

    for (const [state, label] of [
      ['connecting', 'Connecting…'],
      ['reconnecting', 'Reconnecting…'],
      ['confirmed', 'Connected'],
    ] as [ConnectionState, string][]) {
      const view = render(<ConnectionStatus state={state} />);
      expect(badge().textContent).toBe(label);
      expect(badge().getAttribute('role')).toBe('status');
      expect(badge().getAttribute('data-state')).toBe(state);
      view.unmount();
    }
  });

  it('leaves the board entirely up to the document: no badge, no problem', async () => {
    // A connector that connects to nothing never reports anything, so the badge is
    // stuck at its first state and the board does not care.
    render(<App connect={noConnection} />);
    expect(badgeText()).toBe('Connecting…');
    fireEvent.click(screen.getByTestId('create-sticky'));
    await tick(1);
    expect(stickies().length).toBe(1);
  });
});
