import { useCallback } from 'react';
import type * as Y from 'yjs';
import { readTextLayoutInput, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures a text object from the document and stores its box when it
 * differs (one LOCAL_ORIGIN write, or none). Only for local changes: typing,
 * size changes and width drags (text.layout, Key decision 1).
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const input = readTextLayoutInput(doc, id);
  if (!input) return false;
  const box = layoutText(
    input.text,
    input.size,
    input.widthMode,
    input.widthMode === 'fixed' ? input.width : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/**
 * Keeps a text object's stored width/height in step with this client's own
 * changes. Nothing is observed: remote updates never cause a write, so several
 * clients never race to store dimensions for the same change.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(() => {
    remeasureText(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
