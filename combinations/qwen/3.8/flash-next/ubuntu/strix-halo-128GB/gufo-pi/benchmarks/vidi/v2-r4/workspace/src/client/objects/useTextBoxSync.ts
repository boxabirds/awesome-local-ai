/**
 * useTextBoxSync: writes measured width/height after local text or size changes.
 *
 * Key decision 1: the client that made the local change measures and writes
 * width/height in the same capture window. Remote clients never write dimensions.
 */
import { useCallback } from 'react';
import type * as Y from 'yjs';
import { getTextObj } from './useTextBoxSyncHelpers';
import { setTextBox, getTextContent } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';
import type { TextSize } from '../../shared/config';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange(): void;
}

/**
 * Provides a `remeasureAfterLocalChange()` function that computes the box for
 * the text object and writes it via `setTextBox` only if it differs from the
 * stored box. This is called ONLY after local changes (typing, size change,
 * fixed-width drag) — never on remote updates.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): UseTextBoxSyncResult {
  const remeasureAfterLocalChange = useCallback(() => {
    const obj = getTextObj(doc, id);
    if (!obj) return;

    const ytext = getTextContent(doc, id);
    if (!ytext) return;

    const text = ytext.toString();
    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;
    const storedHeight = obj.get('height') as number | undefined;

    const fixedWidth = widthMode === 'fixed' ? (storedWidth ?? null) : null;
    const result = layoutText(text, size, widthMode, fixedWidth, measure);

    // Only write when the box actually differs
    if (result.width !== storedWidth || result.height !== storedHeight) {
      setTextBox(doc, id, { width: result.width, height: result.height });
    }
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
