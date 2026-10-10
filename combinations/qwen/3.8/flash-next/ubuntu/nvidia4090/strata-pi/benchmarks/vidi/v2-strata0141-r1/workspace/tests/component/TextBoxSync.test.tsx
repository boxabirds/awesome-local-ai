import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import {
  createText,
  getTextContent,
  readTextSnapshot,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
} from '../../src/shared/objects/text';
import {
  remeasureTextBox,
  useTextBoxSync,
  type TextBoxSync,
} from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/**
 * The local-only box write rule (anchor `text.layout`, Key decision 1), TC-12 and
 * TC-13, against two real Y.Docs: this client's and a simulated peer's.
 *
 * Only the client that made a change measures. Everything here counts the writes
 * this document actually received - `setTextBox` calls that changed `width` or
 * `height` with the local origin - because "no write" is the assertion.
 */

/** 0.5 em per character, so the expected box is arithmetic. */
const fakeMeasurer: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** A probe: the hook under test, with its handle handed to the test. */
function SyncProbe(props: {
  doc: Y.Doc;
  id: string;
  measure: Measurer;
  onReady(sync: TextBoxSync): void;
}) {
  const { doc, id, measure, onReady } = props;
  const sync = useTextBoxSync(doc, id, measure);
  const reported = useRef(false);
  if (!reported.current) {
    reported.current = true;
    onReady(sync);
  }
  return null;
}

interface BoxWrites {
  count(): number;
  boxes(): { width: number; height: number }[];
}

/**
 * Count the `width`/`height` writes a document received. `localOnly` keeps a
 * peer's change out of the count, which is exactly what TC-12 measures.
 */
function watchBoxWrites(
  doc: Y.Doc,
  id: string,
  localOnly = true,
  keys: readonly ('width' | 'height')[] = ['width', 'height'],
): BoxWrites {
  const boxes: { width: number; height: number }[] = [];
  const objects = doc.getMap<unknown>('objects');
  const entry = objects.get(id);
  if (!(entry instanceof Y.Map)) {
    throw new Error(`text object ${id} is not in the document`);
  }
  const observer = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
    if (localOnly && transaction.origin !== LOCAL_ORIGIN) {
      return;
    }
    if (keys.some((key) => event.changes.keys.has(key))) {
      boxes.push({
        width: Number(entry.get('width')),
        height: Number(entry.get('height')),
      });
    }
  };
  entry.observe(observer);
  return { count: () => boxes.length, boxes: () => boxes.slice() };
}

/** A second document holding the same board, i.e. another person's screen. */
function peerOf(doc: Y.Doc): Y.Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  return peer;
}

/** Bring the peer's change into this document, as the room would. */
function deliverFromPeer(doc: Y.Doc, peer: Y.Doc): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateAsUpdate(doc)));
}

const boxOf = (doc: Y.Doc, id: string): { width: number; height: number } => {
  const snapshot = readTextSnapshot(doc, id);
  if (!snapshot) {
    throw new Error(`text object ${id} is gone`);
  }
  return { width: snapshot.width, height: snapshot.height };
};

