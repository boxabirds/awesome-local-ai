/**
 * Keeping a text object's box the size of its content — and only on the screen that changed it.
 *
 * A text object stores its own `width` and `height`, like every other object on the board, because
 * the things that need a rectangle do not have a browser in front of them: the selection's bounding
 * box, the marquee's hit test, an export, another person's screen. What makes a text object different
 * is that its box is not its own decision — it is the shape of its text at its size in its width mode,
 * and it changes when any of those changes.
 *
 * So somebody has to measure. It is the client that made the change, and only that client: five people
 * watching a heading being typed who each measured and wrote the box would be five writes per
 * keystroke, arriving in an order nobody can predict, saying slightly different things because fonts
 * differ between machines. The person typing writes one box per burst; everyone else draws the box
 * that was written. That is why this file listens to nothing: the function below is called by the three
 * local actions that change what the text looks like — typing, a size change and a side-handle drag —
 * and by nothing else.
 */

import { useCallback } from 'react';
import type { Doc } from 'yjs';

import { setTextBox, getTextContent, getTextSize, getTextWidth, getTextWidthMode } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/** What a client does after it changed a text object itself. */
export interface TextBoxSync {
  /**
   * Measures the text object again and stores the box, if it came out different.
   *
   * Called after a local change: a keystroke, a size picked in the toolbar, a side handle dragged. A
   * change that came from somebody else is never followed by this call — the person who made it has
   * already written the box, and this client's fonts would only disagree with them.
   */
  remeasureAfterLocalChange(): void;
}

/**
 * The box a text object's content asks for, measured against the document as it stands.
 *
 * Everything is read from the document rather than handed in — the text, the size, the width mode and
 * the fixed width. A size change is the case that needs that: the toolbar writes the new size and then
 * measures, and a measurement taken from the props of the render that showed the old size would be a
 * box for the old size.
 *
 * Returns the box it measured, or null when there is no such text object to measure.
 */
export function measureTextBox(
  doc: Doc,
  id: string,
  measure: Measurer,
): { width: number; height: number } | null {
  const ytext = getTextContent(doc, id);
  if (ytext === undefined) return null;
  const size = getTextSize(doc, id);
  const mode = getTextWidthMode(doc, id);
  if (size === undefined || mode === undefined) return null;
  return layoutText(
    ytext.toString(),
    size,
    mode,
    mode === 'fixed' ? (getTextWidth(doc, id) ?? null) : null,
    measure,
  );
}

/**
 * Measures a text object and writes the box, if the box is not already that.
 *
 * The `if` is the whole of the no-redundant-writes rule: a remeasure that arrives at the width and
 * height the document already holds writes nothing at all — no update, no message to everybody else,
 * and no empty step in this person's undo history. {@link setTextBox} is the one that decides, and it
 * decides by comparing numbers, not by remembering that it was called.
 */
export function remeasureTextBox(doc: Doc, id: string, measure: Measurer): boolean {
  const box = measureTextBox(doc, id, measure);
  if (box === null) return false;
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/**
 * The box writer of one text object, as a stable callback.
 *
 * It holds no state and subscribes to nothing, so it can be called from an input handler, from a button
 * and from a gesture alike. The object's identity is the id it was given: a component that renders a
 * different object gets a different hook, and an object that has gone away is answered by
 * {@link remeasureTextBox} finding nothing to measure, which is the same silence as writing nothing.
 */
export function useTextBoxSync(doc: Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasureAfterLocalChange = useCallback(
    () => {
      remeasureTextBox(doc, id, measure);
    },
    [doc, id, measure],
  );
  return { remeasureAfterLocalChange };
}
