// @vitest-environment jsdom
/**
 * Component tests — useTextBoxSync (story 9, TC-12/TC-13).
 *
 * TC-12: a remote text change never triggers a box write; a local change
 * (via remeasureAfterLocalChange) produces exactly one setTextBox.
 * TC-13: when the remeasured box is unchanged, no write happens at all.
 *
 * A deterministic fake measurer (5px per char) keeps the expected boxes
 * exact. Text lengths are chosen so the deterministic layout differs from
 * the creation-time estimate (jsdom has no canvas) and from each other.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { render, cleanup, act } from '@testing-library/react';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { layoutText } from '../../src/client/objects/textLayout';
import { createText } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';

// Deterministic measurer: 5px per char (any string of the same length lays
// out identically)
const fakeMeasure: Measurer = (text) => text.length * 5;

function expectedBox(text: string) {
  return layoutText(text, 'M', 'auto', null, fakeMeasure);
}

function makeObj(doc: Y.Doc, text: string): string {
  const id = createText(doc, { x: 30, y: 40 }, 'g_test');
  if (!id) throw new Error('createText failed');
  const ytext = ((doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text'));
  if (ytext instanceof Y.Text && text.length > 0) {
    doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    }, LOCAL_ORIGIN);
  }
  return id;
}

function boxOf(doc: Y.Doc, id: string) {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
  return {
    width: obj.get('width') as number,
    height: obj.get('height') as number,
  };
}

function SyncHarness({
  doc,
  id,
  onReady,
}: {
  doc: Y.Doc;
  id: string;
  onReady: (r: { remeasure: () => void }) => void;
}) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, fakeMeasure);
  onReady({ remeasure: remeasureAfterLocalChange });
  return <div data-testid="sync-harness" />;
}

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  cleanup();
  doc.destroy();
});

describe('useTextBoxSync component tests (story 9)', () => {
  it('TC-12: remote text change → no box write; local change → exactly one setTextBox', () => {
    // "hello world!" (12 chars): creation estimate ≈ 148px wide (0.6 factor),
    // deterministic layout = 12*5+4 = 64px → they differ, so a remeasure is
    // observable.
    // The box is stale (40x26 from the empty creation) — the text was
    // inserted after createText without a remeasure, exactly like a fresh
    // object before its first client-side measurement.
    const id = makeObj(doc, 'hello world!');
    const initial = boxOf(doc, id);
    expect(initial.width).toBe(TEXT_MIN_WIDTH_WORLD);

    let api: { remeasure: () => void } | null = null;
    render(<SyncHarness doc={doc} id={id} onReady={(r) => (api = r)} />);
    expect(api).not.toBeNull();

    let updates = 0;
    const onUpdate = () => updates++;
    doc.on('update', onUpdate);

    // Remote change (peer origin): "hello world!" → "hi". No box write may
    // follow: the remote client is not the one that made the change.
    const ytext = ((doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.get('text')) as Y.Text;
    act(() => {
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, 'hi');
      }, 'remote-peer');
    });
    expect(updates).toBe(1);
    expect(boxOf(doc, id)).toEqual(initial);

    // Local change: "hi" → 24 z's (deterministic layout 124px, differs from
    // the stored box) — the client that made the change remeasures.
    updates = 0;
    act(() => {
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, 'z'.repeat(24));
      }, LOCAL_ORIGIN);
    });
    expect(updates).toBe(1); // the text update itself

    act(() => {
      api!.remeasure();
    });
    // Exactly one setTextBox followed the local change
    expect(updates).toBe(2);

    const expected = expectedBox('z'.repeat(24));
    const box = boxOf(doc, id);
    expect(box.width).toBeCloseTo(expected.width, 5);
    expect(box.height).toBeCloseTo(expected.height, 5);

    doc.off('update', onUpdate);
  });

  it('TC-13: box unchanged after remeasure → no write (negative)', () => {
    const id = makeObj(doc, 'hello');
    // Force the stored box to exactly match the deterministic layout
    const expected = expectedBox('hello');
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    doc.transact(() => {
      obj.set('width', expected.width);
      obj.set('height', expected.height);
    }, LOCAL_ORIGIN);

    let api: { remeasure: () => void } | null = null;
    render(<SyncHarness doc={doc} id={id} onReady={(r) => (api = r)} />);

    let updates = 0;
    const onUpdate = () => updates++;
    doc.on('update', onUpdate);

    // Remeasure with an unchanged box → no write at all
    act(() => {
      api!.remeasure();
    });
    expect(updates).toBe(0);
    expect(boxOf(doc, id)).toEqual({
      width: expected.width,
      height: expected.height,
    });

    doc.off('update', onUpdate);
  });
});
