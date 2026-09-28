/**
 * The test-only storage routes (wrangler.hooks.jsonc sets TEST_HOOKS=1) that
 * the story 4 e2e specs use to reach states no user interaction produces:
 * seeded boards, forced compaction, damaged and repaired snapshots.
 */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { connectRoom } from '../integration/ws-client';
import type { Env } from '../../src/worker';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(path: string): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`http://localhost${path}`, { method: 'POST' });
  expect(res.status, `${path} -> ${res.status}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`http://localhost${path}`);
  expect(res.status, `${path} -> ${res.status}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const num = (row: Record<string, unknown>, key: string): number => Number(row[key]);

describe('test hook routes', () => {
  it('seeds a board through the real write path and compacts it', async () => {
    const id = newBoardId();
    const seeded = await post(`/__test/boards/${id}/seed?notes=40`);
    expect(num(seeded, 'notes')).toBe(40);
    expect(num(seeded, 'snapshotChunks')).toBeGreaterThanOrEqual(1);

    const stats = await get(`/__test/boards/${id}/stats`);
    expect(num(stats, 'updates')).toBe(0); // folded into the snapshot
    expect(num(stats, 'snapshotChunks')).toBeGreaterThanOrEqual(1);

    const viewer = await connectRoom(id);
    await wait(500);
    expect(viewer.snapshot().length).toBe(40);
    viewer.close();
  });

  it('corrupts the snapshot, refuses clients, then repairs', async () => {
    const id = newBoardId();
    await post(`/__test/boards/${id}/seed?notes=30`);
    const before = await get(`/__test/boards/${id}/stats`);
    expect(before['state']).toBe('ready');

    const corrupted = await post(`/__test/boards/${id}/corrupt-snapshot`);
    expect(num(corrupted, 'chunks')).toBe(num(before, 'snapshotChunks'));
    expect((await get(`/__test/boards/${id}/stats`))['state']).toBe('load-failed');

    const closed: number[] = [];
    const blocked = await connectRoom(id, { onclose: (code) => closed.push(code) });
    await wait(400);
    expect(closed).toContain(CLOSE_BOARD_LOAD_FAILED);
    blocked.close();

    const repaired = await post(`/__test/boards/${id}/repair-snapshot`);
    expect(num(repaired, 'chunks')).toBe(num(corrupted, 'chunks'));

    // The repair clears the retry gate: the next connection loads the board.
    const recovered = await connectRoom(id);
    await wait(700);
    expect(recovered.snapshot().length).toBe(30);
    recovered.close();
  });

  it('rejects unknown actions and out-of-range counts', async () => {
    const id = newBoardId();
    const unknown = await SELF.fetch(`http://localhost/__test/boards/${id}/drop-everything`, {
      method: 'POST',
    });
    // Not a hook route, so the room never handled it: no JSON from the room.
    expect(unknown.headers.get('content-type') ?? '').not.toContain('application/json');

    const tooMany = await SELF.fetch(`http://localhost/__test/boards/${id}/seed?notes=99999`, {
      method: 'POST',
    });
    expect(tooMany.status).toBe(400);
  });
});
