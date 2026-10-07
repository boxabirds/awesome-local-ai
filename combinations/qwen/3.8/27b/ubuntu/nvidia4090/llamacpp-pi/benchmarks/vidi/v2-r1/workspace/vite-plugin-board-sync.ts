// Vite plugin that adds a WebSocket endpoint for board sync on the same port
// as the Vite dev server. Inlined dependencies to avoid module resolution issues.

import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { isValidBoardId, newBoardId } from './src/shared/board-id';

/**
 * In-memory stand-in for the Worker's board API (story 5) on the Vite dev
 * server. The dev server has no persistent storage, so "a board exists" is
 * "the id is well formed" — the pre-story-5 room semantics, which keep the
 * story 1–4 e2e specs (they open /b/<id> directly) working. The real
 * unknown-board 404s are proven against `wrangler dev` in share.spec.ts.
 */
function handleBoardApi(req: { method?: string; url?: string }, res: { writeHead(code: number, headers?: Record<string, string>): void; end(body?: string): void }): void {
  const path = (req.url ?? '').split('?')[0];
  const json = (code: number, body: Record<string, unknown>) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (path === '/api/boards') {
    if (req.method === 'POST') {
      json(201, { id: newBoardId() });
      return;
    }
    json(405, { error: 'method_not_allowed' });
    return;
  }
  const match = path.match(/^\/api\/boards\/([^/]+)$/);
  if (match !== null) {
    if (req.method !== 'GET') {
      json(405, { error: 'method_not_allowed' });
      return;
    }
    const id = match[1];
    if (isValidBoardId(id)) json(200, { id });
    else json(404, { error: 'not_found' });
  }
}

// Inlined from src/shared/protocol.ts
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const CLOSE_UNSUPPORTED_DATA = 1003;

function decodeMessage(bytes: Uint8Array):
  | { kind: 'invalid' }
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' } {
  try {
    const decoder = decoding.createDecoder(bytes);
    const kind = decoding.readVarUint(decoder);
    if (kind === MESSAGE_SYNC) {
      const payload = bytes.slice(decoder.pos);
      return { kind: 'sync', payload };
    }
    if (kind === MESSAGE_AWARENESS) {
      const payload = bytes.slice(decoder.pos);
      return { kind: 'awareness', payload };
    }
    if (kind === 3) {
      return { kind: 'query-awareness' };
    }
    return { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

class NodeBoardRoom {
  private sockets: Set<WebSocket> = new Set();
  private doc: Y.Doc | null = null;

  accept(ws: WebSocket): void {
    if (!this.doc) {
      this.doc = new Y.Doc();
    }

    this.sockets.add(ws);

    ws.on('message', (data) => {
      this.handleMessage(ws, data as Buffer);
    });

    ws.on('close', () => { this.sockets.delete(ws); });
    ws.on('error', () => { this.sockets.delete(ws); });
  }

  private sendSyncStep1(ws: WebSocket): void {
    if (!this.doc || ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeSyncStep1(enc, this.doc);
    const bytes = encoding.toUint8Array(enc);
    ws.send(bytes);
  }

  private broadcastUpdate(update: Uint8Array, except: WebSocket): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    const bytes = encoding.toUint8Array(enc);

    for (const ws of this.sockets) {
      if (ws === except) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try { ws.send(bytes); } catch { this.sockets.delete(ws); }
    }
  }

  private handleMessage(ws: WebSocket, data: Buffer): void {
    if (!this.doc) return;

    const decoded = decodeMessage(new Uint8Array(data));

    if (decoded.kind === 'invalid') { ws.close(CLOSE_UNSUPPORTED_DATA); return; }

    if (decoded.kind === 'awareness') {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeUint8Array(enc, decoded.payload);
      const bytes = encoding.toUint8Array(enc);
      for (const s of this.sockets) {
        if (s.readyState !== WebSocket.OPEN) continue;
        try { s.send(bytes); } catch { this.sockets.delete(s); }
      }
      return;
    }

    if (decoded.kind === 'sync') {
      try {
        const decoder = decoding.createDecoder(decoded.payload);
        const subType = decoding.readVarUint(decoder);

        if (subType === 2) {
          const update = decoding.readVarUint8Array(decoder);
          Y.applyUpdate(this.doc, update, ws);
          this.broadcastUpdate(update, ws);
        } else if (subType === 1) {
          const update = decoding.readVarUint8Array(decoder);
          if (update.length > 0) {
            Y.applyUpdate(this.doc, update, ws);
            this.broadcastUpdate(update, ws);
          }
        } else if (subType === 0) {
          const stateVector = decoding.readVarUint8Array(decoder);
          const update = Y.encodeStateAsUpdate(this.doc, stateVector);
          if (update.length > 0) {
            const enc = encoding.createEncoder();
            encoding.writeVarUint(enc, MESSAGE_SYNC);
            sync.writeSyncStep2(enc, this.doc, stateVector);
            ws.send(encoding.toUint8Array(enc));
          }
        }
      } catch { ws.close(CLOSE_UNSUPPORTED_DATA); }
    }
  }
}

const rooms = new Map<string, NodeBoardRoom>();

export function boardSyncPlugin(): Plugin {
  return {
    name: 'board-sync-ws',
    configureServer(server) {
      if (!server.httpServer) return;

      // Board API (story 5) for the dev server; the real Worker contract is
      // covered by the integration and share e2e suites.
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/api/boards' || path.startsWith('/api/boards/')) {
          handleBoardApi(req, res);
          return;
        }
        next();
      });

      const wss = new WebSocketServer({ noServer: true });

      // Listen for upgrade events. We use 'once' pattern: when we detect
      // a board room upgrade, we handle it and destroy the socket's
      // reference so Vite's handler (added later) can't interfere.
      server.httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url || '';
        const match = url.match(/^\/api\/rooms\/([^/]+)$/);

        if (!match) return; // Not our request

        const boardId = match[1];
        if (!isValidBoardId(boardId)) {
          // Story 5: malformed ids are 404 (was 400 in story 3), as on the Worker.
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        // Mark the socket so we can identify it
        (socket as any).__boardSync = true;

        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          let room = rooms.get(boardId);
          if (!room) {
            room = new NodeBoardRoom();
            rooms.set(boardId, room);
          }
          room.accept(ws);
          ws.on('close', () => {
            if (room && (room as any).sockets?.size === 0) {
              rooms.delete(boardId);
            }
          });
        });
      });
    },
  };
}
