// Box sync component tests (story 9, TC-12/TC-13): remote changes must never
// write dimensions; repeated identical remeasures write nothing.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import { createText, getTextContent, setTextWidthFixed } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

afterEach(() => cleanup());

/** Deterministic fake measurer: 10 world units per character. */
const measure10: Measurer = (text) => text.length * 10;

let remeasureRef: (() => void) | undefined;

function Probe({ doc, id, measure }: { doc: Y.Doc; id: string; measure: Measurer }): null {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);
  remeasureRef = remeasureAfterLocalChange;
  return null;
}

function remeasure(): void {
  if (remeasureRef === undefined) throw new Error('probe not rendered');
  remeasureRef();
}

/** The stored box of a text object, as a plain object. */
function box(doc: Y.Doc, id: string): { width: number; height: number } {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const object = objects.get(id);
  if (object === undefined) throw new Error('object missing');
  return { width: object.get('width') as number, height: object.get('height') as number };
}

describe('text box sync', () => {
  it('TC-12 remote change → stored box unchanged (zero writes from the remote client)', () => {
    const a = new Y.Doc();
    initDoc(a);
    const id = createText(a, { x: 0, y: 0 }, 'g_a')!;
    const before = box(a, id);
    render(<Probe doc={a} id={id} measure={measure10} />);

    // A REMOTE client (doc b) starts from the same state and edits the text.
    const b = new Y.Doc();
    initDoc(b);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'init');
    applyTextDiff(getTextContent(b, id)!, 'A remote typed many words here', 'g_b');

    // The remote change arrives at A.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'remote');

    // A's stored box is exactly the box A wrote itself — the remote never
    // writes dimensions. (The text itself did sync.)
    expect(box(a, id)).toEqual(before);
    expect(getTextContent(a, id)!.toString()).toBe('A remote typed many words here');
  });

  it('TC-13 repeated identical remeasure → no update events (idempotent)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_a')!;
    render(<Probe doc={doc} id={id} measure={measure10} />);

    const object = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)!;
    let events = 0;
    const listener = (): void => {
      events += 1;
    };
    object.observe(listener);

    // First remeasure after a local change writes the new box (1 event).
    applyTextDiff(getTextContent(doc, id)!, 'hello', 'g_a');
    remeasure();
    expect(box(doc, id)).toEqual({ width: 50, height: 26 });
    const afterFirst = events;
    expect(afterFirst).toBe(1);

    // Identical remeasure → no write, no event.
    remeasure();
    expect(events).toBe(afterFirst);

    object.unobserve(listener);
  });

  it('remeasure after a fixed-width drag updates height only (width from the drag)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_a')!;
    render(<Probe doc={doc} id={id} measure={measure10} />);

    // A local user drags the side handle to width 20 (clamped to 40).
    expect(setTextWidthFixed(doc, id, 20)).toBe(true);
    applyTextDiff(getTextContent(doc, id)!, 'aaaa bbbb cccc', 'g_a');
    remeasure();
    // Width stays at the dragged (clamped) value; height follows the rewrap.
    expect(box(doc, id)).toEqual({ width: 40, height: 78 });
  });
});
