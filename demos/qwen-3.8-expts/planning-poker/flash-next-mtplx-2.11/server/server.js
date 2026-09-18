import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import {
  createRoom,
  addPlayer,
  setConnected,
  castVote,
  reveal,
  startRound,
  setTopic,
  allVoted,
} from './game.mjs';

const PORT = Number(process.env.PORT || 8787);

export function createGameServer({ port = PORT } = {}) {
  const wss = new WebSocketServer({ port });
  const rooms = new Map(); // roomId -> room (authoritative state)
  const clients = new Map(); // ws -> { roomId, playerId }

  function getRoom(roomId) {
    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId);
      rooms.set(roomId, room);
    }
    return room;
  }

  function roomClients(roomId) {
    return [...clients.entries()].filter(
      ([, meta]) => meta.roomId === roomId,
    );
  }

  function broadcast(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const payload = JSON.stringify({ type: 'state', room });
    for (const [ws] of roomClients(roomId)) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  function apply(roomId, fn) {
    const room = fn(getRoom(roomId));
    rooms.set(roomId, room);
    broadcast(roomId);
    return room;
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const meta = clients.get(ws);

      if (msg.type === 'join') {
        const { roomId, playerId, name } = msg;
        if (!roomId || !playerId) return;
        clients.set(ws, { roomId, playerId });
        apply(roomId, (room) => addPlayer(room, playerId, name || 'Anonymous'));
        return;
      }

      if (!meta) return;
      const { roomId, playerId } = meta;

      if (msg.type === 'vote') {
        apply(roomId, (room) => {
          let next = castVote(room, playerId, msg.value);
          if (allVoted(next)) next = reveal(next);
          return next;
        });
      } else if (msg.type === 'reveal') {
        apply(roomId, (room) => reveal(room));
      } else if (msg.type === 'reset') {
        apply(roomId, (room) => startRound(room));
      } else if (msg.type === 'topic') {
        const text = String(msg.text ?? '').trim().slice(0, 120);
        apply(roomId, (room) => (text ? setTopic(room, text) : room));
      }
    });

    ws.on('close', () => {
      const meta = clients.get(ws);
      clients.delete(ws);
      if (!meta) return;
      const stillHere = roomClients(meta.roomId).some(
        ([, m]) => m.playerId === meta.playerId,
      );
      if (!stillHere) {
        apply(meta.roomId, (room) =>
          setConnected(room, meta.playerId, false),
        );
      }
    });
  });

  function close() {
    for (const [ws] of clients) ws.terminate();
    wss.close();
  }

  return { wss, rooms, clients, close, getRoom };
}

const isEntry =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntry) {
  const server = createGameServer();
  console.log(`Planning poker server listening on ws://localhost:${PORT}`);
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}
