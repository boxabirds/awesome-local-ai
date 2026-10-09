import { useCallback } from 'react';
import type * as Y from 'yjs';
import { readText, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Keeping a text object's stored box honest (design key decision 1).
 *
 * A text's height is its content and its width is either its longest line or the width a
 * side handle set — but measuring needs the fonts on this screen, and two people do not
 * have the same ones. So the box is measured and *stored*: only the client that made a
 * local change measures it and writes it, in the same undo window as the change itself.
 * Anyone else draws the box that is in the document and does not re-measure, or a reader
 * with slightly wider fonts would push the author's text around on their screen.
 *
 * That is why nothing here observes the document. There is nothing to watch: a remote
 * change arrives, is drawn, and is left alone. The functions are called from the paths
 * that just changed something locally — typing, a size change, a handle drag.
 */

/**
 * The box `id`'s text needs now, read from the document as it stands: the text and size
 * it holds, wrapped at the width it holds. Null when `id` is not a text object.
 */
export function measureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { width: number; height: number } | null {
  const text = readText(doc, id);
  if (!text) return null;
  const layout = layoutText(text.text, text.size, text.widthMode, text.width, measure);
  return { width: layout.width, height: layout.height };
}

/**
 * Measure `id` and store the box, unless it is already what the document holds — a size
 * change that comes back the same size costs the document nothing. True when it wrote.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const box = measureTextBox(doc, id, measure);
  return !!box && setTextBox(doc, id, box);
}

/**
 * The same for a selection, whose ids may be any mix of types: everything that is not a
 * text object is ignored, and `moveObjects`/`resizeObjects` have already positioned it.
 * How many boxes were rewritten.
 */
export function remeasureTextBoxes(
  doc: Y.Doc,
  ids: Iterable<string>,
  measure: Measurer,
): number {
  let written = 0;
  for (const id of ids) {
    if (remeasureTextBox(doc, id, measure)) written += 1;
  }
  return written;
}

/**
 * The component's handle on the above: `remeasureAfterLocalChange` is called after this
 * component's own edit, and does nothing at all at any other time.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback((): void => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
