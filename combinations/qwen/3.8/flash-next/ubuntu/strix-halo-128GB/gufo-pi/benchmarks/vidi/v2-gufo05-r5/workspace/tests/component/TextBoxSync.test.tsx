/**
 * Component tests for `useTextBoxSync` (TC-12, TC-13).
 *
 * The rule under test is the one that keeps five clients from fighting over a text object's
 * dimensions: the client that made a change measures the new box, and a client that only *received*
 * a change writes nothing. A real `Y.Doc` on each side - the local one under the hook, the peer one
 * simulated by a transaction with no local origin.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { act, renderHook } from '@testing-library/react';
import { initDoc } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  getTextRecord,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { LOCAL_ORIGIN, transactionOrigin } from '../../src/shared/y-origin';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/** Half the font size per character, so the expected box is written out in the test. */
const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const M = TEXT_SIZES.M;
const lineM = M * TEXT_LINE_HEIGHT;

let doc: Y.Doc;
let id: string;
/**
 * Every box write made by a *local* transaction, in order, with the keys that transaction changed.
 * A drag writes `width`/`widthMode` itself and the box sync answers with `height`, so the key sets
 * say who wrote what.
 */
let writes: Array<{ keys: string[]; width: number; height: number }>;
let stopWatching: () => void;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  id = createText(doc, { x: 100, y: 50 }, 'local')!;

  writes = [];
  const record = getTextRecord(doc, id)!;
  const watch = (event: Y.YMapEvent<unknown>, transaction: unknown): void => {
    if (transactionOrigin(transaction) !== LOCAL_ORIGIN) return;
    if (!event.keys.has('width') && !event.keys.has('height')) return;
    writes.push({
      keys: [...event.keys.keys()].sort(),
      width: record.get('width') as number,
      height: record.get('height') as number,
    });
  };
  record.observe(watch);
  stopWatching = () => record.unobserve(watch);
});

afterEach(() => {
  stopWatching();
  doc.destroy();
});

function render() {
  return renderHook(() => useTextBoxSync(doc, id, fake));
}

/** A change arriving from another client: no local origin. */
function byRemotePeer(edit: () => void): void {
  doc.transact(edit);
}

/** A change made here: the origin every local write carries. */
function byLocalUser(edit: () => void): void {
  doc.transact(edit, LOCAL_ORIGIN);
}

describe('text.boxSync', () => {
  test('TC-12 a remote change writes no box, a local change writes exactly one', () => {
    render();

    byRemotePeer(() => {
      getTextContent(doc, id)!.insert(0, 'abc');
    });

    expect(writes).toEqual([]);

    // the local user adds a line: the box grows wider and one line taller
    byLocalUser(() => {
      getTextContent(doc, id)!.insert(0, '\nhello');
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.keys).toEqual(['height', 'width']);
    expect(writes[0]!.width).toBeCloseTo(8 * (M / 2) + 4, 6);
    expect(writes[0]!.height).toBeCloseTo(2 * lineM, 6);
  });

  test('a remote size change writes no box either', () => {
    render();

    byRemotePeer(() => {
      getTextRecord(doc, id)!.set('size', 'XL');
    });

    expect(writes).toEqual([]);
  });

  test('TC-13 a local change whose box already matches writes nothing', () => {
    // the stored box is already what XL would measure, so applying XL has nothing to write
    const text = getTextContent(doc, id)!;
    byLocalUser(() => text.insert(0, 'abc'));
    writes.length = 0;

    const xlWidth = Math.max(3 * (TEXT_SIZES.XL / 2) + 4, TEXT_MIN_WIDTH_WORLD);
    const xlHeight = TEXT_SIZES.XL * TEXT_LINE_HEIGHT;
    byLocalUser(() => {
      const record = getTextRecord(doc, id)!;
      record.set('width', xlWidth);
      record.set('height', xlHeight);
    });
    writes.length = 0;

    render();
    byLocalUser(() => {
      setTextSize(doc, id, 'XL');
    });

    expect(getTextRecord(doc, id)!.get('size')).toBe('XL');
    expect(writes).toEqual([]);
  });

  test('the editor hook remeasures on demand', () => {
    const { result } = render();

    byRemotePeer(() => {
      getTextRecord(doc, id)!.set('size', 'XL');
    });
    expect(writes).toEqual([]);

    // a change made here ends with the caller asking for the box, and it is written once
    act(() => {
      result.current.remeasureAfterLocalChange();
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.keys).toEqual(['height']);
    expect(writes[0]!.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
  });

  test('an auto-to-fixed transition after a width drag rewraps and writes the new height once', () => {
    render();

    byLocalUser(() => getTextContent(doc, id)!.insert(0, 'aaa bbb ccc'));
    expect(writes).toHaveLength(1);
    writes.length = 0;

    // the side handle: same transaction sets the width and the width mode
    byLocalUser(() => {
      setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    });

    // the handle's own write, then exactly one answer from the box sync
    expect(writes.map((write) => write.keys)).toEqual([
      ['width', 'widthMode'],
      ['height'],
    ]);
    expect(writes[1]!.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // one word per line at the minimum width
    expect(writes[1]!.height).toBeCloseTo(3 * lineM, 6);
  });

  test('a local move does not remeasure', () => {
    render();

    byLocalUser(() => {
      const record = getTextRecord(doc, id)!;
      record.set('x', 300);
      record.set('y', 400);
    });

    expect(writes).toEqual([]);
  });

  test('a stale id is inert', () => {
    const { result } = renderHook(() => useTextBoxSync(doc, 'missing', fake));
    expect(() => {
      act(() => {
        result.current.remeasureAfterLocalChange();
      });
    }).not.toThrow();
    expect(writes).toEqual([]);
  });
});
