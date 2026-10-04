import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/App';
import { connectBoard, type BoardConnection, type ConnectionState } from '../../src/client/sync/connectBoard';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { forgetProviders, theProvider } from './helpers/fake-provider';

// `connectBoard` builds a real `WebsocketProvider`, which would open a real socket to a server
// that is not there. The stub keeps the events and drops the network.
//
// The promise is not decoration: `vi.mock` calls are hoisted above the imports at the top of this
// file, so a factory that reached for `yWebsocketStub` as written below would find it
// uninitialized. Importing from inside the factory is what makes the hoisting work for us.
vi.mock('y-websocket', async () => yWebsocketStubFromHere());

/**
 * Written as a function called from inside the mock factory rather than as an `import` of the
 * helper there, because `vi.mock` calls are hoisted above the imports at the top of this file: a
 * factory that reached for `yWebsocketStub` as an already-imported value would find it
 * uninitialized. This is evaluated when the stub is actually asked for, which is after.
 */
async function yWebsocketStubFromHere(): Promise<{ WebsocketProvider: unknown }> {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
}

interface Seen extends Watch {
  handle: BoardConnection;
}

interface Watch {
  readonly states: ConnectionState[];
  latest(): ConnectionState;
}

function connect(boardId = 'b1'): Seen {
  const states: ConnectionState[] = [];
  const seen: Seen = {
    states,
    latest: () => {
      // The client reports *changes*; where it starts is the caller's decision (the app's own
      // starting state is `connecting`), so a test reads "nothing reported yet" as the same thing.
      return states.at(-1) ?? 'connecting';
    },
    handle: connectBoard(new Y.Doc(), boardId, (state) => {
      states.push(state);
    }),
  };
  return seen;
}

describe('what a closed socket means to the board', () => {
  beforeEach(() => {
    forgetProviders();
  });

  test('a board that loads: open is not the same as up to date (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    expect(provider.roomName).toBe('b1');

    provider.socketOpens();
    expect(seen.latest()).toBe('connecting');

    provider.sync();
    expect(seen.latest()).toBe('connected');
    expect(canEdit(seen.latest())).toBe(true);
    // The only thing said about a first load that works is that it worked: no `connecting` is
    // reported first, because the client reports changes and the app started there already.
    expect(seen.states).toEqual(['connected']);
  });

  test('close 4500 on the first load is a board that could not be loaded (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();

    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);

    expect(seen.latest()).toBe('load_failed');
    // The board on screen is not known to be the board, so it is not a board to type into.
    expect(canEdit(seen.latest())).toBe(false);
  });

  test('close 1011 is an interruption, not a missing board (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    provider.socketOpens();
    provider.sync();

    // The room's own write failed and it dropped everybody to go and read the board again.
    // This tab still has a board and its own unsaved changes, which it will send again when it
    // gets back in - so it says "Reconnecting…" and stays editable.
    provider.roomClosesWith(CLOSE_STORAGE_FAILURE);
    expect(seen.latest()).toBe('reconnecting');
    expect(canEdit(seen.latest())).toBe(true);
  });

  test('close 1003 is an interruption too (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    provider.socketOpens();
    provider.sync();

    provider.roomClosesWith(CLOSE_STORAGE_FAILURE);
    expect(seen.latest()).toBe('reconnecting');

    // A second close, this time because of a message this tab sent that the room could not read.
    provider.roomClosesWith(CLOSE_UNSUPPORTED_DATA);
    expect(seen.latest()).toBe('reconnecting');
    expect(canEdit(seen.latest())).toBe(true);
  });

  test('a board that failed to load comes back on the first sync, unaided (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    expect(seen.latest()).toBe('load_failed');

    // The provider is still trying: 4500 is in the range that means "try again later". The room
    // has read its board in the meantime, and the first thing that says so is a sync.
    provider.socketOpens();
    provider.sync();

    expect(seen.latest()).toBe('connected');
    expect(canEdit(seen.latest())).toBe(true);
    // Straight back to connected, without a "Connected" celebration in between: this tab never
    // lost a board it had, it gained one. (`connecting` is absent from the front of this because
    // the app starts there and the client only reports changes from wherever it was started.)
    expect(seen.states).toEqual(['load_failed', 'connected']);
  });

  test('a retry that fails again keeps saying the same thing (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    expect(seen.states).toEqual(['load_failed']);

    // The room is trying to read the board again. A connection that opens and closes with 4500
    // once more must not be reported as "Reconnecting…" on the way through, which would be the
    // client promising a board it has just been told there is no reading of.
    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);

    expect(seen.states).toEqual(['load_failed']);
  });

  test('a socket that dies without a code is not a board that failed to load (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();
    provider.socketOpens();
    provider.sync();

    // A null close event is the provider closing its own socket, or a network that produced no
    // code at all. Nothing here says anything about whether the board can be read.
    provider.socketFellOver();

    expect(seen.latest()).toBe('reconnecting');
    expect(canEdit(seen.latest())).toBe(true);
  });

  test('a board never yet loaded stays "Connecting…" when the socket goes (TC-28)', () => {
    const seen = connect();
    const provider = theProvider();

    // No sync has ever happened, so there is no board this tab had and lost. The honest message
    // is still that the board is on its way, and it is the close *code* that says otherwise -
    // which is why 4500 below, on the same timeline, does say so.
    provider.socketOpens();
    provider.socketFellOver();
    expect(seen.latest()).toBe('connecting');

    provider.socketOpens();
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    expect(seen.latest()).toBe('load_failed');
  });

  test('hanging up hands the connection back', () => {
    const seen = connect();
    const provider = theProvider();

    // A closed socket is not a destroyed connection: the provider goes when the component using
    // it goes, and only when its own teardown runs.
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    expect(provider.destroyed).toBe(false);

    seen.handle.destroy();
    expect(provider.destroyed).toBe(true);
  });
});
