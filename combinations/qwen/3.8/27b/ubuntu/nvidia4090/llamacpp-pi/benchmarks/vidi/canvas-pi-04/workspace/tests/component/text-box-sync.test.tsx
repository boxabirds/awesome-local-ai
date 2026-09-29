// Story 9, task 5: component tests for useTextBoxSync (TC-12, TC-13) plus the
// auto -> fixed rewrap case.
//
// The hook runs against a real Y.Doc with a deterministic fake measurer.
// "Remote" changes use a non-LOCAL_ORIGIN transaction; the hook never
// observes the Y.Text, so they must produce zero box writes. Local changes
// call remeasureAfterLocalChange (as the editor's onInput does) and write
// width+height exactly once — unless the measured box is unchanged.

import { act, cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { initDoc, LOCAL_ORIGIN, objectMap } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';

/** Deterministic fake: every character is 0.5 * fontPx wide. */
const fake = (text: string, fontPx: number): number => text.length * fontPx * 0.5;
const MEASURER: Measurer = fake;

function makeDocWithText(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 10, y: 10 }, 'g_test');
  return { doc, id: id! };
}

function objMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  return objectMap(doc).get(id) as Y.Map<unknown>;
}

/** Counts transactions that write the box (width and/or height). */
function boxWrites(doc: Y.Doc, id: string): { count(): number; reset(): void } {
  const obj = objMap(doc, id);
  let n = 0;
  obj.observe((ev) => {
    // Yjs 13.6: the observer receives a single event whose `keys` is a Map.
    const keys = [...ev.keys.keys()];
    if (keys.includes('width') || keys.includes('height')) n += 1;
  });
  return {
    count: (): number => n,
    reset: (): void => {
      n = 0;
    },
  };
}

function Harness(props: { doc: Y.Doc; id: string }): JSX.Element {
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, props.id, MEASURER);
  return (
    <button
      type="button"
      aria-label="remeasure"
      onClick={remeasureAfterLocalChange}
    >
      remeasure
    </button>
  );
}

function clickRemeasure(): void {
  act(() => {
    screen.getByRole('button', { name: 'remeasure' }).click();
  });
}

describe('story 9: box sync (TC-12, TC-13)', () => {
  afterEach(() => cleanup());

  it('TC-12: remote text changes never write the box; a local change writes once', () => {
    const { doc, id } = makeDocWithText();
    const writes = boxWrites(doc, id);
    render(<Harness doc={doc} id={id} />);

    const ytext = getTextContent(doc, id)!;

    // A remote peer types into the object: the hook stays silent.
    act(() => {
      ytext.doc?.transact(() => ytext.insert(0, 'Hello world'), 'remote_peer');
    });
    expect(writes.count()).toBe(0);

    // The local client types (LOCAL_ORIGIN write) and remeasures: exactly one
    // box write, with the measured width/height for 'Hello world' at M.
    act(() => {
      ytext.doc?.transact(() => ytext.insert(11, '!'), LOCAL_ORIGIN);
    });
    expect(writes.count()).toBe(0); // the text write alone is not a box write
    clickRemeasure();
    expect(writes.count()).toBe(1);

    const obj = objMap(doc, id);
    // 'Hello world!' = 12 chars * 20px * 0.5 = 120; one line at M.
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-13: a local change whose remeasured box equals the stored box writes nothing', () => {
    const { doc, id } = makeDocWithText();
    const writes = boxWrites(doc, id);
    render(<Harness doc={doc} id={id} />);

    // First local change: the box moves from the creation values.
    const ytext = getTextContent(doc, id)!;
    act(() => {
      ytext.doc?.transact(() => ytext.insert(0, 'Hi'), LOCAL_ORIGIN);
    });
    clickRemeasure();
    expect(writes.count()).toBe(1);
    const stored = { w: objMap(doc, id).get('width'), h: objMap(doc, id).get('height') };

    // A further local change that leaves the measured box unchanged (e.g. an
    // input echo / a size that produces the same layout): no redundant write.
    writes.reset();
    clickRemeasure();
    expect(writes.count()).toBe(0);
    expect(objMap(doc, id).get('width')).toBe(stored.w);
    expect(objMap(doc, id).get('height')).toBe(stored.h);
  });

  it('auto -> fixed: a width drag rewraps and writes the new height once', () => {
    const { doc, id } = makeDocWithText();
    const writes = boxWrites(doc, id);
    render(<Harness doc={doc} id={id} />);
    const ytext = getTextContent(doc, id)!;

    // 8 words in auto mode: 23 chars * 20 * 0.5 = 230 (one line).
    act(() => {
      ytext.doc?.transact(
        () => ytext.insert(0, 'w1 w2 w3 w4 w5 w6 w7 w8'),
        LOCAL_ORIGIN,
      );
    });
    clickRemeasure();
    const obj = objMap(doc, id);
    expect(obj.get('width')).toBe(230);
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // The gesture ends: the width flips to fixed 200 (one width write),
    // then the remeasure writes the rewrapped height (one more write).
    writes.reset();
    act(() => {
      expect(setTextWidthFixed(doc, id, 200)).toBe(true);
    });
    expect(writes.count()).toBe(1);
    writes.reset();
    clickRemeasure();
    // Exactly one more box write: the rewrapped height (7 words fit the 200
    // line exactly -> 2 lines).
    expect(writes.count()).toBe(1);
    expect(obj.get('width')).toBe(200);
    expect(obj.get('widthMode')).toBe('fixed');
    expect(obj.get('height')).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
