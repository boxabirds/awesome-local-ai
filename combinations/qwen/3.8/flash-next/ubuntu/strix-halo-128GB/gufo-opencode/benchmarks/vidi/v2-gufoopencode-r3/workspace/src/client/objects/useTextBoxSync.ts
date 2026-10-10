import { useCallback } from 'react';
import * as Y from 'yjs';
import { getTextContent, getTextFields } from '../../shared/objects/text';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

// Measure the object's current text and store the resulting box. Returns true
// when a write happened. Callers must only invoke this after a LOCAL change
// (typing, size change, fixed-width drag): remote peers render the stored box
// and never re-measure, so five clients never fight over width/height.
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const fields = getTextFields(doc, id);
  if (fields === undefined) return false;
  const box = layoutText(
    getTextContent(doc, id)?.toString() ?? '',
    fields.size,
    fields.widthMode,
    fields.widthMode === 'fixed' ? fields.width ?? null : null,
    measure
  );
  // Empty text lays out to zero width; keep the placeholder box from
  // createText (the object is removed on edit end anyway).
  if (box.width <= 0 || box.height <= 0) return false;
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer
): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(() => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
