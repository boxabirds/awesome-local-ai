import { useCallback } from 'react';
import type * as Y from 'yjs';
import { remeasureTextObject, type Measurer } from './textLayout';

/**
 * Story 9 (text box sync): per-text-object hook form. Returns
 * `remeasureAfterLocalChange`, to be called after LOCAL edits (typing, size
 * change, side-handle drag). Remote changes are never measured by the
 * receiving client — the sender writes the box and it syncs (see
 * `remeasureTextObject` in textLayout.ts).
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange: () => void } {
  const remeasureAfterLocalChange = useCallback(
    () => remeasureTextObject(doc, id, measure),
    [doc, id, measure],
  );
  return { remeasureAfterLocalChange };
}
