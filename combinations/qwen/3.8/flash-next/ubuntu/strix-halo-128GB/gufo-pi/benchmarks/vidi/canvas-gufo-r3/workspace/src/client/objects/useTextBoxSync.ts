import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { setTextBox, getTextContent } from '@shared/objects/text';
import { layoutText, Measurer } from './textLayout';
import { TEXT_SIZES, TEXT_MAX_AUTO_WIDTH_WORLD } from '@shared/config';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange(): void;
}

/**
 * Recomputes and writes the text object's width/height after local changes only.
 * Remote updates never trigger writes (Key decision 1).
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): UseTextBoxSyncResult {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const d = docRef.current;
    const objId = idRef.current;
    const m = d.getMap('objects').get(objId);
    if (!m || !(m instanceof Y.Map) || m.get('type') !== 'text') return;

    const size = m.get('size') as keyof typeof TEXT_SIZES;
    const widthMode = m.get('widthMode') as 'auto' | 'fixed';
    const storedWidth = m.get('width') as number;

    const yt = m.get('text');
    if (!(yt instanceof Y.Text)) return;
    const text = yt.toString();

    const result = layoutText(
      text,
      size,
      widthMode,
      widthMode === 'fixed' ? storedWidth : null,
      measureRef.current,
    );

    setTextBox(d, objId, { width: result.width, height: result.height });
  }, []);

  return { remeasureAfterLocalChange };
}
