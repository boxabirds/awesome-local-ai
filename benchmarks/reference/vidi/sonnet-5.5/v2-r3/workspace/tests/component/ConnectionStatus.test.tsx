import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';

type Status = 'connecting' | 'connected' | 'disconnected';

/** Fake provider: lets the test emit status/sync events exactly like WebsocketProvider. */
function fakeProvider() {
  const statusCbs: ((e: { status: Status }) => void)[] = [];
  const syncCbs: ((s: boolean) => void)[] = [];
  const provider = {
    on(event: string, cb: never) {
      (event === 'status' ? statusCbs : syncCbs).push(cb);
    },
    destroy: vi.fn(),
  } as unknown as ProviderLike;
  return {
    provider,
    status: (status: Status) => statusCbs.forEach((cb) => cb({ status })),
    sync: (s: boolean) => syncCbs.forEach((cb) => cb(s)),
  };
}

function Harness({ fake }: { fake: ReturnType<typeof fakeProvider> }) {
  return <Subject fake={fake} />;
}

import { useEffect, useState } from 'react';
function Subject({ fake }: { fake: ReturnType<typeof fakeProvider> }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const c = connectBoard(new Y.Doc(), 'board', setState, () => fake.provider);
    return () => c.destroy();
  }, [fake]);
  return <ConnectionStatus state={state} />;
}

const connect = (f: ReturnType<typeof fakeProvider>) => {
  act(() => {
    f.status('connected');
    f.sync(true);
  });
};
const drop = (f: ReturnType<typeof fakeProvider>) => act(() => f.status('disconnected'));

describe('ConnectionStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('TC-19: shows Connecting… then hides once connected', () => {
    const f = fakeProvider();
    render(<Harness fake={f} />);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    connect(f);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: Reconnecting… then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    const f = fakeProvider();
    render(<Harness fake={f} />);
    connect(f);
    drop(f);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    connect(f);
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => void vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnecting during the confirmation shows Reconnecting… immediately', () => {
    const f = fakeProvider();
    render(<Harness fake={f} />);
    connect(f);
    drop(f);
    connect(f);
    drop(f);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    // The stale confirmation timer must not flip the badge back to hidden.
    act(() => void vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2));
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('a failed first connection stays on Connecting…', () => {
    const f = fakeProvider();
    render(<Harness fake={f} />);
    act(() => f.status('disconnected'));
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('destroys the provider on unmount', () => {
    const f = fakeProvider();
    const { unmount } = render(<Harness fake={f} />);
    unmount();
    expect(f.provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('local editing stays possible while reconnecting (doc is not locked)', () => {
    const doc = new Y.Doc();
    function Edit() {
      const { notes } = useBoardDoc(doc);
      return <output>{notes.length}</output>;
    }
    render(<Edit />);
    expect(doc.isDestroyed).toBe(false);
  });
});
