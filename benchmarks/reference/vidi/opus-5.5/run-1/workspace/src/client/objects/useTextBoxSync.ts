import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { hasObject, LOCAL_ORIGIN, moveObject } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { readTextLayoutInput, setTextBox, setTextWidthFixed } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures text object `id` as stored now and writes its width/height when they differ from the
 * stored box. Returns true when a write happened. Called only after this client's own changes
 * (typing, size change, side-handle drag): remote clients render the stored box and never
 * write dimensions (design key decision 1), so five people never race to re-measure.
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const input = readTextLayoutInput(doc, id);
  if (!input) return false;
  const { width, height } = layoutText(
    input.text,
    input.size,
    input.widthMode,
    input.widthMode === 'fixed' ? input.width : null,
    measure,
  );
  return setTextBox(doc, id, { width, height });
}

/**
 * A side-handle drag on a text object (text.fixed_width): moves it to `rect`'s top-left, fixes
 * its width at `rect.width` (at least TEXT_MIN_WIDTH_WORLD) and re-measures its height, all in
 * one transaction. The height in `rect` is ignored: it always follows the content.
 */
export function resizeTextWidth(doc: Y.Doc, id: string, rect: Rect, measure: Measurer): void {
  if (!hasObject(doc, id)) return;
  doc.transact(() => {
    moveObject(doc, id, rect.x, rect.y);
    setTextWidthFixed(doc, id, rect.width);
    remeasureText(doc, id, measure);
  }, LOCAL_ORIGIN);
}

/**
 * Keeps a text object's stored box in step with this client's local changes (text.layout).
 * `remeasureAfterLocalChange()` is called by the editor after local input, by the text toolbar
 * after a size change and by the fixed-width gesture; remote updates never call it.
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
