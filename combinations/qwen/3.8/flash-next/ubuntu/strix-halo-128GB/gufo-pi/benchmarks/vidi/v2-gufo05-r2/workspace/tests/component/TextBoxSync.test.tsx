/**
 * Story 9, `text.box_sync`: only the client that changed the text measures it.
 *
 * TC-12 is the rule that keeps five people looking at one heading from producing
 * five slightly different boxes and five writes: a change that arrives from a
 * colleague is rendered as it arrives, and this client's box stays untouched.
 * TC-13 checks the other half on the real board — what is selected is the stored
 * box, so the handles a person drags are the object the document describes.
 */

import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { objectBounds } from '../../src/shared/board-model';
import { TEXT_SIZES } from '../../src/shared/config';
import {
  createText,
  getTextContent,
  getTextObject,
  setTextSize,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  useTextBoxSync,
  writeTextBox,
  type Measurer,
} from '../../src/client/objects/useTextBoxSync';
import { layoutText } from '../../src/client/objects/textLayout';
import { changeAsPeer } from '../unit/helpers/peer';
import { flushFrames, overlayRect, selectionIds } from './selectionHarness';
import { readBoardDoc, renderBoard } from './boardHarness';

/** 10 board units per character at size M — exact, and enough to wrap at. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** A component whose only job is the hook, so a test can call it and count. */
function renderSyncProbe(doc: Y.Doc, id: string): { remeasure: () => void } {
  const handle = { remeasure: () => {} };
  function Probe(): null {
    const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);
    handle.remeasure = remeasureAfterLocalChange;
    return null;
  }
  render(<Probe />);
  return handle;
}

/** Count writes to a text object's stored `width`/`height`. */
function countBoxWrites(doc: Y.Doc, id: string, run: () => void): number {
  let writes = 0;
  const observer = (events: Y.YEvent<any>[]) => {
    for (const event of events) {
      if (event.target !== doc.getMap<Y.Map<unknown>>('objects').get(id)) continue;
      const changed = event.changes.keys as Map<string, { action: string }>;
      if (changed.has('width') || changed.has('height')) writes += 1;
    }
  };
  doc.getMap<Y.Map<unknown>>('objects').observeDeep(observer);
  try {
    act(run);
  } finally {
    doc.getMap<Y.Map<unknown>>('objects').unobserveDeep(observer);
  }
  return writes;
}

function seedText(doc: Y.Doc, text: string, at = { x: 0, y: 0 }): string {
  const id = createText(doc, at, 'g_test')!;
  if (text) getTextContent(doc, id)!.insert(0, text);
  writeTextBox(doc, id, measure);
  return id;
}

describe('text.box_sync — who measures', () => {
  it('TC-12: a local change writes the box once; a remote change writes it never', () => {
    const doc = new Y.Doc();
    const id = seedText(doc, '');
    const probe = renderSyncProbe(doc, id);
    const initial = { ...getTextObject(doc, id)! };

    // A colleague types and picks a bigger size. Their client measured the box;
    // this one only draws what arrived.
    const remoteWrites = countBoxWrites(doc, id, () => {
      changeAsPeer(doc, (peer) => {
        applyTextDiff(
          getTextContent(peer, id)!,
          'a heading far too long for the box it started in',
          null,
        );
        setTextSize(peer, id, 'XL');
      });
    });
    expect(remoteWrites).toBe(0);
    // The text did arrive…
    expect(getTextObject(doc, id)!.text).toBe(
      'a heading far too long for the box it started in',
    );
    // …and the box is exactly what arrived, not a fresh local measurement.
    expect(getTextObject(doc, id)!.width).toBe(initial.width);
    expect(getTextObject(doc, id)!.height).toBe(initial.height);

    // Now this client changes it: one measurement, one write.
    const localWrites = countBoxWrites(doc, id, () => {
      applyTextDiff(getTextContent(doc, id)!, `${getTextContent(doc, id)!.toString()}!`, null);
      probe.remeasure();
    });
    expect(localWrites).toBe(1);
    const after = getTextObject(doc, id)!;
    const expected = layoutText(after.text, after.size, 'auto', null, measure);
    // The box is stored rounded to whole board units.
    expect(after.width).toBe(Math.round(expected.width));
    expect(after.height).toBe(Math.round(expected.height));
  });

  it('TC-13: a local change that leaves the box the same writes nothing', () => {
    const doc = new Y.Doc();
    const id = seedText(doc, 'Went well');
    const probe = renderSyncProbe(doc, id);
    const writes = countBoxWrites(doc, id, () => probe.remeasure());
    expect(writes).toBe(0);
  });

  it('a size change is measured into the box: the object gets taller for a bigger size', () => {
    const doc = new Y.Doc();
    const id = seedText(doc, 'Went well');
    const before = getTextObject(doc, id)!;
    act(() => {
      setTextSize(doc, id, 'XL');
      writeTextBox(doc, id, measure);
    });
    const after = getTextObject(doc, id)!;
    expect(after.height).toBe(
      Math.round((TEXT_SIZES.XL / TEXT_SIZES.M) * before.height!),
    );
    expect(after.width).toBeGreaterThan(before.width!);
  });
});

describe('text.box_sync — what is selected is the stored box', () => {
  it('TC-13b: the selection outline follows the box stored in the document', () => {
    renderBoard();
    const doc = readBoardDoc();
    const id = seedText(doc, 'Went well');
    act(() => {
      setTextSize(doc, id, 'XL');
      writeTextBox(doc, id, measure);
    });
    flushFrames();

    // Select it the way a click does.
    const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
    expect(el).not.toBeNull();
    act(() => {
      el!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      el!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    flushFrames();
    expect(selectionIds()).toEqual([id]);

    const stored = objectBounds(getTextObject(doc, id)!);
    const outline = overlayRect();
    expect(outline).not.toBeNull();
    expect(outline!.width).toBeCloseTo(stored.width, 1);
    expect(outline!.height).toBeCloseTo(stored.height, 1);

    // A colleague's change arrives; this client draws the box that arrives with it.
    changeAsPeer(doc, (peer) => {
      applyTextDiff(getTextContent(peer, id)!, 'Went well, and the plan for tomorrow is set', null);
    });
    flushFrames();
    const remoteStored = objectBounds(getTextObject(doc, id)!);
    const after = overlayRect();
    expect(after!.width).toBeCloseTo(remoteStored.width, 1);
    expect(after!.height).toBeCloseTo(remoteStored.height, 1);
  });
});
