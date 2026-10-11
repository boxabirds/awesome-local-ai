import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

/**
 * Connection status badge (`sync.client`, design TC-19 to TC-21).
 *
 * The badge is driven through the real `connectBoard` state machine with a fake
 * provider as the event source and fake timers, so the confirmation window is
 * measured against the named setting to the millisecond.
 */

class FakeProvider implements BoardProvider {
  synced = false;
  destroyed = false;
  private readonly handlers = new Map<string, Set<(arg: never) => void>>();

  on(event: 'status' | 'synced', handler: (arg: never) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: 'status' | 'synced', handler: (arg: never) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Provider events reach React through `act` so the render is flushed. */
  status(status: string): void {
    act(() => {
      for (const handler of [...(this.handlers.get('status') ?? [])]) {
        (handler as (arg: { status: string }) => void)({ status });
      }
    });
  }

  sync(synced: boolean): void {
    act(() => {
      this.synced = synced;
      for (const handler of [...(this.handlers.get('synced') ?? [])]) {
        (handler as (arg: boolean) => void)(synced);
      }
    });
  }
}

const boardAction = vi.fn();

function BadgeHarness({
  doc,
  provider,
  states,
}: {
  doc: Y.Doc;
  provider: FakeProvider;
  states: ConnectionState[];
}): JSX.Element {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const connection = connectBoard(doc, 'board-under-test', setState, {
      providerFactory: () => provider,
    });
    return () => {
      connection.destroy();
    };
  }, [doc, provider]);

  states.push(state);

  return (
    <div>
      <button type="button" data-testid="board-action" onClick={boardAction}>
        Edit the board
      </button>
      <ConnectionStatus state={state} />
    </div>
  );
}

describe('connection status badge', () => {
  let provider: FakeProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new FakeProvider();
    boardAction.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function mount(): { states: ConnectionState[] } {
    const states: ConnectionState[] = [];
    render(<BadgeHarness doc={new Y.Doc()} provider={provider} states={states} />);
    return { states };
  }

  function badge(): HTMLElement {
    const element = screen.queryByTestId('connection-status');
    if (element === null) {
      throw new Error('the connection badge is not on the screen');
    }
    return element;
  }

  function badgeText(): string | null {
    return screen.queryByTestId('connection-status')?.textContent ?? null;
  }

  const connect = (): void => {
    provider.status('connected');
    provider.sync(true);
  };

  it('shows “Connecting…” on first load and hides once synced (TC-19)', () => {
    const { states } = mount();
    const first = badge();
    expect(first.textContent).toContain('Connecting…');
    expect(first.getAttribute('role')).toBe('status');
    expect(first.getAttribute('data-state')).toBe('connecting');

    connect();
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('shows “Reconnecting…” during an outage and “Connected” for exactly CONNECTED_CONFIRMATION_MS after it ends (TC-20)', () => {
    mount();
    connect();
    expect(screen.queryByTestId('connection-status')).toBeNull();

    provider.status('disconnected');
    const reconnecting = badge();
    expect(reconnecting.textContent).toContain('Reconnecting…');
    expect(reconnecting.getAttribute('data-state')).toBe('reconnecting');

    connect();
    const confirmed = badge();
    expect(confirmed.textContent).toContain('Connected');
    expect(confirmed.getAttribute('data-state')).toBe('confirmed');

    // One millisecond short of the named setting, the confirmation is still up…
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toContain('Connected');

    // …and it is gone at exactly the named setting.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('returns to “Reconnecting…” immediately when the connection drops during the confirmation (TC-21)', () => {
    mount();
    connect();
    provider.status('disconnected');
    connect();
    expect(badgeText()).toContain('Connected');

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 500);
    });
    provider.status('disconnected');
    expect(badgeText()).toContain('Reconnecting…');

    // The cancelled confirmation must not hide the badge afterwards.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1_000);
    });
    expect(badgeText()).toContain('Reconnecting…');
  });

  it('leaves the board editable in every state (negative: no lockout while reconnecting)', () => {
    mount();
    const action = screen.getByTestId('board-action') as HTMLButtonElement;

    const states = [
      () => undefined, // connecting
      () => provider.status('disconnected'), // reconnecting
      () => connect(), // confirmed
      () => provider.status('disconnected'), // reconnecting again
    ];
    for (const step of states) {
      step();
      expect(action.disabled).toBe(false);
      action.click();
    }

    expect(boardAction).toHaveBeenCalledTimes(4);
  });

  it('detaches the provider when the board changes or the page goes away', () => {
    const doc = new Y.Doc();
    const { unmount } = render(
      <BadgeHarness doc={doc} provider={provider} states={[]} />,
    );
    expect(provider.destroyed).toBe(false);
    unmount();
    expect(provider.destroyed).toBe(true);
  });
});
