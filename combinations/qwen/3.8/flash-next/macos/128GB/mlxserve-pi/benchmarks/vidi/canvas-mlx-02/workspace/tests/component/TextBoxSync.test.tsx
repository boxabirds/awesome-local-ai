// Story 9, text.box.sync (component): the box recomputes itself when LOCAL
// writes move what it lays out - and never on anything else. The rules under
// test are the origin's: a change from this tab re-measures, a change from
// anywhere else (another client, or an undo's inverse) writes no box, and a
// re-measure that agrees with the stored box writes NOTHING - no transaction,
// nothing on the wire, no undo step.
import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useTextBoxSync, type TextBoxSync } from '../../src/client/objects/useTextBoxSync.ts';
import { layoutText, type TextMeasurer } from '../../src/client/objects/textLayout.ts';
import { initDoc, objectsMapOf, LOCAL_ORIGIN } from '../../src/shared/board-model.ts';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text.ts';
import { applyTextDiff } from '../../src/shared/text-edit.ts';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config.ts';

/** Another client's writes carry an origin of their own (TC-12's half). */
const FROM_ELSEWHERE = Symbol('elsewhere');

/** Fake measurer: exact arithmetic, no canvas (same maths as the unit suite). */
const measure: TextMeasurer = (text, fontPx) => text.length * fontPx * 0.5;

const lineHeightOf = (size: keyof typeof TEXT_SIZES): number =>
  TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

function Host(props: {
  doc: Y.Doc;
  id: string;
  onSync(sync: TextBoxSync): void;
}) {
  const sync = useTextBoxSync(props.doc, props.id, measure);
  const sent = useRef(false);
  if (!sent.current) {
    sent.current = true;
    props.onSync(sync);
  }
  return null;
}

function setup(): { doc: Y.Doc; id: string; sync(): TextBoxSync } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
  let sync: TextBoxSync | null = null;
  render(<Host doc={doc} id={id} onSync={(s) => { sync = s; }} />);
  return {
    doc,
    id,
    sync: () => {
      if (!sync) throw new Error('host never got the sync handle');
      return sync;
    },
  };
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number; widthMode: unknown } {
  const m = objectsMapOf(doc).get(id);
  if (!m) throw new Error('the text object is gone');
  return {
    width: Number(m.get('width')),
    height: Number(m.get('height')),
    widthMode: m.get('widthMode'),
  };
}

/** Counts writes to the box's HEIGHT key from here on. */
function heightWrites(doc: Y.Doc, id: string): () => number {
  let n = 0;
  objectsMapOf(doc).get(id)!.observe((event) => {
    if (event.keys.has('height')) n++;
  });
  return () => n;
}

/** Counts any box write (width or height) from here on. */
function boxWrites(doc: Y.Doc, id: string): () => number {
  let n = 0;
  objectsMapOf(doc).get(id)!.observe((event) => {
    if (event.keys.has('width') || event.keys.has('height')) n++;
  });
  return () => n;
}

describe('text.box.sync', () => {
  // TC-12: a LOCAL text change re-measures the box.
  it('TC-12 rewrites the box after a local text change', () => {
    const { doc, id } = setup();
    const writes = boxWrites(doc, id);

    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello world', LOCAL_ORIGIN);
    });

    // 'hello world' is 11 characters * 20 * 0.5 = 110; slack 8.
    expect(boxOf(doc, id)).toMatchObject({ width: 118, height: lineHeightOf('M') });
    expect(writes()).toBe(1);
  });

  // TC-12 again: but a REMOTE text change writes no box from this client, even
  // though the remote text is longer than the box.
  it('TC-12 writes no box for a remote change', () => {
    const { doc, id } = setup();
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'mine', LOCAL_ORIGIN);
    });

    const writes = boxWrites(doc, id);
    act(() => {
      Y.transact(doc, () => {
        getTextContent(doc, id)!.insert(0, 'a longer line from elsewhere ');
      }, FROM_ELSEWHERE);
    });

    expect(writes()).toBe(0);
    // The stored box is exactly what the LOCAL text laid out to, untouched.
    expect(boxOf(doc, id).width).toBe(4 * 10 + 8);
  });

  // TC-13: the hook re-measuring when the box already agrees writes nothing -
  // not a transaction, not a wire message, not an undo step.
  it('TC-13 does not write a redundant update', () => {
    const { doc, id, sync } = setup();
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello', LOCAL_ORIGIN);
    });
    const expected = layoutText('hello', 'M', 'auto', undefined, measure);
    expect(boxOf(doc, id)).toMatchObject({ width: expected.width, height: expected.height });

    const writes = boxWrites(doc, id);
    act(() => {
      sync().remeasureAfterLocalChange();
      sync().remeasureAfterLocalChange();
    });
    expect(writes()).toBe(0);
  });

  // The size toolbar writes only the size; the box follows in the same step
  // because the local write re-measures synchronously.
  it('re-measures the height when the font size changes', () => {
    const { doc, id } = setup();
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello world', LOCAL_ORIGIN);
    });
    const heights = heightWrites(doc, id);

    act(() => {
      setTextSize(doc, id, 'XL');
    });

    // One height write - the layout's, in the same undo window as the size.
    expect(heights()).toBe(1);
    expect(boxOf(doc, id).height).toBe(lineHeightOf('XL'));
  });

  // The fixed width a handle leaves behind re-wraps the text: the height
  // follows, exactly once.
  it('re-wraps when the width becomes fixed', () => {
    const { doc, id } = setup();
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello world', LOCAL_ORIGIN);
    });
    expect(boxOf(doc, id).width).toBe(118);

    const heights = heightWrites(doc, id);
    act(() => {
      setTextWidthFixed(doc, id, 100);
    });

    // 'hello world' at 100px wide lays out as two 50px lines.
    expect(boxOf(doc, id).width).toBe(100);
    expect(boxOf(doc, id).widthMode).toBe('fixed');
    expect(heights()).toBe(1);
    expect(boxOf(doc, id).height).toBe(2 * lineHeightOf('M'));
  });

  // An undo's inverse is not a local change: the step back must not gain a
  // re-measure of its own on top of what it restores.
  it('writes no box for writes of other origins', () => {
    const { doc, id } = setup();
    const writes = boxWrites(doc, id);
    act(() => {
      Y.transact(doc, () => {
        getTextContent(doc, id)!.insert(0, 'somebody else');
      }, new Error('not a local origin at all'));
    });
    expect(writes()).toBe(0);
  });
});
