/**
 * Component tests for text box sync (TC-12, TC-13).
 *
 * TC-12: a local edit updates the Y.Map box
 * TC-13: a remote edit to width does not cause a height update
 */
import { render, act, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createText, getTextContent, setTextWidthFixed } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { remeasureTextBox, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';

afterEach(() => cleanup());

/** Deterministic measurer: each character is 6px wide. */
const fakeMeasure: Measurer = (line: string, _fontPx: number) => line.length * 6;

/** Read the text entry from the doc map. */
function getEntry(doc: Y.Doc, id: string): Y.Map<unknown> {
  const objects = doc.getMap('objects');
  return objects.get(id) as Y.Map<unknown>;
}

/** A test component that calls useTextBoxSync and exposes the remeasure function. */
function SyncTester({
  doc,
  id,
  onReady,
}: {
  doc: Y.Doc;
  id: string;
  onReady(fn: () => void): void;
}) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, fakeMeasure);
  useEffect(() => {
    onReady(remeasureAfterLocalChange);
  }, [remeasureAfterLocalChange, onReady]);
  return null;
}

describe('remeasureTextBox (width drag re-wraps)', () => {
  it('a narrower fixed width re-wraps the text and grows the height', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'aaaa bbbb cccc dddd'); // 19 chars → 114 world px wide
    }, LOCAL_ORIGIN);
    remeasureTextBox(doc, id, fakeMeasure);

    const entry = getEntry(doc, id);
    const heightBefore = entry.get('height') as number;
    expect(heightBefore).toBeCloseTo(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 0);

    // Drag the right handle narrower than the single line: words must re-wrap.
    setTextWidthFixed(doc, id, 60);
    remeasureTextBox(doc, id, fakeMeasure);

    const heightAfter = entry.get('height') as number;
    const widthAfter = entry.get('width') as number;
    expect(widthAfter).toBe(60);
    expect(heightAfter).toBeGreaterThan(heightBefore);
    expect(heightAfter).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 0);
  });

  it('returns without writing when the id is not a text object', () => {
    const doc = new Y.Doc();
    expect(() => remeasureTextBox(doc, 'missing', fakeMeasure)).not.toThrow();
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('useTextBoxSync (TC-12, TC-13)', () => {
  it('TC-12: a local edit remeasures and writes the new box to the Y.Map', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 100 }, 'local')!;

    let remeasure: (() => void) | undefined;
    render(<SyncTester doc={doc} id={id} onReady={(fn) => { remeasure = fn; }} />);

    // Simulate typing: write text to the Y.Text
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'hello world');
    }, LOCAL_ORIGIN);

    // Call remeasure
    act(() => {
      remeasure!();
    });

    // The box should have been updated
    const entry = getEntry(doc, id);
    const width = entry.get('width') as number;
    const height = entry.get('height') as number;
    // Content width of "hello world" = 11 chars * 6px = 66px
    // clamped to min width = 66 (since 66 > 40)
    expect(width).toBeCloseTo(66, 0);
    // Height: 1 line * 20px * 1.3 = 26
    expect(height).toBeCloseTo(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 0);
  });

  it('TC-13: a remote edit to width does not cause a remeasure from this client', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 100 }, 'local')!;

    let remeasure: (() => void) | undefined;
    render(<SyncTester doc={doc} id={id} onReady={(fn) => { remeasure = fn; }} />);

    // Write some text first and remeasure
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'hello');
    }, LOCAL_ORIGIN);
    act(() => {
      remeasure!();
    });

    // Record current height
    const entry = getEntry(doc, id);
    const heightBefore = entry.get('height') as number;
    expect(heightBefore).toBeGreaterThan(0);

    // Now simulate a remote edit to width (not LOCAL_ORIGIN)
    doc.transact(() => {
      entry.set('width', 999);
    }, Symbol('remote'));

    // The observer fires but since origin !== LOCAL_ORIGIN, remeasureAfterLocalChange should NOT run.
    // Height should remain the same (only width was changed by the remote).
    const heightAfter = entry.get('height') as number;
    expect(heightAfter).toBe(heightBefore);
  });
});
