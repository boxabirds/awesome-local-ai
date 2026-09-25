import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { readText, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures a text object as it is now and stores its box if that changed. Only for changes made on this client
 * (typing, size change, width drag): remote clients render the stored box and never write it (text.layout).
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const t = readText(doc, id);
  if (!t) return false;
  const { width, height } = layoutText(t.text, t.size, t.widthMode, t.widthMode === 'fixed' ? t.width : null, measure);
  return setTextBox(doc, id, { width, height });
}

/**
 * Box sync for one text object. Nothing is observed: `remeasureAfterLocalChange` is called by the editor's input,
 * the size buttons and the width handle, right after their own change, so the box write lands in the same undo
 * step as the change it follows.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const latest = useRef({ doc, id, measure });
  latest.current = { doc, id, measure };
  const remeasureAfterLocalChange = useCallback(() => {
    const { doc: d, id: i, measure: m } = latest.current;
    remeasureText(d, i, m);
  }, []);
  return { remeasureAfterLocalChange };
}
