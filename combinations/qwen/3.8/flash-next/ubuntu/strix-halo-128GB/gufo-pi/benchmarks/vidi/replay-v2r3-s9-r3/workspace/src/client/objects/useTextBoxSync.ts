/**
 * useTextBoxSync: writes measured width/height to the document after local
 * text or size changes only. Remote clients never write dimensions.
 */
import { useRef } from 'react';
import * as Y from 'yjs';
import { getObjectsMap } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import { layoutText } from './textLayout';
import type { Measurer } from './textLayout';
import type { TextSize } from '../../shared/config';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange(): void;
}

/**
 * Computes and writes the box for a text object after a local change.
 * Never invoked on remote updates (Key decision 1: avoids write storms).
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): UseTextBoxSyncResult {
  const docRef = useRef(doc);
  const idRef = useRef(id);
  const measureRef = useRef(measure);
  docRef.current = doc;
  idRef.current = id;
  measureRef.current = measure;

  function remeasureAfterLocalChange(): void {
    const d = docRef.current;
    const objId = idRef.current;
    const m = getObjectsMap(d).get(objId);
    if (!m || m.get('type') !== 'text') return;

    const ytext = m.get('text');
    if (!(ytext instanceof Y.Text)) return;

    const size = (m.get('size') as TextSize) ?? 'M';
    const widthMode = (m.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const fixedWidth = widthMode === 'fixed' ? (m.get('width') as number) : null;
    const text = ytext.toString();

    const result = layoutText(text, size, widthMode, fixedWidth, measureRef.current);

    setTextBox(d, objId, { width: result.width, height: result.height });
  }

  return { remeasureAfterLocalChange };
}
