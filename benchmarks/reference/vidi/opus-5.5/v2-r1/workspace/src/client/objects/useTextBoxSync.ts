// Writes a text object's measured box (story 9). Only the client that made a local change
// (typing, size change, side-handle drag) measures and writes; remote changes never trigger a
// write, so several clients never race to store the same dimensions.
import { useCallback } from 'react';
import * as Y from 'yjs';
import { DEFAULT_TEXT_SIZE } from '../../shared/config';
import { isTextSize, setTextBox } from '../../shared/objects/text';
import { type Measurer, layoutText } from './textLayout';

/** Re-measures text object `id` and stores its box if it changed. True when a write happened. */
export function syncTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = doc.getMap('objects').get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  const text = obj.get('text');
  const size = obj.get('size');
  const fixed = obj.get('widthMode') === 'fixed';
  const width = obj.get('width');
  const box = layoutText(
    text instanceof Y.Text ? text.toString() : '',
    isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    fixed ? 'fixed' : 'auto',
    fixed && typeof width === 'number' ? width : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(() => {
    syncTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
