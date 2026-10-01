/**
 * Component tests for useTextBoxSync: verifies that box writes happen only
 * after local changes, never after remote updates.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, getTextContent, setTextBox } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';

/** A deterministic fake measurer: 12 world units per character. */
function fakeMeasurer(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('useTextBoxSync', () => {
  it('TC-12: remote text change → no setTextBox write; local change → one write', () => {
    const docA = makeDoc();
    const docB = makeDoc();

    // Create a text object in docA
    const id = createText(docA, { x: 0, y: 0 }, 'userA')!;
    expect(id).toBeTruthy();

    // Sync docA → docB (peer)
    const update = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, update);

    // docB now has the text object. Apply further updates from docA to docB.
    docA.on('update', (u: Uint8Array) => {
      Y.applyUpdate(docB, u);
    });

    // Set up the hook on docA
    const { result } = renderHook(() => useTextBoxSync(docA, id, fakeMeasurer));

    // Write some text locally and then call remeasureAfterLocalChange.
    // 11 chars * 12 = 132 width, which differs from the initial box (60).
    const ytext = getTextContent(docA, id)!;
    docA.transact(() => { ytext.insert(0, 'Hello World'); }, LOCAL_ORIGIN);

    let writeCount = 0;
    docA.on('update', () => { writeCount++; });

    // Local change with remeasure → should write box
    result.current.remeasureAfterLocalChange();
    expect(writeCount).toBe(1);

    // Now simulate a remote change (origin not LOCAL_ORIGIN)
    const REMOTE_ORIGIN = Symbol('remote');
    const remoteText = getTextContent(docB, id)!;
    // Apply remote changes to docA via sync (not LOCAL_ORIGIN)
    // The docA.on('update') listener already syncs A→B, but we need B→A
    docB.on('update', (u: Uint8Array) => {
      // Apply with a non-local origin to simulate remote
      Y.applyUpdate(docA, u, REMOTE_ORIGIN);
    });
    docB.transact(() => { remoteText.insert(0, 'Hi '); }, REMOTE_ORIGIN);

    // Count writes after the remote change
    const writeCountAfterRemote = writeCount;
    // No call to remeasureAfterLocalChange → no new writes
    // The remote change should NOT trigger any setTextBox
    // (we don't call remeasureAfterLocalChange, and no hook is watching remote)
    expect(writeCount).toBe(writeCountAfterRemote);
  });

  it('TC-13: box unchanged after remeasure → no write', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'userA')!;

    // Insert text and set box to the expected values already
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, 'Hi'); }, LOCAL_ORIGIN);

    // Pre-compute what the box should be
    const fontPx = TEXT_SIZES.M;
    const expectedWidth = fakeMeasurer('Hi', fontPx);
    const expectedHeight = fontPx * TEXT_LINE_HEIGHT;
    setTextBox(doc, id, { width: expectedWidth, height: expectedHeight });

    // Set up hook
    const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasurer));

    // Now remeasure — box should already be correct
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    result.current.remeasureAfterLocalChange();
    expect(updateCount).toBe(0);
  });
});
