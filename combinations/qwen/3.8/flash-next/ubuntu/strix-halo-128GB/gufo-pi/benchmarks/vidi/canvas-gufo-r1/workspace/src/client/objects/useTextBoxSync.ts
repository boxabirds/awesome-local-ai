import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';
import type { TextSize } from '../../shared/config';

/**
 * Hook that remeasures a text object after local changes and writes the new box.
 * Only writes when the computed box differs from the stored box.
 * Never triggers writes on remote changes (key decision 1 from the design).
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const objects = docRef.current.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(idRef.current);
    if (!obj || obj.get('type') !== 'text') return;

    const ytext = obj.get('text') as Y.Text;
    const size = obj.get('size') as TextSize;
    const widthMode = obj.get('widthMode') as 'auto' | 'fixed';
    const storedWidth = obj.get('width') as number;

    const fixedWidth = widthMode === 'fixed' ? storedWidth : null;
    const text = ytext.toString();

    const { width, height } = layoutText(text, size, widthMode, fixedWidth, measureRef.current);

    setTextBox(docRef.current, idRef.current, { width, height });
  }, []);

  return { remeasureAfterLocalChange };
}
