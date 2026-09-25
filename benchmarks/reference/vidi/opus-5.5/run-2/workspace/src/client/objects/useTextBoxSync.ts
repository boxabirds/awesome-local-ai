/**
 * Writes a text object's measured box after *local* changes only (anchor: text.layout,
 * design key decision 1). Typing, size changes and side-handle drags call
 * `remeasureAfterLocalChange`; remote updates never do, so several clients never race to
 * write dimensions for the same change. The write happens straight after the local change,
 * inside the same undo capture window, so one undo reverts text and box together.
 */
import { useCallback } from 'react';
import type * as Y from 'yjs';
import { getTextContent, isTextSize, setTextBox } from '../../shared/objects/text';
import { DEFAULT_TEXT_SIZE } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

/** Stored sizes keep two decimals: sub-pixel noise never causes a write. */
const BOX_PRECISION = 100;

function round(v: number): number {
  return Math.round(v * BOX_PRECISION) / BOX_PRECISION;
}

/** Measures text object `id` and stores its box when it differs. True when it wrote. */
export function syncTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  const ytext = getTextContent(doc, id);
  if (obj === undefined || ytext === undefined) return false;
  const size = obj.get('size');
  const mode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const stored = obj.get('width');
  const box = layoutText(
    ytext.toString(),
    isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    mode,
    typeof stored === 'number' ? stored : null,
    measure,
  );
  return setTextBox(doc, id, { width: round(box.width), height: round(box.height) });
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(() => {
    syncTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}
