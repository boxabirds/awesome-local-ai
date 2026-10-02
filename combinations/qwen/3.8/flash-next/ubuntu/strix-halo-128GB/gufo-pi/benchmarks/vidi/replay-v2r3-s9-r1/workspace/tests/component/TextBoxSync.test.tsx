/**
 * Component tests for local-only box sync (story 9, text.layout).
 * TC-12 and TC-13: a remote text change must never make this client write
 * dimensions; a local change must write exactly one box, and only when it
 * actually differs from the stored one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import * as Y from 'yjs';
import { render, cleanup, act } from '@testing-library/react';
import { initDoc, getObjectsMap, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import { createText, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_BOX_PADDING_WORLD } from '../../src/client/objects/textLayout';
import { createPeer, type Peer } from '../unit/peer';

/** Deterministic measurer: 0.5 world units per character per font pixel. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** Probe component: the hook under test plus a button that triggers a remeasure. */
function Probe(props: { doc: Y.Doc; id: string; remeasureRef: React.MutableRefObject<(() => void) | null> }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, props.id, measure);
  props.remeasureRef.current = remeasureAfterLocalChange;
  return <button type="button" data-testid="remeasure" onClick={remeasureAfterLocalChange} />;
}

interface BoxWrite {
  origin: unknown;
  width: number | undefined;
  height: number | undefined;
}

function setup(): {
  doc: Y.Doc;
  id: string;
  peer: Peer;
  remeasure(): void;
  boxWrites: BoxWrite[];
  stored(): { width: number | undefined; height: number | undefined };
  ytext(): Y.Text;
} {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = createPeer(doc);
  let id = '';
  act(() => {
    id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
  });

  const boxWrites: BoxWrite[] = [];
  const observer = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    for (const e of events) {
      const keys = (e as unknown as { keysChanged?: Set<string> }).keysChanged;
      if (keys && (keys.has('width') || keys.has('height'))) {
        const m = e.target as unknown as Y.Map<unknown>;
        boxWrites.push({
          origin: transaction.origin,
          width: m.get('width') as number | undefined,
          height: m.get('height') as number | undefined,
        });
      }
    }
  };
  getObjectsMap(doc).observeDeep(observer);

  const remeasureRef: { current: (() => void) | null } = { current: null };
  render(<Probe doc={doc} id={id} remeasureRef={remeasureRef} />);

  return {
    doc,
    id,
    peer,
    remeasure() {
      act(() => {
        remeasureRef.current?.();
      });
    },
    boxWrites,
    stored() {
      const m = getObjectsMap(doc).get(id)!;
      return { width: m.get('width') as number, height: m.get('height') as number };
    },
    ytext() {
      return getObjectsMap(doc).get(id)!.get('text') as Y.Text;
    },
  };
}

afterEach(() => {
  cleanup();
});

describe('useTextBoxSync', () => {
  it('TC-12: a remote text change writes nothing; a local change writes one box', () => {
    const t = setup();

    // A remote peer types into the same text object.
    act(() => {
      t.peer.applyOnPeer((peerDoc) => {
        const m = getObjectsMap(peerDoc).get(t.id)!;
        (m.get('text') as Y.Text).insert(0, 'Went well');
      });
    });

    // The text arrived...
    expect(t.ytext().toString()).toBe('Went well');
    // ...and this client wrote no dimensions at all.
    expect(t.boxWrites).toHaveLength(0);

    // This client types, then remeasures (the editor does both in one window).
    act(() => {
      applyTextDiff(t.ytext(), 'Went well team', LOCAL_ORIGIN);
    });
    t.remeasure();

    expect(t.boxWrites).toHaveLength(1);
    expect(t.boxWrites[0].origin).toBe(LOCAL_ORIGIN);
    // 'Went well team' is 14 characters -> 140 units at size M, plus padding.
    expect(t.stored().width).toBe(14 * 10 + 2 * TEXT_BOX_PADDING_WORLD);
    expect(t.stored().height).toBeCloseTo(20 * 1.3, 6);
  });

  it('TC-13: a remeasure whose box equals the stored box writes nothing', () => {
    const t = setup();
    act(() => {
      applyTextDiff(t.ytext(), 'Went well', LOCAL_ORIGIN);
    });
    t.remeasure();
    const first = t.stored();
    expect(t.boxWrites).toHaveLength(1);

    // Same text, same size -> same box -> no redundant update.
    t.remeasure();
    t.remeasure();
    expect(t.boxWrites).toHaveLength(1);
    expect(t.stored()).toEqual(first);

    // A size change that happens to keep the same box also writes nothing.
    const writesBefore = t.boxWrites.length;
    act(() => {
      setTextSize(t.doc, t.id, 'M'); // unchanged: returns false, no transaction
    });
    t.remeasure();
    expect(t.boxWrites).toHaveLength(writesBefore);
  });

  it('a fixed-width drag rewraps and writes the new height exactly once', () => {
    const t = setup();
    act(() => {
      applyTextDiff(t.ytext(), 'aaaa bbbb cccc', LOCAL_ORIGIN);
    });
    t.remeasure();
    const autoHeight = t.stored().height!;
    expect(t.boxWrites).toHaveLength(1);

    // The handle gesture sets the fixed width, then asks for one remeasure.
    act(() => {
      setTextWidthFixed(t.doc, t.id, TEXT_MIN_WIDTH_WORLD);
    });
    const afterDrag = t.boxWrites.length;
    t.remeasure();

    expect(t.boxWrites).toHaveLength(afterDrag + 1);
    expect(t.stored().width).toBe(TEXT_MIN_WIDTH_WORLD);
    // The minimum box is narrower than a word, so each word breaks in two as
    // well: three lines become six.
    expect(t.stored().height).toBeCloseTo(autoHeight * 6, 6);
  });

  it('a very long line is capped at TEXT_MAX_AUTO_WIDTH_WORLD', () => {
    const t = setup();
    const line = ['w'.repeat(30), 'w'.repeat(29), 'w'.repeat(29)].join(' '); // 900 units
    act(() => {
      applyTextDiff(t.ytext(), line, LOCAL_ORIGIN);
    });
    t.remeasure();
    expect(t.stored().width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(t.stored().height).toBeCloseTo(3 * 20 * 1.3, 6);
  });
});
