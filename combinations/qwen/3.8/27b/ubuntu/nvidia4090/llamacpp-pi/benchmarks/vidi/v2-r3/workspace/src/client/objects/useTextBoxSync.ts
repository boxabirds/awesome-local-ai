/**
 * Story 9 (text.object): local-only text box sync.
 *
 * The text box (width/height) is measured by the client that made the local
 * change (typing, size change, side-handle drag) and written with
 * setTextBox in the same capture window. Remote changes are NOT
 * re-measured: the author's measure wins and only the author re-measures, so
 * an idle editor does not rewrite the box and undo stays deterministic.
 */
import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { DEFAULT_TEXT_SIZE, type TextSize } from '../../shared/config';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Re-measure the text object's content at its current size and width mode
 * and write the box via setTextBox. Returns whether a box write happened.
 * Reads the current doc state, so it is safe to call after a local
 * setTextSize / setTextWidthFixed in the same capture window.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const item = doc.getMap('objects').get(id);
  if (!(item instanceof Y.Map) || item.get('type') !== 'text') return false;
  const ytext = item.get('text') as Y.Text | undefined;
  const size = (item.get('size') as TextSize | undefined) ?? DEFAULT_TEXT_SIZE;
  const widthMode = (item.get('widthMode') as 'auto' | 'fixed' | undefined) ?? 'auto';
  const storedWidth = item.get('width');
  const m = layoutText(
    ytext instanceof Y.Text ? ytext.toString() : '',
    size,
    widthMode,
    widthMode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null,
    measure,
  );
  return setTextBox(doc, id, m);
}

/**
 * React hook for text object components: exposes remeasureAfterLocalChange,
 * to be called after a LOCAL text/size/width change. The measure function is
 * kept in a ref so the callback stays stable across renders.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const measureRef = useRef<Measurer>(measure);
  measureRef.current = measure;
  const remeasureAfterLocalChange = useCallback(
    () => {
      remeasureTextBox(doc, id, measureRef.current);
    },
    [doc, id],
  );
  return { remeasureAfterLocalChange };
}
