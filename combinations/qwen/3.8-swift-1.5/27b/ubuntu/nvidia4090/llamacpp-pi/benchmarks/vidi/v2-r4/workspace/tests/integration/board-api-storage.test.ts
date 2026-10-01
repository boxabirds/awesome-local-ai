import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import type { BoardRoom } from '../../src/worker/board-room';

describe('TC-06 (storage): probing an unknown link does not create storage', () => {
  it('existsReadOnly returns false and no tables exist for a fresh id', async () => {
    const freshId = newBoardId();
    const doId = env.BOARD_ROOM.idFromName(freshId);
    const stub = env.BOARD_ROOM.get(doId);

    const result = await runInDurableObject(stub, (room: BoardRoom) => {
      const store = (room as any).store;
      const exists = store.existsReadOnly();
      const tables = store.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).toArray();
      return { exists, tableCount: tables.length };
    });

    expect(result.exists).toBe(false);
    expect(result.tableCount).toBe(0);
  });
});

describe('TC-09: WebSocket upgrade to unknown id returns 404, no tables created', () => {
  it('fetch with WebSocket upgrade to non-existent board returns 404, no tables', async () => {
    const freshId = newBoardId();
    const doId = env.BOARD_ROOM.idFromName(freshId);
    const stub = env.BOARD_ROOM.get(doId);

    const result = await runInDurableObject(stub, async (room: BoardRoom) => {
      const req = new Request('http://localhost/api/rooms/test', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      const response = await room.fetch(req);
      const store = (room as any).store;
      const exists = store.existsReadOnly();
      const tables = store.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).toArray();
      return { exists, tableCount: tables.length, responseStatus: response.status };
    });

    expect(result.exists).toBe(false);
    expect(result.tableCount).toBe(0);
    expect(result.responseStatus).toBe(404);
  });
});

describe('TC-08: legacy board (updates row without created_at) returns 200', () => {
  it('seed updates row without created_at; existence check returns true', async () => {
    const boardId = newBoardId();
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);

    const exists = await runInDurableObject(stub, (room: BoardRoom) => {
      const store = (room as any).store;
      store.migrate();
      // Insert an update row (legacy data)
      const updateBytes = new Uint8Array([0, 1, 2, 3, 4]);
      store.storage.sql.exec(
        'INSERT INTO updates (data, bytes) VALUES (?, ?)',
        updateBytes,
        updateBytes.length,
      );
      // Do NOT set created_at
      return store.existsReadOnly();
    });
    expect(exists).toBe(true);
  });
});

describe('TC-15: initialize() twice - first created, second exists; created_at unchanged', () => {
  it('calling initialize twice returns created then exists; created_at unchanged', async () => {
    const boardId = newBoardId();
    const doId = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(doId);

    const result = await runInDurableObject(stub, async (room: BoardRoom) => {
      const first = await room.initialize();
      const store = (room as any).store;
      const rows1 = store.storage.sql.exec(
        "SELECT value FROM storage_meta WHERE key='created_at'"
      ).toArray();
      const createdAt1 = rows1.length > 0 ? (rows1[0] as any).value : null;

      const second = await room.initialize();
      const rows2 = store.storage.sql.exec(
        "SELECT value FROM storage_meta WHERE key='created_at'"
      ).toArray();
      const createdAt2 = rows2.length > 0 ? (rows2[0] as any).value : null;

      return { first, second, createdAt1, createdAt2 };
    });

    expect(result.first).toBe('created');
    expect(result.second).toBe('exists');
    expect(result.createdAt1).not.toBeNull();
    expect(result.createdAt2).toBe(result.createdAt1);
  });
});
