/**
 * Story 9: local box sync.
 *
 * `syncTextBox` re-measures the text object's content at its current size
 * and width mode and writes width/height — but ONLY when the result
 * differs from the stored box (no no-op writes, TC-13).
 *
 * It is called only from local changes — typing, size changes, fixed-width
 * handle drags (PRD text.height / text.auto_width / text.fixed_width).
 * Remote updates are rendered with the stored box and never re-measured,
 * so N clients never write N boxes for the same remote change (design
 * key decision 1).
 */
import { useCallback } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, type TextSize } from '@shared/config';
import { setTextBox } from '@shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/** Re-measure and write the box if it changed. Pure-doc, no React. */
export function syncTextBox(doc: Y.Doc, id: string, measure: Measurer): void {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'text') return;
  const ytext = obj.get('text');
  if (!(ytext instanceof Y.Text)) return;
  const size = obj.get('size');
  if (typeof size !== 'string' || !(size in TEXT_SIZES)) return;
  const mode: 'auto' | 'fixed' = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const fixedWidth = mode === 'fixed' ? (obj.get('width') as number) : null;

  const box = layoutText(ytext.toString(), size as TextSize, mode, fixedWidth, measure);

  const storedW = obj.get('width') as number;
  const storedH = obj.get('height') as number;
  if (storedW === box.width && storedH === box.height) return;

  setTextBox(doc, id, box);
}

/**
 * Per-object hook used by TextObject: exposes `remeasureAfterLocalChange`,
 * which TextObject calls after local typing, toolbar size changes, and
 * (via Board) fixed-width handle drags.
 */
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
