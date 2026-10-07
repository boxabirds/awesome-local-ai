/**
 * Keeping a text object's box the size of its text (`text.sync`).
 *
 * The height of a text object is never stored by accident: it is a measurement
 * (`layoutText`), and only the client that *changed* the text measures it. That
 * rule is the whole content of this file:
 *
 * - a local change to the text, the size or the width calls `remeasureAfterLocalChange`,
 *   which writes the measured box;
 * - a change that came from somewhere else writes nothing here - the client that
 *   made that change already measured it, and two clients writing the same box
 *   would be an update storm on every keystroke;
 * - a measurement that comes out the same as the box already stored writes nothing
 *   at all (`text.no_redundant_write`), which is what makes it safe to call this
 *   after every keystroke.
 *
 * The box is written with {@link setTextBox}, which leaves `widthMode` alone:
 * measuring an automatic-width object must not turn it into a fixed-width one.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';

import * as Y from 'yjs';

import { OBJECT_FIELDS } from '../../shared/board-model.js';
import { DEFAULT_TEXT_SIZE, isTextSize, TEXT_FONT_FAMILY } from '../../shared/config.js';
import { getTextWidthMode, setTextBox, TEXT_TYPE, type TextBox } from '../../shared/objects/text.js';
import { createCanvasMeasurer, layoutText, type Measurer } from './textLayout.js';

/** Read the object's own fields, lay its text out, and return the box it needs. */
export function measureTextBox(doc: Y.Doc, id: string, measure: Measurer): TextBox | null {
  const map = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(map instanceof Y.Map) || map.get(OBJECT_FIELDS.type) !== TEXT_TYPE) return null;
  const text = map.get(OBJECT_FIELDS.text);
  if (!(text instanceof Y.Text)) return null;

  const stored = map.get('size');
  const size = isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
  const widthMode = getTextWidthMode(doc, id);
  const width = map.get(OBJECT_FIELDS.width);
  const fixed =
    typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : null;

  const layout = layoutText(text.toString(), size, widthMode, fixed, measure);
  return { width: layout.width, height: layout.height };
}

/** One board's remeasure functions, by object id. */
const remeasurers = new WeakMap<Y.Doc, Map<string, () => boolean>>();

/** The measurer for boards that were handed none: the browser's own, at the font
 * the board draws text in - a box measured in a different face is a box the words
 * do not fit in. */
let sharedMeasurer: Measurer | undefined;
const defaultMeasurer = (): Measurer => {
  if (sharedMeasurer === undefined) sharedMeasurer = createCanvasMeasurer(TEXT_FONT_FAMILY);
  return sharedMeasurer;
};

/** Measure `id`'s text and store the box, when it is not the box it has. */
function writeMeasuredBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const box = measureTextBox(doc, id, measure);
  return box !== null && setTextBox(doc, id, box);
}

/**
 * Measure object `id` and store the box, if it is different from the one it has.
 *
 * `true` when a write happened. An object that is not mounted right now - a text
 * object nobody is looking at, which cannot be selected either, but a model call
 * can still be made for it - is measured with the board's own measurer, so a size
 * change never ends up with a box that was not updated.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure?: Measurer): boolean {
  const registered = remeasurers.get(doc)?.get(id);
  if (registered) return registered();
  return writeMeasuredBox(doc, id, measure ?? defaultMeasurer());
}

/** What {@link useTextBoxSync} gives the object that owns the text. */
export interface TextBoxSync {
  /**
   * Measure and store the box, after a change this tab made. Called from the
   * editor's `onInput` and from anything that changes the size or the width.
   * Returns whether a write happened, which is `false` as often as not - and the
   * reason `text.no_redundant_write` costs nothing.
   */
  remeasureAfterLocalChange(): boolean;
}

/**
 * The box sync of one text object, for the component that renders it.
 *
 * It writes nothing on mount: a board that received a text object from somebody
 * else must not answer with a write of its own.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure?: Measurer): TextBoxSync {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback((): boolean => {
    return writeMeasuredBox(doc, id, measureRef.current ?? defaultMeasurer());
  }, [doc, id]);

  // Published for the rest of the board - the text toolbar and a horizontal
  // handle drag change the size or the width from outside the object, and have to
  // remeasure through *this* object's measurer rather than guess at another one.
  useLayoutEffect(() => {
    let byId = remeasurers.get(doc);
    if (!byId) {
      byId = new Map();
      remeasurers.set(doc, byId);
    }
    byId.set(id, remeasureAfterLocalChange);
    return () => {
      const current = remeasurers.get(doc);
      if (!current) return;
      if (current.get(id) === remeasureAfterLocalChange) current.delete(id);
      if (current.size === 0) remeasurers.delete(doc);
    };
  }, [doc, id, remeasureAfterLocalChange]);

  return { remeasureAfterLocalChange };
}
