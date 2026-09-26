import * as Y from 'yjs';
import { buildMultiClientBoard } from '../tests/fixtures/boards.ts';
import { snapshot } from '../src/shared/board-model.ts';
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const { updates } = buildMultiClientBoard({ baseNotes: 3, clients: 3, notesPerClient: 3 });
// Try truncating each row and see if applyUpdate throws on a fresh doc
for (let i = 0; i < updates.length; i++) {
  const full = b64(updates[i]);
  const trunc = full.slice(0, Math.max(0, full.length - 10));
  let threw = false;
  try { const d = new Y.Doc(); Y.applyUpdate(d, trunc, 'load'); } catch { threw = true; }
  // also: truncate and apply on top of base (realistic load order)
  let threwCtx = false;
  try {
    const d = new Y.Doc();
    for (let j = 0; j < updates.length; j++) {
      if (j === i) continue;
      Y.applyUpdate(d, b64(updates[j]), 'load');
    }
    Y.applyUpdate(d, trunc, 'load');
  } catch { threwCtx = true; }
  console.log(`row ${i+1}: len=${full.length} trunc-throws(fresh)=${threw} trunc-throws(context)=${threwCtx}`);
}
