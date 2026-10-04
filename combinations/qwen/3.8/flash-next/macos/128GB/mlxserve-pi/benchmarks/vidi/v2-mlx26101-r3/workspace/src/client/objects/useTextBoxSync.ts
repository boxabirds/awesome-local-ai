import { useCallback } from 'react';
import type { Doc } from 'yjs';
import { getTextFields, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/** A box, in world units, as the measurement came out. */
export interface TextBox {
  readonly width: number;
  readonly height: number;
}

/**
 * Measure a text object and store the box it needs.
 *
 * Returns whether the document changed: {@link setTextBox} writes nothing when the stored box
 * already says the same thing, which is what keeps a board from filling with updates that say a
 * text is the size it already was. The height is never passed in from outside: it is always what
 * the content needs, and that is the whole of why this function exists rather than being a
 * `setBox(box)` call from wherever a gesture happens to be.
 */
export function remeasureTextBox(doc: Doc, id: string, measure: Measurer): boolean {
  const fields = getTextFields(doc, id);
  if (fields === null) {
    // Not on the board, or not a text object: there is nothing to measure, and the object that a
    // gesture carried a moment ago may well have been deleted while the gesture was underway.
    return false;
  }
  const box = layoutText(
    fields.text,
    fields.size,
    fields.widthMode,
    fields.widthMode === 'fixed' ? fields.width : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export interface TextBoxSync {
  /**
   * The text of this object changed *on this client* - put there by a keystroke, a paste or an
   * IME composition that has just been written - and the box around it is now wrong.
   *
   * The object's own editor calls this from inside the transaction that wrote the change, which is
   * why nothing here has to work out who changed the text: a call only ever comes from the side that
   * did it. Nothing in this hook measures on the arrival of somebody else's change.
   */
  remeasureAfterLocalChange(): void;
}

/**
 * Keeping a text object's box the size of its text, on the screen that changed the text.
 *
 * The measurement is done by the client that types, not by each client that looks, for two
 * reasons. One is cost and noise: if every client measured, five people looking at one board would
 * be five clients writing a width into the same object, and on a board where fonts differ slightly
 * between machines they would never agree on the number and would write it forever. The other is
 * that the box would arrive late to the person typing it, who is the one person who needs to see
 * the text rewrap while they are still typing it.
 *
 * So: whoever made the change writes the box, and everybody else draws the box that was written.
 * There is no listener here that goes looking for a change to measure, which is how that rule is
 * kept: the only call comes from the editor of the object whose text this client just wrote, so a
 * change that arrives from another screen cannot start a write from this one. Whatever the other
 * machine's fonts turn out to be, this client never overrules the width it stored.
 */
export function useTextBoxSync(doc: Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasureAfterLocalChange = useCallback((): void => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
