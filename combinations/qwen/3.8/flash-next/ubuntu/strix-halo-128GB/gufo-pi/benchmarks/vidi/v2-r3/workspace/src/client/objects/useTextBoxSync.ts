/**
 * useTextBoxSync (story 9): writes measured width/height after local text or size changes.
 * Remote updates never trigger writes (Key decision 1).
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { getObjectsMap } from '../../shared/board-model';
import { setTextBox, getTextContent } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';
import type { TextSize } from '../../shared/config';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange(): void;
}

/**
 * Computes the text box dimensions and writes them via setTextBox only when
 * they differ from the stored values. Only called after local changes (typing,
 * size change, fixed-width drag) — never on remote updates.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): UseTextBoxSyncResult {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const objects = getObjectsMap(doc);
    const m = objects.get(id);
    if (!m || m.get('type') !== 'text') return;

    const size = m.get('size') as TextSize;
    const widthMode = m.get('widthMode') as 'auto' | 'fixed';
    const storedWidth = m.get('width') as number;

    const ytext = getTextContent(doc, id);
    if (!ytext) return;

    const text = ytext.toString();
    const fixedWidth = widthMode === 'fixed' ? storedWidth : null;
    const result = layoutText(text, size, widthMode, fixedWidth, measureRef.current);

    setTextBox(doc, id, { width: result.width, height: result.height });
  }, [doc, id]);

  return { remeasureAfterLocalChange };
}
