import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { isValidBoardId } from '../../../src/shared/board-id.ts';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../../src/shared/protocol.ts';

const PORT = 8891;

interface Room {
  doc: Y.Doc;
  sockets: Set<WebSocket>;
}

let rooms: Map<string, Room> = new Map();
let server: Server | null = null;
let wss: WebSocketServer | null = null;

function getRoom(boardId: string): Room {
  let room = rooms.get(boardId);
  if (!room) {
    const doc = new Y.Doc();
    room = { doc, sockets: new Set() };
    const r = room;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      broadcastUpdate(r, update, origin);
    });
    rooms.set(boardId, room);
  }
  return room;
}

function frameSyncMessage(syncBytes: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, syncBytes);
  return encoding.toUint8Array(encoder);
}

function broadcastUpdate(room: Room, update: Uint8Array, origin: unknown): void {
  const syncEncoder = encoding.createEncoder();
  sync.writeUpdate(syncEncoder, update);
  const framed = frameSyncMessage(encoding.toUint8Array(syncEncoder));

  for (const socket of room.sockets) {
    if (socket === origin) continue;
    if (socket.readyState !== WebSocket.OPEN) {
      room.sockets.delete(socket);
      continue;
    }
    try {
      socket.send(framed);
    } catch {
      room.sockets.delete(socket);
    }
  }
}

function handleSyncMessage(room: Room, ws: WebSocket, payload: Uint8Array): void {
  const decoder = decoding.createDecoder(payload);
  const responseEncoder = encoding.createEncoder();
  sync.readSyncMessage(decoder, responseEncoder, room.doc, ws);
  const responseBytes = encoding.toUint8Array(responseEncoder);

  if (responseBytes.length > 0) {
    const framed = frameSyncMessage(responseBytes);
    ws.send(framed);
  }
}

export function startTestServer(): Promise<void> {
  return new Promise((resolve) => {
    rooms = new Map();
    
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
      const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);

      if (roomsMatch) {
        const boardId = decodeURIComponent(roomsMatch[1]);
        if (!isValidBoardId(boardId)) {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }
        const upgradeHeader = req.headers['upgrade'];
        if (upgradeHeader !== 'websocket') {
          res.writeHead(426);
          res.end('Upgrade Required');
          return;
        }
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>OK</body></html>');
    });

    wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: import('http').IncomingMessage, socket: import('net').Socket, head: Buffer) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
      const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);

      if (!roomsMatch) {
        socket.destroy();
        return;
      }

      const boardId = decodeURIComponent(roomsMatch[1]);
      if (!isValidBoardId(boardId)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        const room = getRoom(boardId);
        room.sockets.add(ws);

        const syncEncoder = encoding.createEncoder();
        sync.writeSyncStep1(syncEncoder, room.doc);
        const msg = frameSyncMessage(encoding.toUint8Array(syncEncoder));
        ws.send(msg);

        ws.on('message', (data) => {
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as Buffer);
          const decoded = decodeMessage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

          if (decoded.kind === 'invalid') {
            ws.close(CLOSE_UNSUPPORTED_DATA);
            return;
          }

          if (decoded.kind === 'sync') {
            try {
              handleSyncMessage(room, ws, decoded.payload);
            } catch {
              ws.close(CLOSE_UNSUPPORTED_DATA);
            }
          } else if (decoded.kind === 'awareness') {
            const bytesToSend = decoded.payload;
            for (const socket of room.sockets) {
              if (socket.readyState === WebSocket.OPEN) {
                try {
                  socket.send(bytesToSend);
                } catch {
                  room.sockets.delete(socket);
                }
              }
            }
          }
        });

        ws.on('close', () => { room.sockets.delete(ws); });
        ws.on('error', () => { room.sockets.delete(ws); });
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve();
      } else {
        resolve();
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      resolve();
    });
  });
}

let stopped = false;

export function stopTestServer(): Promise<void> {
  if (stopped) return Promise.resolve();
  stopped = true;
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    const srv = server;
    
    for (const room of rooms.values()) {
      for (const socket of room.sockets) {
        try { socket.close(); } catch {}
      }
    }
    rooms.clear();
    
    if (wss) {
      wss.close(() => {
        srv.close(() => resolve());
      });
    } else {
      srv.close(() => resolve());
    }
    setTimeout(resolve, 2000);
    server = null;
    wss = null;
  });
}
