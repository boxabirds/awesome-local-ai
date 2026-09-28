import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { trackConnectionState, type ConnectionState } from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { noteElements } from './helpers';
import { FakeProvider } from './fakeProvider';

function Harness(props: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => trackConnectionState(props.provider, setState), [props.provider]);
  return <ConnectionStatus state={state} />;
}

function badge() {
  return screen.queryByRole('status', { name: 'Connection status' });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  vi.doUnmock('../../src/client/sync/connectBoard');
  vi.resetModules();
});

describe('sync.client: connection status badge', () => {
  it('TC-19 shows "Connecting…" while first loading, then hides once synced', () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.status('connecting');
    expect(badge()).toHaveTextContent('Connecting…');
    // Socket open but not yet synced: still connecting.
    provider.status('connected');
    expect(badge()).toHaveTextContent('Connecting…');
    provider.sync(true);
    expect(badge()).toBeNull();
  });

  it('a failed first connection keeps showing "Connecting…" (not Reconnecting)', () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.status('connecting');
    provider.status('disconnected');
    provider.status('connecting');
    expect(badge()).toHaveTextContent('Connecting…');
  });

  it('TC-20 outage: "Reconnecting…", then "Connected" for exactly CONNECTED_CONFIRMATION_MS, then hidden', () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connect();
    expect(badge()).toBeNull();

    provider.drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    expect(badge()).toHaveAttribute('data-state', 'reconnecting');
    advance(CONNECTED_CONFIRMATION_MS * 3); // stays while the outage lasts
    expect(badge()).toHaveTextContent('Reconnecting…');

    provider.connect();
    expect(badge()).toHaveTextContent('Connected');
    expect(badge()).toHaveAttribute('data-state', 'confirmed');
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()).toHaveTextContent('Connected');
    advance(1);
    expect(badge()).toBeNull();
  });

  it('TC-21 a new outage during the confirmation shows "Reconnecting…" immediately', () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connect();
    provider.drop();
    provider.connect();
    advance(CONNECTED_CONFIRMATION_MS / 2);
    expect(badge()).toHaveTextContent('Connected');
    provider.drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    // The old confirmation timer must not hide the badge during the new outage.
    advance(CONNECTED_CONFIRMATION_MS);
    expect(badge()).toHaveTextContent('Reconnecting…');
  });

  it.each([
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['confirmed', 'Connected'],
  ] as const)('the %s badge is a status region reading "%s"', (state, text) => {
    render(<ConnectionStatus state={state} />);
    expect(screen.getByRole('status', { name: 'Connection status' })).toHaveTextContent(text);
  });

  it('the board stays editable in every connection state (no lockout while reconnecting)', async () => {
    const provider = new FakeProvider();
    let destroyed = 0;
    vi.doMock('../../src/client/sync/connectBoard', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
      return {
        ...real,
        connectBoard: (_doc: Y.Doc, _id: string, onState: (s: ConnectionState) => void) => {
          const stop = real.trackConnectionState(provider, onState);
          return { destroy: () => (stop(), destroyed++) };
        },
      };
    });
    const { App } = await import('../../src/client/App');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    const doc = new Y.Doc();
    const { unmount } = render(<App boardId="AbCdEfGhIjKlMnOpQr_-09" doc={doc} />);
    const viewport = screen.getByTestId('board-viewport');
    const create = () => act(() => screen.getByRole('button', { name: 'Sticky note' }).click());

    expect(badge()).toHaveTextContent('Connecting…');
    create();
    provider.connect();
    expect(badge()).toBeNull();
    create();
    provider.drop();
    expect(badge()).toHaveTextContent('Reconnecting…');
    create();
    provider.connect();
    expect(badge()).toHaveTextContent('Connected');
    create();
    expect(snapshot(doc)).toHaveLength(4);
    expect(noteElements()).toHaveLength(4);
    expect(viewport).not.toHaveAttribute('aria-disabled');
    unmount();
    expect(destroyed).toBe(1);
  });
});
