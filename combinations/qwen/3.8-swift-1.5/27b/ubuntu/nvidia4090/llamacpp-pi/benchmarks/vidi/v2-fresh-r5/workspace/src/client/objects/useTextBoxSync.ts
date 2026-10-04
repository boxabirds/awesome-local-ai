/**
 * useTextBoxSync (story 9): writes measured width/height after local text or
 * size changes. Remote updates never trigger writes (Key decision 1).
 */
import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';
import { type TextSize } from '../../shared/config';

interface UseTextBoxSyncOpts {
  doc: Y.Doc;
  id: string;
  measure: Measurer;
}

/**
 * Hook that provides `remeasureAfterLocalChange()` which computes the text
 * box dimensions and writes them via `setTextBox` only when the computed box
 * differs from the stored box. Called only by local typing, size changes and
 * fixed-width drags — never on remote updates.
 */
export function useTextBoxSync(opts: UseTextBoxSyncOpts): {
  remeasureAfterLocalChange(): void;
} {
  const { doc, id, measure } = opts;

  // Use a ref to avoid stale closures
  const idRef = useRef(id);
  idRef.current = id;

  const remeasureAfterLocalChange = useCallback((): void => {
    const objId = idRef.current;
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(objId);
    if (!obj) return;

    const ytext = obj.get('text') as Y.Text | undefined;
    if (!ytext) return;

    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;

    const text = ytext.toString();
    const fixedWidth = widthMode === 'fixed' && storedWidth ? storedWidth : null;

    const { width, height } = layoutText(text, size, widthMode, fixedWidth, measure);

    // Only write if the box changed
    const currentWidth = obj.get('width') as number;
    const currentHeight = obj.get('height') as number;
    if (currentWidth !== width || currentHeight !== height) {
      setTextBox(doc, objId, { width, height });
    }
  }, [doc, measure]);

  return { remeasureAfterLocalChange };
}
