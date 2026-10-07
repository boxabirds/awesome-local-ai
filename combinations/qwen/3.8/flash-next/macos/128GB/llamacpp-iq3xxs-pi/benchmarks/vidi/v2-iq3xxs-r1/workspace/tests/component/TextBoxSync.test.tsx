import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { useEffect } from 'react';
import { render, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import {
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import { remeasureTextBox, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  textSnapshots,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  initDoc,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  snapshot,
} from '../../src/shared/board-model';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { proseOfLength } from '../fixtures/texts';

/**
 * Who stores a text object's box (design key decision 1), with two real `Y.Doc`s:
 * the local client and a simulated remote peer. The measurer is the fake one from
 * `tests/unit/text-layout.test.ts`, so the expected numbers are written out.
 */

const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const M = TEXT_SIZES.M;
const LINE_M = M * TEXT_LINE_HEIGHT; // 26

/** Every key a *local* transaction wrote to any object: the box, or nothing. */
function trackLocalBoxWrites(doc: Y.Doc): () => string[] {
  const writes: string[] = [];
  doc.getMap(OBJECTS_MAP).observeDeep((events, tr) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    for (const event of events) {
      if (!(event instanceof Y.YMapEvent)) continue;
      for (const [key] of event.changes.keys) writes.push(key);
    }
  });
  return () => writes;
}

/**
 * The wiring a text object uses: re-measure only when the transaction that changed
 * the text came from this client, never when it came from the network.
 */
function BoxSyncHarness(props: { doc: Y.Doc; id: string; measure: Measurer }): null {
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, props.id, props.measure);
  useEffect(() => {
    const ytext = getTextContent(props.doc, props.id);
    if (!ytext) return;
    const onText = (_event: unknown, tr: Y.Transaction): void => {
      if (tr.origin === LOCAL_ORIGIN) remeasureAfterLocalChange();
    };
    ytext.observe(onText);
    return () => ytext.unobserve(onText);
  }, [props.doc, props.id, remeasureAfterLocalChange]);
  return null;
}

let local: Y.Doc;
let peer: Y.Doc;

/** What one peer stored, the other receives — with a remote origin, as sync does. */
function deliver(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from), `peer:${to.clientID}`);
}

beforeEach(() => {
  local = new Y.Doc();
  initDoc(local);
  peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
});

afterEach(() => {
  cleanup();
  local.destroy();
  peer.destroy();
});

