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
 * Compute the box of a text object from its current content, size and width
 * mode, and write it via `setTextBox` only if it differs from the stored one.
 * Exported so the resize gesture can re-measure height after a width drag.
 */
export function remeasureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): void {
  const objects = doc.getMap('objects');
  const entry = objects.get(id);
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

  const layout = layoutText(text, textSize, mode, fixedW, measure);

  if (layout.width !== storedWidth || layout.height !== storedHeight) {
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }
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
    remeasureTextBox(docRef.current, idRef.current, measureRef.current);
  }, []);

  return { remeasureAfterLocalChange };
}
