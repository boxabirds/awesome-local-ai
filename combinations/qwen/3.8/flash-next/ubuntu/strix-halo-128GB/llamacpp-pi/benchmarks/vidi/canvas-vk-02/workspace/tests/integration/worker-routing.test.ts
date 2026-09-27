/**
 * Worker entry routing (design "sync.worker"). Four paths, three outcomes:
 * an invalid board id is its own error, a WebSocket upgrade goes to the room,
 * everything else — `/`, `/b/<id>`, asset paths, unknown paths — is the client.
 */

import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { isValidBoardId } from '../../src/shared/board-id';
import type { Env } from '../../src/worker';

const VALID = 'ABCDEFGHabcdefgh0123-_';

async function upgradeResponse(boardId: string): Promise<Response> {
  return SELF.fetch(`http://board.example/api/rooms/${boardId}`, {
    headers: { upgrade: 'websocket' },
  });
}

describe('the board id is the contract', () => {
  it('TC-04: an invalid board id is a 400 naming it, and never a room', async () => {
    for (const bad of ['', 'short', 'has space', 'has/slash', 'x'.repeat(23), '%20'.repeat(8)]) {
      const response = await upgradeResponse(encodeURIComponent(bad));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('Invalid board id');
    }
  });

  it('TC-05: an upgrade is accepted by the room for a valid board id', async () => {
    const response = await upgradeResponse(VALID);
    // 101 is the upgrade: workerd hands the connection to the room, which a
    // plain Response can never produce. The socket itself is exercised by every
    // test in board-room.test.ts, which connects through this same route.
    expect(response.status).toBe(101);
    expect(isValidBoardId(VALID)).toBe(true);
  });

  it('TC-06: everything else reaches the client, including a reload of /b/<id>', async () => {
    const boardId = newDocId();
    const initial = await SELF.fetch(`http://board.example/b/${boardId}`);
    expect(initial.status).toBe(200);
    expect(await initial.text()).toContain('<div id="root">');
    const reloaded = await SELF.fetch(`http://board.example/b/${boardId}`);
    expect(await reloaded.text()).toContain('<div id="root">');
  });
});

/** A board id for a test that needs one that no other test has used. */
function newDocId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
