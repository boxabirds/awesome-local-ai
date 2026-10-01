import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { readText, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures the text object and stores width/height when they differ. Called only after a local
 * change (typing, size change, fixed-width drag): remote clients render the stored box and never
 * write, so several clients never race to write the same dimensions.
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = readText(doc, id);
  if (!obj) return false;
  const box = layoutText(obj.text, obj.size, obj.widthMode, obj.widthMode === 'fixed' ? obj.width : null, measure);
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const latest = useRef({ doc, id, measure });
  latest.current = { doc, id, measure };
  const remeasureAfterLocalChange = useCallback(() => {
    const { doc: d, id: i, measure: m } = latest.current;
    remeasureText(d, i, m);
  }, []);
  return { remeasureAfterLocalChange };
}
