import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/App';
import {
  connectBoard,
  type ConnectionState,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';

/** Fake provider event emitter matching the ProviderLike contract. */
function createFakeProvider() {
  const statusHandlers: Array<(e: { status: string }) => void> = [];
  const syncHandlers: Array<(b: boolean) => void> = [];
  const closeHandlers: Array<(e: CloseEvent | null) => void> = [];
  const fake = {
    destroyed: false,
    on(event: string, handler: (a: never) => void) {
      if (event === 'status') statusHandlers.push(handler as (e: { status: string }) => void);
      if (event === 'sync') syncHandlers.push(handler as (b: boolean) => void);
      if (event === 'connection-close')
        closeHandlers.push(handler as (e: CloseEvent | null) => void);
    },
    destroy() {
      fake.destroyed = true;
    },
    emitStatus(status: 'connecting' | 'connected' | 'disconnected') {
      for (const h of statusHandlers) h({ status });
    },
    emitSync(synced: boolean) {
      for (const h of syncHandlers) h(synced);
    },
    emitClose(code: number) {
      for (const h of closeHandlers) h({ code } as unknown as CloseEvent);
    },
  };
  return fake;
}

function connect(doc: Y.Doc) {
  const fake = createFakeProvider();
  const states: ConnectionState[] = [];
  const conn = connectBoard(doc, 'test-board', (s) => states.push(s), {
    providerFactory: () => fake as unknown as ProviderLike,
  });
  return { conn, fake, states };
}

describe('TC-22: load_failed badge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the exact red message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status') as HTMLElement;
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge.getAttribute('data-state')).toBe('load_failed');
    // red (jsdom may report the hex or its rgb() normalisation)
    expect(badge.style.color).toMatch(/#c5221f|rgb\(197,\s*34,\s*31\)/i);
  });

  it('is still visible (not hidden) while load_failed', () => {
    render(<ConnectionStatus state="load_failed" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });
});

describe('TC-28: close-code mapping', () => {
  afterEach(() => {
    cleanup();
  });

  it('4500 → load_failed (editing locked); 1011 and 1003 → reconnecting (editing stays on); first sync after load_failed → connected', () => {
    const { conn, fake, states } = connect(new Y.Doc());

    // The room fails to load: the provider is closed with 4500.
    fake.emitClose(CLOSE_BOARD_LOAD_FAILED);
    expect(states.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);

    // Provider retries: status events must not clear the red message,
    // and another 4500 keeps the state.
    fake.emitStatus('connecting');
    expect(states.at(-1)).toBe('load_failed');
    fake.emitClose(CLOSE_BOARD_LOAD_FAILED);
    expect(states.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);

    // Recovery without reload: the room loads and syncs.
    fake.emitStatus('connecting');
    fake.emitStatus('connected');
    fake.emitSync(true);
    expect(states.at(-1)).toBe('connected');
    expect(canEdit('connected')).toBe(true);

    // Storage failure (1011): the board is still readable — reconnecting,
    // editing stays enabled (unsaved changes are re-sent on reconnect).
    fake.emitClose(CLOSE_STORAGE_FAILURE);
    expect(states.at(-1)).toBe('reconnecting');
    expect(canEdit('reconnecting')).toBe(true);

    // 1003 (unsupported data) also maps to reconnecting, not load_failed.
    fake.emitClose(1003);
    expect(states.at(-1)).toBe('reconnecting');
    expect(canEdit('reconnecting')).toBe(true);

    conn.destroy();
    expect(fake.destroyed).toBe(true);
  });

  it('a close before the first sync (other than 4500) keeps Connecting…', () => {
    const { conn, fake, states } = connect(new Y.Doc());
    fake.emitClose(1006); // network drop during the first load
    expect(states.at(-1)).toBe('connecting');
    expect(canEdit('connecting')).toBe(true);
    conn.destroy();
  });
});
