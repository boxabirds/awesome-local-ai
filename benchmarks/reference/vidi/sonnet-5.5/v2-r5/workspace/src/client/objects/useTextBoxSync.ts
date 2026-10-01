import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { readText, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/** Measures one text object and stores its box; a no-op when the stored box is already right. */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): void {
  const state = readText(doc, id);
  if (!state) return;
  const { width, height } = layoutText(state.text, state.size, state.widthMode, state.width, measure);
  setTextBox(doc, id, { width, height });
}

/**
 * Only called after local typing, size changes and width drags, never for remote updates,
 * so several clients never race to write the same dimensions.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const ref = useRef({ doc, id, measure });
  ref.current = { doc, id, measure };
  const remeasureAfterLocalChange = useCallback(() => {
    const { doc: d, id: i, measure: m } = ref.current;
    remeasureText(d, i, m);
  }, []);
  return { remeasureAfterLocalChange };
}