const expectedHeight = (lines: number, size: TextSize): number =>
  lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout - only the local client writes the box (TC-12)', () => {
  it('TC-12 a remote text change produces no box write here', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const writes = watchBoxWrites(doc, id);
    const before = boxOf(doc, id);

    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    // Another person types in the same text object.
    const peer = peerOf(doc);
    getTextContent(peer, id)!.insert(0, 'Went well');
    deliverFromPeer(doc, peer);

    expect(readTextSnapshot(doc, id)!.text).toBe('Went well');
    expect(writes.count()).toBe(0);
    expect(boxOf(doc, id)).toEqual(before);
    // The remote client's box stands; this client did not overwrite it.
    expect(sync).not.toBeNull();
  });

  it('TC-12 a local text change produces exactly one box write, with the measured box', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const writes = watchBoxWrites(doc, id);

    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    // What the editor does: write the text, then remeasure once.
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'Went well'), LOCAL_ORIGIN);
    sync!.remeasureAfterLocalChange();

    expect(writes.count()).toBe(1);
    const written = writes.boxes()[0]!;
    // 'Went well' is 9 characters: 90 wide at M, plus the box slack.
    expect(written.width).toBe(90 + 8);
    expect(written.height).toBe(expectedHeight(1, DEFAULT_TEXT_SIZE));
  });

  it('TC-12 a local change that needs a taller box writes the new height once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'Went well'), LOCAL_ORIGIN);
    const writes = watchBoxWrites(doc, id);

    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    // A new line typed locally: same width, one more line.
    doc.transact(() => getTextContent(doc, id)!.insert(9, '\nto improve'), LOCAL_ORIGIN);
    sync!.remeasureAfterLocalChange();

    expect(writes.count()).toBe(1);
    expect(writes.boxes()[0]!.height).toBe(expectedHeight(2, DEFAULT_TEXT_SIZE));
  });

  it('TC-12 a remote change followed by a local one writes once, not twice', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const writes = watchBoxWrites(doc, id);

    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    const peer = peerOf(doc);
    getTextContent(peer, id)!.insert(0, 'Notes');
    deliverFromPeer(doc, peer);
    expect(writes.count()).toBe(0);

    doc.transact(() => getTextContent(doc, id)!.insert(5, ' kept'), LOCAL_ORIGIN);
    sync!.remeasureAfterLocalChange();

    expect(writes.count()).toBe(1);
    // Both people's characters are in the box the local client measured.
    expect(readTextSnapshot(doc, id)!.text).toBe('Notes kept');
    expect(writes.boxes()[0]!.width).toBe(10 * TEXT_SIZES.M * 0.5 + 8);
  });
});

describe('text.layout - no redundant writes (TC-13)', () => {
  it('TC-13 a remeasure that would change nothing writes nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'Went well'), LOCAL_ORIGIN);
    // The document already holds exactly the box the measurer would answer.
    setTextBox(doc, id, {
      width: 90 + 8,
      height: expectedHeight(1, DEFAULT_TEXT_SIZE),
    });

    const writes = watchBoxWrites(doc, id);
    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    sync!.remeasureAfterLocalChange();
    sync!.remeasureAfterLocalChange();
    sync!.remeasureAfterLocalChange();

    expect(writes.count()).toBe(0);
  });

  it('TC-13 the same rule holds for a size change whose box is already right', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'Went well'), LOCAL_ORIGIN);
    setTextSize(doc, id, 'XL');
    // 'Went well' at XL: 9 * 56 * 0.5 = 252 wide, one line high.
    setTextBox(doc, id, { width: 252 + 8, height: expectedHeight(1, 'XL') });

    const writes = watchBoxWrites(doc, id);
    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    sync!.remeasureAfterLocalChange();
    expect(writes.count()).toBe(0);
  });

  it('remeasuring a text object that no longer exists writes nothing and does not throw', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.getMap<unknown>('objects').delete(id);
    expect(remeasureTextBox(doc, id, fakeMeasurer)).toBe(false);
  });
});

describe('text.layout - automatic to fixed transition', () => {
  it('a side-handle width rewraps and writes the new height once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'alpha beta gamma'), LOCAL_ORIGIN);
    remeasureTextBox(doc, id, fakeMeasurer);
    const before = boxOf(doc, id);
    expect(before.width).toBe(16 * TEXT_SIZES.M * 0.5 + 8);

    const writes = watchBoxWrites(doc, id, true, ['height']);
    let sync: TextBoxSync | null = null;
    render(<SyncProbe doc={doc} id={id} measure={fakeMeasurer} onReady={(value) => (sync = value)} />);

    // What the gesture does: clamp the width, then let the box be re-measured.
    // The height is the remeasure's write - exactly one of them.
    setTextWidthFixed(doc, id, 90);
    sync!.remeasureAfterLocalChange();

    expect(writes.count()).toBe(1); // height writes only; the width is the gesture's
    const after = boxOf(doc, id);
    expect(after.width).toBe(90);
    // 'alpha beta gamma' at M in 90 units: 3 words, one per line.
    expect(after.height).toBe(expectedHeight(3, DEFAULT_TEXT_SIZE));
    expect(readTextSnapshot(doc, id)!.widthMode).toBe('fixed');
  });

  it('the minimum width is honoured through the same path', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => getTextContent(doc, id)!.insert(0, 'alpha beta gamma'), LOCAL_ORIGIN);
    setTextWidthFixed(doc, id, 10);
    remeasureTextBox(doc, id, fakeMeasurer);
    const after = boxOf(doc, id);
    expect(after.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(after.height).toBe(expectedHeight(3, DEFAULT_TEXT_SIZE));
  });
});
