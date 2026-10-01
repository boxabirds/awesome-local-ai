import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { setTextBox } from '../../shared/objects/text';
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, type TextSize } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures a text object and writes its box when it differs from the stored one.
 * Only called after a local change (typing, size, width drag): remote clients never write dimensions.
 */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return false;
  const content = obj.get('text');
  const sizeKey = obj.get('size') as string;
  const size: TextSize = Object.prototype.hasOwnProperty.call(TEXT_SIZES, sizeKey) ? (sizeKey as TextSize) : DEFAULT_TEXT_SIZE;
  const fixed = obj.get('widthMode') === 'fixed';
  const width = obj.get('width');
  const box = layoutText(
    content instanceof Y.Text ? content.toString() : '',
    size,
    fixed ? 'fixed' : 'auto',
    fixed && typeof width === 'number' ? width : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const ref = useRef({ doc, id, measure });
  ref.current = { doc, id, measure };
  const remeasureAfterLocalChange = useCallback(() => {
    const { doc: d, id: i, measure: m } = ref.current;
    remeasureText(d, i, m);
  }, []);
  return { remeasureAfterLocalChange };
}
