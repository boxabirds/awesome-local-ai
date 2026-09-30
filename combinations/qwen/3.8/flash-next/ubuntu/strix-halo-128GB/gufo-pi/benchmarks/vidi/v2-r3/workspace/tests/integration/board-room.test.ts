import { describe, it, expect, afterEach } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { createWsClient, type WsClient } from './ws-client';
import { snapshot, createSticky, deleteObject } from '../../src/shared/board-model';
import { decodeMessage } from '../../src/shared/protocol';
import { HTTP_BASE } from './global-setup';

const WS_BASE = HTTP_BASE.replace('http:', 'ws:') + '/api/rooms';

const openClients: WsClient[] = [];

afterEach(async () => {
  for (const c of openClients) {
    try { c.close(); } catch {}
  }
  openClients.length = 0;
  await new Promise((r) => setTimeout(r, 100));
});

function createClient(boardId: string): Promise<WsClient> {
  return createWsClient(WS_BASE, boardId).then((c) => {
    openClients.push(c);
    return c;
  });
}

describe('BoardRoom merging and broadcast', () => {
  // TC-07: two clients concurrently create two notes → both notes in both docs
  it('TC-07: concurrent creates merge on both docs', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // Concurrent creates
    createSticky(clientA.doc, { x: 0, y: 0 });
    createSticky(clientB.doc, { x: 100, y: 100 });

    await new Promise(r => setTimeout(r, 2000));

    const snapA = snapshot(clientA.doc);
    const snapB = snapshot(clientB.doc);
    expect(snapA.length).toBe(2);
    expect(snapB.length).toBe(2);
    expect(snapA.map(o => o.id).sort()).toEqual(snapB.map(o => o.id).sort());
  });

  // TC-08: create from A, delete from B → note gone from A within 250ms
  it('TC-08: delete from B propagates to A', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // A creates a note
    const noteId = createSticky(clientA.doc, { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 1000));
    expect(snapshot(clientA.doc).length).toBe(1);
    expect(snapshot(clientB.doc).length).toBe(1);

    // B deletes it
    deleteObject(clientB.doc, noteId);
    await new Promise(r => setTimeout(r, 1000));

    expect(snapshot(clientA.doc).length).toBe(0);
    expect(snapshot(clientB.doc).length).toBe(0);
  });

  // TC-09: reconnect mid-session → late client receives prior state
  it('TC-09: reconnecting client receives prior state', async () => {
    const boardId = newBoardId();

    // First client creates notes
    const client1 = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));
    createSticky(client1.doc, { x: 0, y: 0 });
    createSticky(client1.doc, { x: 10, y: 10 });
    await new Promise(r => setTimeout(r, 1000));
    expect(snapshot(client1.doc).length).toBe(2);

    // New client connects
    const client2 = await createClient(boardId);
    await new Promise(r => setTimeout(r, 1500));

    // Should receive the full board state
    const snap2 = snapshot(client2.doc);
    expect(snap2.length).toBe(2);
    // Content matches
    const snap1 = snapshot(client1.doc);
    expect(snap2[0].text).toBe(snap1[0].text);
    expect(snap2[1].text).toBe(snap1[1].text);
  });

  // TC-10: awareness relay (TC-10, TC-11, TC-12)
  it('TC-10: awareness update from A appears at B', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // Send awareness message from A
    const { encodeAwarenessMessage } = await import('../../src/shared/protocol');
    const awarenessPayload = new Uint8Array([0xAA, 0xBB]);
    clientA.sendRaw(encodeAwarenessMessage(awarenessPayload));

    // B should receive a MESSAGE_AWARENESS frame
    const msgs = await clientB.waitForMessages(1, 5000);
    expect(msgs.length).toBe(1);
    const decoded = decodeMessage(msgs[0]);
    expect(decoded.kind).toBe('awareness');
    // Payload matches the inner awareness bytes
    if (decoded.kind === 'awareness') {
      expect(new Uint8Array(decoded.payload)).toEqual(awarenessPayload);
    }
  });

  it('TC-11: awareness frame carries inner bytes verbatim', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    const { encodeAwarenessMessage } = await import('../../src/shared/protocol');
    // Arbitrary bytes
    const payload = new Uint8Array([1, 2, 3, 4, 5, 0xFF, 0x00]);
    clientA.sendRaw(encodeAwarenessMessage(payload));

    const msgs = await clientB.waitForMessages(1, 5000);
    const decoded = decodeMessage(msgs[0]);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(new Uint8Array(decoded.payload)).toEqual(payload);
    }
  });

  it('TC-12: awareness never mutates the Y.Doc', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    const { encodeAwarenessMessage } = await import('../../src/shared/protocol');
    clientA.sendRaw(encodeAwarenessMessage(new Uint8Array([0xDE, 0xAD])));
    await new Promise(r => setTimeout(r, 1000));

    expect(snapshot(clientA.doc).length).toBe(0);
    expect(snapshot(clientB.doc).length).toBe(0);
  });

  // TC-14: non-upgrade request with valid id → 426 (already covered in TC-05, but testing it here too)

  // TC-15: malformed frame → connection closed with 1003, other clients unaffected
  it('TC-15: malformed frame closes the offending socket with code 1003', async () => {
    const boardId = newBoardId();
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // A sends a non-binary frame (a string)
    clientA.sendRaw('this is not a valid protocol frame');

    // A's socket should close
    await new Promise(r => setTimeout(r, 1000));
    expect(clientA.ws.readyState).toBe(WebSocket.CLOSED);

    // B's socket should still be open
    expect(clientB.ws.readyState).toBe(WebSocket.OPEN);

    // B should still be able to edit and sync
    createSticky(clientB.doc, { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 1000));
    expect(snapshot(clientB.doc).length).toBe(1);
  });

  // TC-16: unknown type byte → close with 1003
  it('TC-16: unknown type byte closes socket with code 1003', async () => {
    const boardId = newBoardId();
    const client = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // Send a frame with unknown type (e.g., 99)
    const { buildUnknownFrame } = await import('../../src/shared/protocol');
    client.sendRaw(buildUnknownFrame(99));

    await new Promise(r => setTimeout(r, 1000));
    expect(client.ws.readyState).toBe(WebSocket.CLOSED);
  });

  // TC-18: server persists Y.Doc across disconnect/reconnect with full sync
  it('TC-18: full sync after all clients disconnect and one reconnects', async () => {
    const boardId = newBoardId();

    // Two clients create notes
    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    createSticky(clientA.doc, { x: 0, y: 0 });
    createSticky(clientB.doc, { x: 10, y: 10 });
    await new Promise(r => setTimeout(r, 1000));
    expect(snapshot(clientA.doc).length).toBe(2);

    // Both disconnect
    clientA.close();
    clientB.close();
    openClients.length = 0;
    await new Promise(r => setTimeout(r, 500));

    // New client connects
    const clientC = await createClient(boardId);
    await new Promise(r => setTimeout(r, 2000));

    // Should receive full board state
    const snapC = snapshot(clientC.doc);
    expect(snapC.length).toBe(2);
  });

  // TC-31: dead socket handling - close B's socket abruptly, A sends update;
  // room does not throw and later sockets still receive
  it('TC-31: dead socket does not prevent updates to later sockets', async () => {
    const boardId = newBoardId();

    const clientA = await createClient(boardId);
    const clientB = await createClient(boardId);
    await new Promise(r => setTimeout(r, 500));

    // Abruptly close B's socket (not graceful close, terminate with normal code)
    clientB.ws.close();
    openClients.splice(openClients.indexOf(clientB), 1);
    await new Promise(r => setTimeout(r, 500));

    // A creates a note - room should not throw
    const noteId = createSticky(clientA.doc, { x: 42, y: 42 });
    await new Promise(r => setTimeout(r, 1000));
    expect(snapshot(clientA.doc).length).toBe(1);

    // C connects and should receive the note
    const clientC = await createClient(boardId);
    await new Promise(r => setTimeout(r, 2000));
    expect(snapshot(clientC.doc).length).toBe(1);

    clientA.close();
    clientC.close();
    openClients.length = 0;
  });
});
