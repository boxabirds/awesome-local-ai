import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Re-measures a text object's box and writes it (via setTextBox) only when the
 * measured box differs from the saved one. Pure and synchronous: it reads the
 * current text/size/widthMode from the doc, lays the text out with `measure`,
 * and writes width/height if they changed. Called only after LOCAL changes
 * (typing, size change, fixed-width drag) — never in response to remote
 * updates, so remote peers' boxes are never overwritten (TC-12/TC-13).
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): void {
  const objMap = doc.getMap('objects');
  const obj = objMap.get(id) as Y.Map<unknown> | undefined;
  if (!obj || obj.get('type') !== 'text') return;

  const text = obj.get('text');
  if (!(text instanceof Y.Text)) return;

  const size = obj.get('size');
  if (typeof size !== 'string' || !(size in TEXT_SIZES)) return;

  const widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const fixedWidth = widthMode === 'fixed' ? (obj.get('width') as number) : null;

  const layout = layoutText(text.toString(), size as TextSize, widthMode, fixedWidth, measure);

  const curW = obj.get('width');
  const curH = obj.get('height');
  if (curW !== layout.width || curH !== layout.height) {
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }
}

/**
 * Local-only box sync (story 9). Returns `remeasureAfterLocalChange()`, which
 * the caller invokes after a local mutation (editor input, size change,
 * fixed-width drag). It does NOT subscribe to doc updates, so remote changes
 * never trigger a box write.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer) {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    remeasureTextBox(doc, id, measureRef.current);
  }, [doc, id]);

  return { remeasureAfterLocalChange };
}
