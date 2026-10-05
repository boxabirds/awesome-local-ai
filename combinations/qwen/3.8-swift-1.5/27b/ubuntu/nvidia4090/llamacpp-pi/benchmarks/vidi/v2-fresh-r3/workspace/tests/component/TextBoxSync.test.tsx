import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { layoutText, type Measurer } from '../../src/client/objects/textLayout';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  getTextContent,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
} from '../../src/shared/config';

afterEach(() => {
  cleanup();
});

/** Deterministic fake measurer: 10 world units per character. */
const measure: Measurer = (text) => text.length * 10;

/** Two docs that sync updates in both directions (remote origin on apply). */
function pairDocs(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u) => Y.applyUpdate(b, u, 'remote'));
  b.on('update', (u) => Y.applyUpdate(a, u, 'remote'));
  return [a, b];
}

function object(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!obj) throw new Error(`object ${id} not found`);
  return obj as Y.Map<unknown>;
}

/** Starts counting LOCAL_ORIGIN transactions that touch width/height. */
function watchBoxWrites(obj: Y.Map<unknown>): () => number {
  let writes = 0;
  const onChange = (ev: Y.YMapEvent<unknown>) => {
    if (ev.transaction.origin === LOCAL_ORIGIN && (ev.keysChanged.has('width') || ev.keysChanged.has('height'))) {
      writes++;
    }
  };
  obj.observe(onChange);
  return () => writes;
}

describe('text.layout box sync (ui-component, real Y.Docs)', () => {
  it('TC-12: remote text change → no write; local change → exactly one setTextBox write', () => {
    const [doc, remote] = pairDocs();
    let id = '';
    act(() => {
      id = createText(doc, { x: 0, y: 0 }, 'me')!;
    });
    const { unmount } = renderHook(() => useTextBoxSync(doc, id, measure));

    const obj = object(doc, id);
    const boxWrites = watchBoxWrites(obj);

    // Remote peer types into the same Y.Text → no dimension write by us.
    const remoteText = object(remote, id).get('text') as Y.Text;
    act(() => {
      remoteText.insert(0, 'hello');
    });
    expect(getTextContent(doc, id)!.toString()).toBe('hello');
    expect(boxWrites()).toBe(0);

    // Local change → exactly one write with the measured box.
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello world', LOCAL_ORIGIN);
    });
    expect(boxWrites()).toBe(1);
    const expected = layoutText('hello world', 'M', 'auto', null, measure);
    expect(obj.get('width')).toBe(expected.width);
    expect(obj.get('height')).toBe(expected.height);

    unmount();
  });

  it('TC-13: remeasure whose box equals the stored box → no write (no redundant updates)', () => {
    const [doc] = pairDocs();
    let id = '';
    act(() => {
      id = createText(doc, { x: 0, y: 0 }, 'me')!;
    });
    const { result, unmount } = renderHook(() => useTextBoxSync(doc, id, measure));

    // Local typing settles the box (one write).
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'hello', LOCAL_ORIGIN);
    });
    const obj = object(doc, id);
    const boxWrites = watchBoxWrites(obj);
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(obj.get('width')).toBe(50 + TEXT_PADDING_WORLD);

    // Explicit remeasure with an unchanged box → no write.
    act(() => {
      result.current.remeasureAfterLocalChange();
    });
    expect(boxWrites()).toBe(0);

    // Setting the size to the size it already has → no transaction, no write.
    act(() => {
      expect(setTextSize(doc, id, 'M')).toBe(false);
    });
    expect(boxWrites()).toBe(0);

    unmount();
  });

  it('auto → fixed transition after a width drag rewraps and writes the new height once', () => {
    const [doc] = pairDocs();
    let id = '';
    act(() => {
      id = createText(doc, { x: 0, y: 0 }, 'me')!;
    });
    const { unmount } = renderHook(() => useTextBoxSync(doc, id, measure));

    // Three words in auto mode: one line.
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'one two three', LOCAL_ORIGIN);
    });
    let obj = object(doc, id);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // The side-handle drag sets a fixed width of the minimum.
    let heightWrites = 0;
    const watch = (ev: Y.YMapEvent<unknown>) => {
      if (ev.transaction.origin === LOCAL_ORIGIN && ev.keysChanged.has('height')) heightWrites++;
    };
    obj.observe(watch);

    act(() => {
      expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    });

    obj = object(doc, id);
    expect(obj.get('widthMode')).toBe('fixed');
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    // The rewrapped text (one word per line) grew the height — written once.
    const expected = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(obj.get('height')).toBe(expected.height);
    expect(expected.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(heightWrites).toBe(1);

    unmount();
  });
});
