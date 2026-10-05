/**
 * Keeping a text box the size of its text — and only for the person who changed it.
 *
 * A text object's `width` and `height` are a measurement, not a wish: somebody has to
 * measure the characters with a real font and write the result into the document, and
 * everybody else draws, selects and hit-tests with the numbers that arrive.
 *
 * So who measures? **The client that made the change**, and nobody else
 * (`text.layout`, story 9's "one client measures" rule). If every client measured on
 * every update, five people looking at one text would write five slightly different
 * boxes for it — different fonts, different hinting, different numbers — and the board
 * would flicker while they argued. With one writer the numbers are as consistent as one
 * person's font, which is the best that is available.
 *
 * That leaves a question this hook answers: how does a change that went through no
 * component of ours (a paste, an input method, an undo of your own typing) get measured?
 * It watches the object's `Y.Text`, and measures only when the transaction that changed
 * it carries `LOCAL_ORIGIN` — the tag `src/shared/board-model.ts` gives to everything
 * this client did itself. A remote peer's typing carries the sync provider's origin and
 * is ignored, which is the rule in one line.
 *
 * The measurement is scheduled on a microtask rather than done inside the observer,
 * because writing to a document from inside a transaction's own event callbacks is how
 * re-entrancy bugs are born. It happens before the browser paints, so the box on screen
 * is never one keystroke behind.
 */

import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { getTextContent, getTextFields, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measure this text now and store the box, if it is different.
 *
 * The one call for the cases that are not typing: a size picked in the toolbar, a width
 * dragged out of a handle. Both write a field the `Y.Text` observer cannot see, so they
 * say so here. An id that is gone measures nothing.
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): void {
  const fields = getTextFields(doc, id);
  if (!fields) return;
  const box = layoutText(fields.text, fields.size, fields.widthMode, fields.width, measure);
  // `setTextBox` writes nothing when the box already matches, which is what makes this
  // safe to call after every single keystroke.
  setTextBox(doc, id, { width: box.width, height: box.height });
}

export interface TextBoxSync {
  /** Measure after a change *this client* made to the text, its size or its width. */
  remeasureAfterLocalChange(): void;
}

/**
 * Keep `id`'s box measured, locally.
 *
 * Call it from the object that draws the text. It returns the one method the local
 * change sites (typing, size, dragged width) call, and takes care of the local changes
 * nobody announces — an input-method commit, a paste — by measuring after any
 * `LOCAL_ORIGIN` change to the text itself.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasure = useCallback(() => remeasureText(doc, id, measure), [doc, id, measure]);

  useEffect(() => {
    const text = getTextContent(doc, id);
    if (!text) return;

    let scheduled = false;
    const observe = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      // `text.layout: measure locally` — a remote peer's typing arrives with the sync
      // provider's origin, and their measurement is already in the update we just
      // applied. An undo carries the undo manager's origin and restores the stored box
      // with the rest of the step.
      if (transaction.origin !== LOCAL_ORIGIN) return;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        remeasure();
      });
    };

    text.observe(observe);
    return () => text.unobserve(observe);
  }, [doc, id, remeasure]);

  return { remeasureAfterLocalChange: remeasure };
}
