/**
 * useTextBoxSync: writes measured width/height after local text or size changes.
 *
 * Remote clients never call this hook's remeasure method — only the client that
 * made the local change measures and writes dimensions.
 */
import { useCallback } from 'react';
import type * as Y from 'yjs';
import { getTextContent, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSyncApi {
  /** Compute the box from current text/size and write it if it differs. */
  remeasureAfterLocalChange(): void;
}

/**
 * Hook that provides `remeasureAfterLocalChange`.
 *
 * @param doc - The board document.
 * @param id - The text object's id.
 * @param measure - Text measurement function.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): TextBoxSyncApi {
  const remeasureAfterLocalChange = useCallback(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id);
    if (!obj) return;
    const ytext = getTextContent(doc, id);
    if (!ytext) return;

    const size = obj.get('size') as 'S' | 'M' | 'L' | 'XL';
    const widthMode = obj.get('widthMode') as 'auto' | 'fixed';
    const storedWidth = obj.get('width') as number;

    const result = layoutText(
      ytext.toString(),
      size,
      widthMode,
      widthMode === 'fixed' ? storedWidth : null,
      measure,
    );

    setTextBox(doc, id, { width: result.width, height: result.height });
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
