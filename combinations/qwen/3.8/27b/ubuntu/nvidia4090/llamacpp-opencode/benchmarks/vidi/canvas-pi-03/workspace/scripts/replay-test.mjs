import * as Y from 'yjs';
import { initDoc, createSticky, snapshot } from '../src/shared/board-model.ts';

const emptySv = () => Y.encodeStateVector(new Y.Doc());

// --- Room S1: brand-new ---
const S1 = new Y.Doc();
initDoc(S1);
let persistedSv = emptySv();
const rows = [];
const capture = () => {
  const delta = Y.encodeStateAsUpdate(S1, persistedSv);
  if (delta.length) rows.push(delta);
  persistedSv = Y.encodeStateVector(S1);
};
createSticky(S1, { x: 1, y: 2 }); capture();
createSticky(S1, { x: 3, y: 4 }); capture();

// --- Reload into S2 (empty doc, no initDoc) ---
const S2 = new Y.Doc();
for (const r of rows) Y.applyUpdate(S2, r, 'load');
let persistedSv2 = Y.encodeStateVector(S2);   // = loaded state
console.log('S2: notes=', snapshot(S2).length, 'meta=', S2.getMap('meta').get('schemaVersion'));

// new client adds a note to S2
createSticky(S2, { x: 9, y: 9 });
const delta2 = Y.encodeStateAsUpdate(S2, persistedSv2);
rows.push(delta2);
console.log('delta2 bytes:', delta2.length);

// --- Reload into S3 ---
const S3 = new Y.Doc();
for (const r of rows) Y.applyUpdate(S3, r, 'load');
console.log('S3: notes=', snapshot(S3).length);

// --- Third round: add two more, compact mid-way (full-state snapshot), reload ---
createSticky(S3, { x: 20, y: 20 });
createSticky(S3, { x: 30, y: 30 });
const snap = Y.encodeStateAsUpdate(S3);   // full-state snapshot
console.log('S3: notes=', snapshot(S3).length, 'snap bytes=', snap.length);
const S4 = new Y.Doc();
Y.applyUpdate(S4, snap, 'load');
console.log('S4 (from snapshot only): notes=', snapshot(S4).length);
