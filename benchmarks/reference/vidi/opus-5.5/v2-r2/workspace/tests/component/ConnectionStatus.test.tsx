import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  type ConnectionState,
  type ProviderEvents,
  trackConnectionState,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

// Captures connectBoard's state callback so the App test can drive the badge.
const connectCalls = vi.hoisted(() => [] as ((s: string) => void)[]);
const destroyed = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
      connectCalls.push(onState);
      onState('connecting');
      return {
        destroy() {
          destroyed.count++;
        },
      };
    },
  };
});

const { App } = await import('../../src/client/App');

type Status = 'connecting' | 'connected' | 'disconnected';

/** Stands in for the y-websocket provider's `status` / `sync` events. */
class FakeProvider implements ProviderEvents {
  private handlers = new Map<string, Set<(arg: never) => void>>();
  on(event: string, handler: (arg: never) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (arg: never) => void): void {
    this.handlers.get(event)?.delete(handler);
  }
  private emit(event: string, arg: unknown) {
    act(() => {
      for (const h of this.handlers.get(event) ?? []) (h as (a: unknown) => void)(arg);
    });
  }
  status(status: Status) {
    this.emit('status', { status });
    if (status === 'disconnected') this.emit('sync', false);
  }
  /** Socket open and synced. */
  connect() {
    this.status('connected');
    this.emit('sync', true);
  }
}

function Harness(props: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => trackConnectionState(props.provider, setState).destroy, [props.provider]);
  return <ConnectionStatus state={state} />;
}

function setup() {
  vi.useFakeTimers();
  const provider = new FakeProvider();
  render(<Harness provider={provider} />);
  return provider;
}

const badge = () => screen.queryByRole('status');

describe('ConnectionStatus', () => {
  it('TC-19: shows "Connecting…" while first loading, then hides once connected', () => {
    const provider = setup();
    expect(badge()?.textContent).toBe('Connecting…');
    provider.status('connecting');
    expect(badge()?.textContent).toBe('Connecting…');
    // Socket open but not yet synced: still connecting.
    provider.status('connected');
    expect(badge()?.textContent).toBe('Connecting…');
    provider.connect();
    expect(badge()).toBeNull();
  });

  it('keeps "Connecting…" (not "Reconnecting…") when the first attempts fail', () => {
    const provider = setup();
    provider.status('disconnected');
    provider.status('connecting');
    expect(badge()?.textContent).toBe('Connecting…');
    provider.connect();
    expect(badge()).toBeNull();
  });

  it('TC-20: "Reconnecting…" while disconnected, then "Connected" for exactly CONNECTED_CONFIRMATION_MS', () => {
    const provider = setup();
    provider.connect();
    expect(badge()).toBeNull();
    provider.status('disconnected');
    expect(badge()?.textContent).toBe('Reconnecting…');
    // Failed retries keep the amber badge.
    provider.status('connecting');
    provider.status('disconnected');
    expect(badge()?.textContent).toBe('Reconnecting…');
    provider.connect();
    expect(badge()?.textContent).toBe('Connected');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(badge()?.textContent).toBe('Connected');
    act(() => vi.advanceTimersByTime(1));
    expect(badge()).toBeNull();
  });

  it('TC-21: a new disconnect during the confirmation shows "Reconnecting…" immediately', () => {
    const provider = setup();
    provider.connect();
    provider.status('disconnected');
    provider.connect();
    expect(badge()?.textContent).toBe('Connected');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2));
    provider.status('disconnected');
    expect(badge()?.textContent).toBe('Reconnecting…');
    // The old confirmation timer must not hide the amber badge.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(badge()?.textContent).toBe('Reconnecting…');
  });

  it.each([
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['confirmed', 'Connected'],
  ] as const)('renders %s as a status badge reading "%s"', (state, text) => {
    render(<ConnectionStatus state={state} />);
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.getByRole('status').getAttribute('data-state')).toBe(state);
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the board editable in every connection state (no lockout while reconnecting)', () => {
    connectCalls.length = 0;
    const doc = new Y.Doc();
    render(<App doc={doc} boardId="AAAAAAAAAAAAAAAAAAAAAA" />);
    const onState = connectCalls.at(-1)!;
    const create = () => fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    for (const state of ['connecting', 'connected', 'reconnecting', 'confirmed'] as const) {
      act(() => onState(state));
      const before = doc.getMap('objects').size;
      create();
      expect(doc.getMap('objects').size).toBe(before + 1);
      fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    }
    act(() => onState('reconnecting'));
    expect(screen.getByText('Reconnecting…').getAttribute('role')).toBe('status');
  });

  it('destroys the board connection on unmount (no reconnects after leaving)', () => {
    connectCalls.length = 0;
    destroyed.count = 0;
    const { unmount } = render(<App doc={new Y.Doc()} boardId="AAAAAAAAAAAAAAAAAAAAAA" />);
    expect(connectCalls).toHaveLength(1);
    unmount();
    expect(destroyed.count).toBe(1);
  });

  it('never connects without a board id', () => {
    connectCalls.length = 0;
    render(<App doc={new Y.Doc()} />);
    expect(connectCalls).toHaveLength(0);
    expect(screen.queryByText('Connecting…')).toBeNull();
  });
});
