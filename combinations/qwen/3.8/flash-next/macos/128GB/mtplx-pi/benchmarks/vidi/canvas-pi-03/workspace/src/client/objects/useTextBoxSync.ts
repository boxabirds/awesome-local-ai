import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { getTextContent, getTextObject, setTextBox } from '../../shared/objects/text';
import { fontSpec, layoutAuto, layoutFixed, type Measurer } from './text/text-layout';

/** The footprint a block's content needs right now, or null when `id` is not a
 * text block (deleted, or never one). */
export function computeTextBox(doc: Y.Doc, id: string, measure: Measurer) {
  const state = getTextObject(doc, id);
  if (state === null) return null;
  const ytext = getTextContent(doc, id);
  if (ytext === undefined) return null;
  const font = fontSpec(state.size);
  return state.widthMode === 'fixed'
    ? layoutFixed(state.text, state.width, font, measure)
    : layoutAuto(state.text, font, undefined, measure);
}

export interface TextBoxSync {
  /**
   * Remeasure the block and store the result. Writes only when the box actually
   * changes, and returns whether it wrote. Safe to call from inside a
   * transaction: the write joins the transaction that is already open, so a
   * keystroke and the box it produces stay ONE undo step.
   */
  remeasureAfterLocalChange(): boolean;
}

/**
 * Keep a block's stored box in step with its content (design key decision 1).
 *
 * Only the client that made the change measures it. A remote update never
 * re-measures: every client would otherwise write its own idea of the box for
 * the same text, and five people typing into one board would spend the session
 * overwriting each other's dimensions.
 *
 * The measurement runs inside the change's own transaction window, so text and
 * footprint land in one undo group: Ctrl+Z brings the old text and the old box
 * back together.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasure = useCallback(() => {
    const box = computeTextBox(doc, id, measureRef.current);
    if (box === null) return false;
    return setTextBox(doc, id, box);
  }, [doc, id]);

  const remeasureRef = useRef(remeasure);
  remeasureRef.current = remeasure;

  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const record = objects.get(id) as Y.Map<unknown> | undefined;
    if (record === undefined) return;

    const handler = (_events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
      // Remote change: render the stored box, never rewrite it.
      if (!transaction.local) return;
      remeasureRef.current();
    };

    record.observeDeep(handler);
    // A block that has never been measured (a fresh creation, or the first
    // render after a reconnect) gets its box here, once.
    remeasureRef.current();

    return () => {
      record.unobserveDeep(handler);
    };
  }, [doc, id]);

  return { remeasureAfterLocalChange: remeasure };
}
