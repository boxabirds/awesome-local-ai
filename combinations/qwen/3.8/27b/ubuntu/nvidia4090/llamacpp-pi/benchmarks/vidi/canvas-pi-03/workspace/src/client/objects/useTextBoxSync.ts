import { useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, type TextSize } from '@/shared/config';
import { setTextBox } from '@/shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Remeasures the stored box of a text object from its current content, size
 * and width mode (story 9, layout.*). Writes `setTextBox` only when the
 * computed box differs from the stored one. Returns true when it wrote.
 *
 * Called only after LOCAL changes (editor input, size change, width-handle
 * gesture); remote updates render the stored box without remeasuring
 * (Key decision 1), so this must never run on the remote update path.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'text') return false;
  const text = obj.get('text');
  if (!(text instanceof Y.Text)) return false;
  const rawSize = obj.get('size');
  const size: TextSize =
    typeof rawSize === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, rawSize)
      ? (rawSize as TextSize)
      : 'M';
  const mode: 'auto' | 'fixed' = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const storedWidth = obj.get('width');
  const fixedWidth = typeof storedWidth === 'number' && Number.isFinite(storedWidth) ? storedWidth : null;
  const layout = layoutText(text.toString(), size, mode, fixedWidth, measure);
  if (obj.get('width') === layout.width && obj.get('height') === layout.height) {
    return false; // box unchanged: no write (TC-13)
  }
  return setTextBox(doc, id, { width: layout.width, height: layout.height });
}

/**
 * Per-text-object box sync (story 9, text.layout). The owning TextObject
 * calls `remeasureAfterLocalChange()` after every local edit, size change or
 * width-handle commit; remote changes never call it.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const fn = useCallback(() => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return useMemo(() => ({ remeasureAfterLocalChange: fn }), [fn]);
}
