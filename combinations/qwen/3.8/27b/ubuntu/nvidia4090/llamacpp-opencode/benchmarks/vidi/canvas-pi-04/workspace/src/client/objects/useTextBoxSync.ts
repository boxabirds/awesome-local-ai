// Story 9: the client hook that writes the measured text box after LOCAL
// changes (anchor: text.layout, design key decision 1).
//
// Writes happen after the local Y.Text change (so the new content is already
// in the doc) and always write width AND height together in one update
// (setTextBox), so a remote client never sees a half-measured box. No-ops are
// detected by the model (same values -> no transaction), which keeps remote
// traffic low (TC-13).

import { useCallback } from 'react';
import type * as Y from 'yjs';
import { getTextContent, getTextMeta, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSync {
  /**
   * Recompute the box from the current content/size/mode and write it if it
   * changed. A no-op (no transaction) when the measured box is unchanged or
   * the object no longer exists (deleted remotely).
   */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasureAfterLocalChange = useCallback(
    (): void => {
      if (id === '') return;
      const content = getTextContent(doc, id);
      if (content === undefined) return; // object gone (remote delete)
      const meta = getTextMeta(doc, id);
      if (meta === undefined) return;
      const layout = layoutText(
        content.toString(),
        meta.size,
        meta.widthMode,
        meta.widthMode === 'fixed' ? meta.width : null,
        measure,
      );
      // setTextBox no-ops (no transaction) when the box is unchanged.
      setTextBox(doc, id, { width: layout.width, height: layout.height });
    },
    [doc, id, measure],
  );

  return { remeasureAfterLocalChange };
}
