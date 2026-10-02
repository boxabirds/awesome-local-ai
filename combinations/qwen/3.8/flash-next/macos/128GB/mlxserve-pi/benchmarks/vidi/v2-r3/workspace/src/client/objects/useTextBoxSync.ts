// Writing a text object's measured box back into the document.
//
// One rule decides everything here: the box is written by the client that
// *changed* the text, and by nobody else. Five people watching the same heading
// all measure the same text and would all write the same five boxes within a
// heartbeat of one another — five transactions, five sync messages, and an undo
// history on each client polluted by writes it never made. So a change that came
// from elsewhere is rendered from the box that arrived with it and never
// remeasured. The client that made the change calls `remeasureAfterLocalChange`
// itself, in the same undo capture window as its own edit, so one undo puts the
// text and the box back together.
import { useCallback, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { getTextObject, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSync {
  /**
   * Measure what this text object holds now and store the box, if it is not the
   * box it already has. Call it after a change this client made; never in
   * response to one that arrived from elsewhere.
   */
  remeasureAfterLocalChange(): void;
}

/**
 * The box `id` should have, written only when it differs from the one it has.
 *
 * Returns true when a write happened. A stale id, an object that is not a text
 * object, and a box that has not changed all answer false and open no
 * transaction — the negative half of "no redundant box writes".
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const object = getTextObject(doc, id);
  if (object === undefined) return false;
  const box = layoutText(object.text, object.size, object.widthMode, object.width, measure);
  if (object.width === box.width && object.height === box.height) return false;
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/**
 * `remeasureAfterLocalChange` for one text object, always aimed at the document
 * and measurer the component currently has.
 *
 * The arguments are taken when the callback runs rather than when it was made, so
 * a callback handed to an editor or a toolbar keeps working across a re-render
 * with a different measurer, and never measures with a stale one.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const args = useRef({ doc, id, measure });
  useLayoutEffect(() => {
    args.current = { doc, id, measure };
  });

  const remeasureAfterLocalChange = useCallback((): void => {
    const current = args.current;
    remeasureTextBox(current.doc, current.id, current.measure);
  }, []);

  return { remeasureAfterLocalChange };
}
