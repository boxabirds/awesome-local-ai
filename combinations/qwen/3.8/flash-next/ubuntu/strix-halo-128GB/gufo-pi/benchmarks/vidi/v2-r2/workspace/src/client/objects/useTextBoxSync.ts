import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { type TextSize } from '@shared/config';
import { setTextBox } from '@shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange(): void;
}

/**
 * Hook that computes and writes the text object's width/height after a local
 * change (typing, size change, fixed-width drag). Never writes on remote updates.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): UseTextBoxSyncResult {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const d = docRef.current;
    const objId = idRef.current;
    const objects = d.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(objId);
    if (!obj || obj.get('type') !== 'text') return;

    const ytext = obj.get('text') as Y.Text;
    const text = ytext.toString();
    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const storedWidth = obj.get('width') as number;

    const fixedWidth = widthMode === 'fixed' ? storedWidth : null;
    const layout = layoutText(text, size, widthMode, fixedWidth, measureRef.current);

    // Only write if the box actually changed
    const currentWidth = obj.get('width') as number;
    const currentHeight = obj.get('height') as number;
    if (layout.width !== currentWidth || layout.height !== currentHeight) {
      setTextBox(d, objId, { width: layout.width, height: layout.height });
    }
  }, []);

  return { remeasureAfterLocalChange };
}
