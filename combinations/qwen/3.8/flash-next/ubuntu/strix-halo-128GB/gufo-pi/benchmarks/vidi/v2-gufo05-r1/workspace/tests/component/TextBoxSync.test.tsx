/**
 * Who writes a text object's box (`text.layout`, key decision 1).
 *
 * The box is stored so that selection, marquee and an export can use it without
 * measuring. That is only safe if exactly one client writes it: the one that made
 * the change. These tests mount the real hook on two copies of one document, each
 * with its own measurer — and the receiving copy measures three times as wide, so
 * if it wrote a box at all the number would show.
 *
 * TC-12 remote text change → no write; local change → one box write, position intact
 * TC-13 a remeasure that changes nothing → no write at all (negative)
 */
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { LOCAL_ORIGIN, moveObject, OBJECTS_KEY } from '../../src/shared/board-model';
import { TEXT_BOX_SLACK_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import {
  createText,
  getText,
  readTextSnapshot,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { useTextBoxSync, type TextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/** Every character is half a font wide — the measurer the unit tests use. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** A measurer nobody would confuse with that one: three times as wide, per character. */
const wideMeasure: Measurer = (text, fontPx) => text.length * fontPx * 1.5;

/** A component that only mounts the hook under test, and hands it out. */
function SyncProbe(props: {
  doc: Y.Doc;
  id: string;
  measure: Measurer;
  api: { current: TextBoxSync | null };
}) {
  const sync = useTextBoxSync(props.doc, props.id, props.measure);
  useEffect(() => {
    props.api.current = sync;
  }, [sync, props]);
  return null;
}

function mountSync(doc: Y.Doc, id: string, measurer: Measurer): { current: TextBoxSync | null } {
  const api = { current: null as TextBoxSync | null };
  render(<SyncProbe doc={doc} id={id} measure={measurer} api={api} />);
  return api;
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } {
  const obj = readTextSnapshot(doc, id);
  if (!obj) throw new Error('that text object is not here');
  return { width: obj.width, height: obj.height };
}

const boxKey = (box: { width: number; height: number }): string => `${box.width}x${box.height}`;

/** Type into a text object the way this client's keyboard would. */
function typeHere(doc: Y.Doc, id: string, text: string): void {
  const ytext = getText(doc, id);
  if (!ytext) throw new Error('this client cannot see that text object');
  applyTextDiff(ytext, `${ytext.toString()}${text}`, LOCAL_ORIGIN);
}

/** A copy of the board held by somebody else, whose typing must not be re-measured here. */
function peer(doc: Y.Doc): { type(text: string): void; syncInto(target: Y.Doc): void } {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  return {
    type(text) {
      const map = [...(other.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).values()][0];
      const ytext = map?.get('text');
      if (!(ytext instanceof Y.Text)) throw new Error('the peer cannot see the text object');
      // Their change carries no local origin, which is exactly what the hook keys off.
      applyTextDiff(ytext, `${ytext.toString()}${text}`, undefined);
    },
    syncInto(target) {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(other, Y.encodeStateVector(target)));
    },
  };
}

/** Watch for transactions that change a stored box, and remember who opened them. */
function boxWrites(doc: Y.Doc, id: string): () => string[] {
  const writes: string[] = [];
  let last = boxKey(boxOf(doc, id));
  doc.on('afterTransaction', (transaction: Y.Transaction) => {
    if (transaction.origin !== LOCAL_ORIGIN) return;
    const now = boxKey(boxOf(doc, id));
    if (now !== last) writes.push(now);
    last = now;
  });
  return () => writes;
}

/** A document with one empty text object on it, as this client would have made it. */
function boardWithText(at = { x: 100, y: 50 }): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  const id = createText(doc, at, 'g_local');
  if (!id) throw new Error('the fixture could not place text');
  return { doc, id };
}

describe('text.layout: the box follows a local change', () => {
  it('TC-12 typing on this client writes the box once, and leaves the position alone', async () => {
    const { doc, id } = boardWithText();
    const writes = boxWrites(doc, id);
    mountSync(doc, id, measure);

    await act(async () => {
      typeHere(doc, id, 'Went well');
    });

    expect(writes()).toEqual(['92x26']); // 90 measured + the box slack, one line at M
    expect(boxOf(doc, id).width).toBe(90 + TEXT_BOX_SLACK_WORLD);
    expect(boxOf(doc, id).height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // Where the text is, is where it was clicked: a re-measure never moves it.
    expect(readTextSnapshot(doc, id)?.x).toBe(100);
    expect(readTextSnapshot(doc, id)?.y).toBe(50);
  });

  it('TC-12 a change that came from elsewhere is rendered, not re-measured', async () => {
    const { doc, id } = boardWithText();
    mountSync(doc, id, wideMeasure); // this client measures three times as wide
    const writes = boxWrites(doc, id);
    const other = peer(doc);

    other.type('Went well');
    await act(async () => {
      other.syncInto(doc);
    });

    expect(writes()).toEqual([]);
    expect(readTextSnapshot(doc, id)?.text).toBe('Went well');
    // The box is still the one the creating client wrote. Had this client measured
    // the incoming text, a nine-character line would have come out three times wider.
    expect(boxKey(boxOf(doc, id))).toBe('2x26');
  });

  it('a size change re-measures once, in the new size', async () => {
    const { doc, id } = boardWithText();
    const writes = boxWrites(doc, id);
    const sync = mountSync(doc, id, measure);

    await act(async () => {
      setTextSize(doc, id, 'XL');
      sync.current?.remeasureAfterLocalChange();
    });

    expect(writes()).toHaveLength(1);
    expect(boxOf(doc, id).height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('dragging a width wraps the text and grows the height, keeping x and y', async () => {
    const { doc, id } = boardWithText({ x: 300, y: 20 });
    const sync = mountSync(doc, id, measure);
    await act(async () => {
      typeHere(doc, id, 'aaa bbb ccc');
    });

    await act(async () => {
      setTextWidthFixed(doc, id, 40);
      sync.current?.remeasureAfterLocalChange();
    });

    const after = readTextSnapshot(doc, id);
    expect(after?.widthMode).toBe('fixed');
    expect(after?.width).toBe(40);
    expect(after?.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(after?.x).toBe(300);
    expect(after?.y).toBe(20);
  });
});

describe('text.layout: no redundant writes', () => {
  it('TC-13 a remeasure that changes nothing writes nothing', async () => {
    const { doc, id } = boardWithText();
    const writes = boxWrites(doc, id);
    const sync = mountSync(doc, id, measure);

    await act(async () => {
      typeHere(doc, id, 'Went well');
    });
    expect(writes()).toHaveLength(1);

    // The same content, the same size, the same box: nothing to store, so nothing is
    // synced and no undo step is opened. TC-13 is the negative case: this is the
    // difference between a keystroke and a keystroke plus a redundant round trip.
    await act(async () => {
      sync.current?.remeasureAfterLocalChange();
      sync.current?.remeasureAfterLocalChange();
      setTextSize(doc, id, 'M'); // already M
    });
    expect(writes()).toHaveLength(1);
  });

  it('mounting a text object does not rewrite its box', async () => {
    const { doc, id } = boardWithText();
    await act(async () => {
      typeHere(doc, id, 'Went well');
    });
    const writes = boxWrites(doc, id);

    await act(async () => {
      mountSync(doc, id, wideMeasure);
    });
    expect(writes()).toEqual([]);
  });

  it('moving text does not re-measure it', async () => {
    const { doc, id } = boardWithText();
    const sync = mountSync(doc, id, measure);
    await act(async () => {
      typeHere(doc, id, 'Went well');
    });
    const writes = boxWrites(doc, id);

    await act(async () => {
      moveObject(doc, id, 500, 500);
      sync.current?.remeasureAfterLocalChange();
    });
    expect(writes()).toEqual([]);
  });
});
