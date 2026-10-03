// Keeping a text object's box in step with its content (story 9). See the
// text.layout / text.height contract and the "who writes the box" decision.
//
// Only the client that made a *local* change to a text object writes its box — from
// its real text and its own canvas measurement — so every screen's copy ends up with
// the same stored width / height (selection, marquee and any future export never
// re-measure), and because the change lands in the same LOCAL_ORIGIN capture window
// as the text/size change, one Ctrl+Z reverts text and box together. A *remote*
// change never triggers a write: the writer already computed the box, so a second
// measure would only risk a conflicting one.
//
// The hook therefore exposes a single imperative method the caller invokes *after* a
// local mutation (an edit, a size change, a side-handle drag). It recomputes the box
// from the object's current fields and writes it with `setTextBox`, which is a no-op
// when the box already matches — so a change that does not move the box emits nothing.

import { useCallback } from 'react';
import type * as Y from 'yjs';
import { readTextFields, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSync {
  /**
   * Recompute this object's box from its current text / size / width mode and write
   * it (one transaction) when it differs from what is stored. Call after a local
   * change; safe (and silent) to call when nothing moved.
   */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): TextBoxSync {
  const remeasureAfterLocalChange = useCallback((): void => {
    const fields = readTextFields(doc, id);
    if (!fields) return; // the object is gone (already removed as empty)
    const box = layoutText(
      fields.text,
      fields.size,
      fields.widthMode,
      fields.widthMode === 'fixed' ? fields.width : null,
      measure,
    );
    setTextBox(doc, id, { width: box.width, height: box.height });
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
