import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { click, notes, renderApp } from './helpers';
import { useState } from 'react';
import { useEffect } from 'react';

type Status = 'connecting' | 'connected' | 'disconnected';

/** Fake provider: tests emit status and sync events by hand. */
function fakeProvider() {
  const handlers: { status: ((e: { status: Status }) => void)[]; sync: ((s: boolean) => void)[] } = { status: [], sync: [] };
  const provider = {
    on(event: 'status' | 'sync', cb: never) {
      (handlers[event] as unknown[]).push(cb);
    },
    destroy: vi.fn(),
  } as unknown as ProviderLike;
  return {
    provider,
    status: (status: Status) => handlers.status.forEach((h) => h({ status })),
    sync: (s: boolean) => handlers.sync.forEach((h) => h(s)),
  };
}

function Harness({ fake }: { fake: ReturnType<typeof fakeProvider> }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const conn = connectBoard(new Y.Doc(), 'board', setState, () => fake.provider);
    return () => conn.destroy();
  }, [fake]);
  return <ConnectionStatus state={state} />;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function connect(fake: ReturnType<typeof fakeProvider>) {
  act(() => { fake.status('connecting'); });
  act(() => { fake.status('connected'); });
  act(() => { fake.sync(true); });
}

describe('ConnectionStatus', () => {
  it('TC-19: Connecting… then hidden once synced', () => {
    const fake = fakeProvider();
    render(<Harness fake={fake} />);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    connect(fake);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays on Connecting… when the first connection attempt fails', () => {
    const fake = fakeProvider();
    render(<Harness fake={fake} />);
    act(() => { fake.status('disconnected'); });
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('TC-20: Reconnecting… → Connected for exactly CONNECTED_CONFIRMATION_MS → hidden', () => {
    const fake = fakeProvider();
    render(<Harness fake={fake} />);
    connect(fake);
    act(() => { fake.status('disconnected'); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { fake.status('connecting'); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { fake.status('connected'); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { fake.sync(true); });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1); });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnecting during the confirmation shows Reconnecting… immediately', () => {
    const fake = fakeProvider();
    render(<Harness fake={fake} />);
    connect(fake);
    act(() => { fake.status('disconnected'); });
    act(() => { fake.sync(true); });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { fake.status('disconnected'); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('destroy tears the provider down', () => {
    const fake = fakeProvider();
    const { unmount } = render(<Harness fake={fake} />);
    unmount();
    expect(fake.provider.destroy).toHaveBeenCalled();
  });

  it('the board stays editable while reconnecting', () => {
    const { doc } = renderApp([{ x: 0, y: 0 }]);
    render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByText('Reconnecting…').getAttribute('role')).toBe('status');
    click(notes()[0], 500, 400);
    expect(notes()[0].getAttribute('data-selected')).toBe('true');
    expect(doc.getMap('objects').size).toBe(1);
  });
});
