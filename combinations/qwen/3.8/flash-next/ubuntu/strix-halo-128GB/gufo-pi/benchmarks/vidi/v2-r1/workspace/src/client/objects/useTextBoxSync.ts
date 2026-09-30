/**
 * useTextBoxSync: a hook that writes measured width/height to the document
 * after local changes (typing, size changes, fixed-width drags).
 *
 * Remote changes NEVER trigger a write — five clients never race to write
 * dimensions. Only the client that made the local change measures and writes.
 */

import * as Y from 'yjs';
import { useCallback, useRef } from 'react';

import { setTextBox } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import type { Measurer } from './textLayout';
import { layoutText } from './textLayout';

export interface UseTextBoxSyncResult {
  /** Call after a local text change or size change to remeasure and write box. */
  remeasureAfterLocalChange(): void;
}

/**
 * Returns `remeasureAfterLocalChange()` which computes the box from the
 * current text content, size and widthMode, and writes it via `setTextBox`
 * only if the computed box differs from the stored one.
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

  const remeasureAfterLocalChange = useCallback((): void => {
    const d = docRef.current;
    const objId = idRef.current;
    const m = measureRef.current;

    // Read the current state from the document
    const objects = d.getMap('objects');
    const entry = objects.get(objId);
    if (!(entry instanceof Y.Map)) return;

    const type = entry.get('type');
    if (type !== 'text') return;

    const sizeKey = entry.get('size');
    const widthMode = entry.get('widthMode');
    const storedWidth = entry.get('width');
    const storedHeight = entry.get('height');
    const ytext = entry.get('text');

    if (!(ytext instanceof Y.Text)) return;

    const text = ytext.toString();
    const textSize = (sizeKey ?? 'M') as TextSize;
    const mode = widthMode === 'fixed' ? 'fixed' : 'auto';
    const fixedW = mode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null;

    const layout = layoutText(text, textSize, mode, fixedW, m);

    // Only write if the box actually changed
    if (layout.width !== storedWidth || layout.height !== storedHeight) {
      setTextBox(d, objId, { width: layout.width, height: layout.height });
    }
  }, []);

  return { remeasureAfterLocalChange };
}
