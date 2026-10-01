// src/client/objects/useTextBoxSync.ts
// Writes measured width/height after local text or size changes.
// Remote updates never trigger writes (key decision 1).

import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { layoutText, type Measurer } from './textLayout';
import { setTextBox } from '../../shared/objects/text';
import { type TextSize } from '../../shared/config';

export interface UseTextBoxSyncResult {
  remeasureAfterLocalChange: () => void;
}

/**
 * Hook that measures text layout and writes the box to the doc
 * only after local changes (typing, size change, fixed-width drag).
 * Remote updates never trigger writes, avoiding write storms.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): UseTextBoxSyncResult {
  const lastBoxRef = useRef<{ width: number; height: number } | null>(null);

  const remeasureAfterLocalChange = useCallback(() => {
    // Get the object from the doc
    const objects = doc.getMap('objects');
    const obj = objects.get(id) as Y.Map<unknown> | undefined;
    if (!obj || obj.get('type') !== 'text') return;

    const ytext = obj.get('text') as Y.Text | undefined;
    if (!ytext) return;

    const text = ytext.toString();
    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;

    const fixedWidth = widthMode === 'fixed' ? (storedWidth ?? null) : null;
    const layout = layoutText(text, size, widthMode, fixedWidth, measure);

    // Only write if the box actually changed
    const lastBox = lastBoxRef.current;
    if (lastBox && lastBox.width === layout.width && lastBox.height === layout.height) {
      return; // No change, skip write
    }

    lastBoxRef.current = { width: layout.width, height: layout.height };
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
