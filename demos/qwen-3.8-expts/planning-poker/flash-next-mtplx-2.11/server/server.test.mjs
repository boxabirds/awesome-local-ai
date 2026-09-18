import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from './server.js';

function waitForState(ws, predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for state')),
      timeout,
    );
    function onMsg(raw) {
      const msg = JSON.parse(raw);
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

function connect(port, path = '/') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function freePort() {
  return 9000 + Math.floor(Math.random() * 1000);
}

test('two players join, both vote, room auto-reveals', async () => {
  const port = freePort();
  const server = createGameServer({ port });
  try {
    const a = await connect(port);
    const b = await connect(port);

    a.send(JSON.stringify({ type: 'join', roomId: 'room1', playerId: 'a', name: 'Ann' }));
    b.send(JSON.stringify({ type: 'join', roomId: 'room1', playerId: 'b', name: 'Bob' }));

    await waitForState(b, (m) => m.room.players.length === 2);

    // Bob should now see himself present.
    assert.ok(b);

    b.send(JSON.stringify({ type: 'vote', value: '5' }));
    const afterFirst = await waitForState(a, (m) =>
      m.room.players.every((p) => p.vote === null || p.vote === '5') &&
      m.room.phase === 'voting' &&
      m.room.players.find((p) => p.id === 'b')?.vote === '5',
    );
    assert.equal(afterFirst.room.phase, 'voting');

    a.send(JSON.stringify({ type: 'vote', value: '3' }));
    const revealed = await waitForState(b, (m) => m.room.phase === 'revealed');
    assert.equal(revealed.room.phase, 'revealed');
    const dist = {};
    for (const p of revealed.room.players) dist[p.vote] = (dist[p.vote] || 0) + 1;
    assert.equal(dist['5'], 1);
    assert.equal(dist['3'], 1);

    a.close();
    b.close();
  } finally {
    server.close();
  }
});

test('disconnect marks player as not connected when last socket leaves', async () => {
  const port = freePort();
  const server = createGameServer({ port });
  try {
    const a = await connect(port);
    a.send(JSON.stringify({ type: 'join', roomId: 'room2', playerId: 'a', name: 'Ann' }));
    await waitForState(a, (m) => m.room.players.length === 1);
    const closed = new Promise((r) => a.once('close', r));
    a.close();
    await closed;
    // Give the server a tick to process close.
    await new Promise((r) => setTimeout(r, 50));
    const room = server.getRoom('room2');
    assert.equal(room.players[0].connected, false);
  } finally {
    server.close();
  }
});
