import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { initDoc, ensureMeta, createSticky, snapshot } from '../src/shared/board-model.ts';

const svEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rows = [];

// onMsg processes one y-protocols sync message into the room doc and returns
// the reply bytes (the room would send them back to the client).
function roomOnMsg(doc, persistedSvRef, bytes) {
  const decoder = createDecoder(bytes);
  const encoder = createEncoder();
  const svBefore = Y.encodeStateVector(doc);
  sync.readSyncMessage(decoder, encoder, doc, 'load', () => {});
  const svAfter = Y.encodeStateVector(doc);
  const reply = toUint8Array(encoder);
  if (!svEq(svBefore, svAfter)) {
    ensureMeta(doc);
    const svNow = Y.encodeStateVector(doc);
    if (!svEq(svNow, persistedSvRef.sv)) {
      const pending = Y.encodeStateAsUpdate(doc, persistedSvRef.sv);
      rows.push(pending);
    }
    persistedSvRef.sv = svNow;
  }
  return reply;
}
// client applies a room reply locally (no reply of its own)
function clientApply(clientDoc, bytes) {
  if (!bytes.length) return;
  sync.readSyncMessage(createDecoder(bytes), createEncoder(), clientDoc, 'provider', () => {});
}
function roomLoad(state) {
  state.doc = new Y.Doc();
  for (const r of rows) Y.applyUpdate(state.doc, r, 'load');
  state.sv = Y.encodeStateVector(state.doc);
}
// full y-websocket handshake
function handshake(roomState, clientDoc) {
  const ref = { sv: roomState.sv };
  const syncDoc = roomState.doc;
  // 1. client -> room: syncStep1 ; room replies with its state
  const e1 = createEncoder(); sync.writeSyncStep1(e1, clientDoc);
  const reply1 = roomOnMsg(syncDoc, ref, toUint8Array(e1));
  clientApply(clientDoc, reply1);
  // 2. room -> client: syncStep1 (on open) ; client replies with its state
  const e2 = createEncoder(); sync.writeSyncStep1(e2, syncDoc);
  const enc2 = createEncoder();
  sync.readSyncMessage(createDecoder(toUint8Array(e2)), enc2, clientDoc, 'provider', () => {});
  const reply2 = roomOnMsg(syncDoc, ref, toUint8Array(enc2));
  clientApply(clientDoc, reply2);
  roomState.sv = ref.sv;
}
// addSticky: capture client sv BEFORE mutating, mutate, send the delta.
function addSticky(roomState, clientDoc, x, y) {
  const before = Y.encodeStateVector(clientDoc);
  createSticky(clientDoc, { x, y });
  const e = createEncoder(); sync.writeUpdate(e, Y.encodeStateAsUpdate(clientDoc, before));
  const ref = { sv: roomState.sv };
  const reply = roomOnMsg(roomState.doc, ref, toUint8Array(e));
  clientApply(clientDoc, reply);
  roomState.sv = ref.sv;
}

const room = { doc: new Y.Doc(), sv: new Uint8Array([0]) };
roomLoad(room);
console.log('new board, rows after load:', rows.length, '(want 0)');

const A = new Y.Doc(); initDoc(A);
handshake(room, A);
console.log('after mere connect (no edit): rows =', rows.length, '(want 0)');

addSticky(room, A, 5, 5);
console.log('after first sticky: rows =', rows.map((r) => r.length), '(want one full-state row)');

roomLoad(room);
const B = new Y.Doc(); initDoc(B);
handshake(room, B);
console.log('B sees notes:', snapshot(B).length, '(want 1), B meta:', B.getMap('meta').get('schemaVersion'));

addSticky(room, B, 9, 9);
console.log('rows after 2nd sticky:', rows.map((r) => r.length));

roomLoad(room);
const C = new Y.Doc(); initDoc(C);
handshake(room, C);
console.log('C sees notes:', snapshot(C).length, '(want 2)');

// compaction
const snap = Y.encodeStateAsUpdate(room.doc);
rows.length = 0; rows.push(snap);
roomLoad(room);
const D = new Y.Doc(); initDoc(D);
handshake(room, D);
console.log('D sees notes after compaction:', snapshot(D).length, '(want 2), D meta:', D.getMap('meta').get('schemaVersion'));

addSticky(room, D, 1, 1);
roomLoad(room);
const E = new Y.Doc(); initDoc(E);
handshake(room, E);
console.log('E sees notes after compaction+edit+reload:', snapshot(E).length, '(want 3)');
console.log('ALL ROWS:', rows.map((r) => r.length));
