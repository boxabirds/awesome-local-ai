// The box a text object shows, kept true to its text (story 9).
//
// A text object's height is always its content's, and its width is its content's
// too until a side handle says otherwise. Somebody has to measure the text and
// write the box after the text changed, and the rule of who is:
//
//   the client that made the change measures it.
//
// So this hook writes after a LOCAL change - a keystroke in the editor, a size
// preset from the toolbar, a width dragged by a handle - and never after a change
// that arrived from elsewhere. A remote client renders using the box the local
// one stored, which is why two people watching the same text see the same box
// without either of them measuring twice, and why a remote edit writes nothing
// back (TC-12).
//
// The measurement is the shared text layout; the measurer is passed in, so a test
// can hand in a fake one and see exact numbers.

import { useCallback, useMemo } from 'react';
import type * as Y from 'yjs';
import type { Measurer } from './textLayout';
import { createCanvasMeasurer, layoutText } from './textLayout';
import { getTextContent, setTextBox, textSnapshot } from '../../shared/objects/text';

/** One canvas, shared by every text object on the board and every board. */
let cachedMeasurer: Measurer | null = null;

/** The measurer a board uses when nothing was handed to it. */
export function sharedMeasurer(): Measurer {
  if (cachedMeasurer === null) cachedMeasurer = createCanvasMeasurer();
  return cachedMeasurer;
}

/**
 * Measure the text and store the box it came to. Returns whether the document
 * changed: a re-measure that comes to the box the object already has writes
 * nothing at all, so a size change that does not change the box is not a change
 * on the wire (TC-13).
 */
export function remeasureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer = sharedMeasurer(),
): boolean {
  const snap = textSnapshot(doc, id);
  if (snap === null) return false;
  const text = getTextContent(doc, id)?.toString() ?? snap.text;
  const box = layoutText(
    text,
    snap.size,
    snap.widthMode,
    snap.widthMode === 'fixed' ? snap.width ?? null : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/**
 * Remeasure the text object after a change this client made. Returns the one
 * function a local actor calls; it is not called for a change that came from
 * somewhere else, and it is the caller that decides which is which.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer = sharedMeasurer(),
): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(
    (): void => {
      remeasureTextBox(doc, id, measure);
    },
    [doc, id, measure],
  );
  return useMemo(() => ({ remeasureAfterLocalChange }), [remeasureAfterLocalChange]);
}
