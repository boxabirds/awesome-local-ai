// share.board_api / share.unguessable: link codes and board creation outcomes.
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createBoard } from '../../src/worker/create-board';
import type { Env } from '../../src/worker/index';

describe('TC-04 link codes', () => {
  it('10,000 newBoardId() are unique, 22 characters, match BOARD_ID_PATTERN', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('come from at least 16 cryptographically random bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const id = newBoardId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(BOARD_ID_BYTES);
    expect(atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==')).toHaveLength(BOARD_ID_BYTES);
    spy.mockRestore();
  });

  it('are not derived from time or order: same clock, unrelated codes', () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const a = newBoardId();
      const b = newBoardId();
      expect(a).not.toBe(b);
      // No shared prefix beyond what chance allows (a counter or timestamp would share most of it).
      let common = 0;
      while (common < a.length && a[common] === b[common]) common++;
      expect(common).toBeLessThan(8);
    } finally {
      vi.useRealTimers();
    }
  });
});

function fakeEnv(initialize: () => Promise<'created' | 'exists'>) {
  const names: string[] = [];
  const env = {
    BOARD_ROOM: {
      idFromName: (name: string) => {
        names.push(name);
        return name;
      },
      get: () => ({ initialize }),
    },
  } as unknown as Env;
  return { env, names };
}

describe('createBoard', () => {
  it('initialises the room of one fresh id and returns it', async () => {
    const { env, names } = fakeEnv(async () => 'created');
    const result = await createBoard(env);
    expect(result).toEqual({ ok: true, id: names[0] });
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(BOARD_ID_PATTERN);
  });

  it('fails without retrying when the fresh id already exists', async () => {
    const initialize = vi.fn(async () => 'exists' as const);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createBoard(fakeEnv(initialize).env);
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
    expect(initialize).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('fails when the RPC throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createBoard(
      fakeEnv(async () => {
        throw new Error('rpc down');
      }).env,
    );
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
    error.mockRestore();
  });
});
