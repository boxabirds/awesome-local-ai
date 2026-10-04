/**
 * Story 9: keeping a text object's stored box in step with its content.
 *
 * The board stores width and height so that selection, the marquee and a future
 * export can lay out an object they cannot measure. Only the client that *made*
 * a change measures and writes the box: a remote keystroke must not make five
 * people compute five slightly different heights, and the five writes that would
 * follow would each be an update on the wire.
 *
 * So this is deliberately not a `Y.Doc` observer. Every local change calls it
 * explicitly, right after making the change:
 *
 *   - the editor, once a keystroke has reached the shared text;
 *   - the size buttons, after `setTextSize`;
 *   - a side-handle drag, after `setTextWidthFixed`.
 *
 * Writing here, in the same capture window as the change itself, is also what
 * makes story 8 undo a keystroke and its box as one step.
 */

import { useCallback } from 'react';

import type * as Y from 'yjs';

import { getTextObject, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export type { Measurer } from './textLayout';

export interface TextBoxSync {
  /** Measure what is in the document now and store the box, if it changed. */
  remeasureAfterLocalChange(): void;
}

/**
 * Measure the text object `id` as the document holds it and write the resulting
 * box. False when there is nothing to write: a stale id, an object that is not
 * text, or a box that already says what the measurement says.
 */
export function writeTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const object = getTextObject(doc, id);
  if (!object) return false;
  const box = layoutText(
    object.text,
    object.size,
    object.widthMode,
    object.widthMode === 'fixed' ? (object.width ?? null) : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/**
 * The hook a text object uses: `remeasureAfterLocalChange` after each of *its*
 * edits. Nothing here subscribes to the document, so a change arriving from a
 * colleague cannot write a box from this client (design: Remote client renders
 * stored box — writes 0).
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasureAfterLocalChange = useCallback(() => {
    writeTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