describe('text.box sync (src/client/objects/useTextBoxSync.ts)', () => {
  // TC-12 (first half): a remote text change never writes the box back (negative).
  it('TC-12 a remote text change performs no local box write', () => {
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    deliver(local, peer);

    render(<BoxSyncHarness doc={local} id={id} measure={measure} />);
    const writes = trackLocalBoxWrites(local);

    // Somebody else types in the same text object…
    applyTextDiff(getTextContent(peer, id)!, 'What went well today', 'peer');
    deliver(peer, local);

    // …the text arrives, but this client never measures it and never answers.
    expect(textSnapshots(local)[0]!.text).toBe('What went well today');
    expect(writes()).toEqual([]);

    // …not even when the peer keeps typing: five clients would race on every key.
    let typed = 'What went well today';
    for (const word of ['And', 'the', 'demo', 'never', 'stuttered']) {
      typed = `${typed} ${word}`;
      applyTextDiff(getTextContent(peer, id)!, typed, 'peer');
      deliver(peer, local);
    }
    expect(textSnapshots(local)[0]!.text).toBe(
      'What went well today And the demo never stuttered',
    );
    expect(writes()).toEqual([]);
  });

  // TC-12 (second half): one local change writes the box once, already measured.
  it('TC-12 a local text change writes exactly one box with the measured numbers', () => {
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    deliver(local, peer);

    render(<BoxSyncHarness doc={local} id={id} measure={measure} />);
    const writes = trackLocalBoxWrites(local);

    act(() => {
      applyTextDiff(getTextContent(local, id)!, 'Went well', LOCAL_ORIGIN);
    });

    // One transaction, and the only keys it touched are the box.
    expect(writes()).toEqual(['width', 'height']);
    const stored = textSnapshots(local)[0]!;
    expect(stored.width).toBe(measure('Went well', M)); // 90
    expect(stored.height).toBe(LINE_M); // 26

    // The peer renders that box instead of measuring the text for itself.
    deliver(local, peer);
    expect(textSnapshots(peer)[0]!).toMatchObject({ width: 90, height: 26 });
  });

  // TC-13: a re-measure that agrees with the stored box writes nothing (negative).
  it('TC-13 re-measuring an unchanged box performs no write', () => {
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    const writes = trackLocalBoxWrites(local);

    // A fresh object already stores the box an empty line measures to.
    expect(textSnapshots(local)[0]!.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(remeasureTextBox(local, id, measure)).toBe(false);
    expect(writes()).toEqual([]);

    // A box that was stored explicitly and matches the text is written no second time.
    applyTextDiff(getTextContent(local, id)!, 'Went well', LOCAL_ORIGIN);
    const box = layoutText('Went well', 'M', 'auto', 0, measure);
    expect(remeasureTextBox(local, id, measure)).toBe(true);
    expect(writes()).toEqual(['width', 'height']);
    expect(textSnapshots(local)[0]!.width).toBe(box.width);
    expect(remeasureTextBox(local, id, measure)).toBe(false);
    expect(writes()).toHaveLength(2); // still only the one write

    // A size change does change the measured box, and only then is it written.
    expect(setTextSize(local, id, 'L')).toBe(true);
    expect(remeasureTextBox(local, id, measure)).toBe(true);
    expect(textSnapshots(local)[0]!.width).toBe(measure('Went well', TEXT_SIZES.L)); // 144
    expect(remeasureTextBox(local, id, measure)).toBe(false);
  });

  // A width drag turns automatic mode into fixed mode and rewraps once (task 5).
  it('auto to fixed after a width drag rewraps and writes the new height once', () => {
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    const ytext = getTextContent(local, id)!;
    // 30 characters measure 300: one line, well inside the automatic limit.
    applyTextDiff(ytext, proseOfLength(30), LOCAL_ORIGIN);
    expect(remeasureTextBox(local, id, measure)).toBe(true);
    expect(textSnapshots(local)[0]!).toMatchObject({ width: 300, height: LINE_M, widthMode: 'auto' });

    const writes = trackLocalBoxWrites(local);
    expect(setTextWidthFixed(local, id, 100)).toBe(true); // the handle was dragged
    expect(remeasureTextBox(local, id, measure)).toBe(true);

    const wrapped = textSnapshots(local)[0]!;
    expect(wrapped.widthMode).toBe('fixed');
    expect(wrapped.width).toBe(100); // the width the drag asked for
    expect(wrapped.height).toBeGreaterThan(LINE_M); // and the content now needs more lines
    expect(wrapped.height).toBe(layoutText(proseOfLength(30), 'M', 'fixed', 100, measure).height);

    // The height is written once: measuring it again has nothing left to say.
    expect(remeasureTextBox(local, id, measure)).toBe(false);
    const keys = writes();
    expect(keys.filter((k) => k === 'height')).toHaveLength(1);
  });

  // A stale id is nothing to measure, and a sticky note is not a text object.
  it('remeasureTextBox refuses a stale id or a sticky note without a write', () => {
    const writes = trackLocalBoxWrites(local);
    expect(remeasureTextBox(local, 'nope', measure)).toBe(false);
    expect(writes()).toEqual([]);
  });

  // Text objects do not disturb the sticky note snapshot the rest of the app reads.
  it('the sticky snapshot keeps holding only sticky notes', () => {
    createText(local, { x: 0, y: 0 }, 'g_local');
    expect(snapshot(local)).toHaveLength(0);
    expect(textSnapshots(local)).toHaveLength(1);
  });
});

