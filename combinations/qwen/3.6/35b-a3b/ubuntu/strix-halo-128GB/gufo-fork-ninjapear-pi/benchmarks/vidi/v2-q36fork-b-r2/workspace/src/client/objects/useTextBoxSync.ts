import * as React from 'react';
import { setTextBox } from '../../shared/objects/text';
import type { Measurer } from './textLayout';
import { layoutText } from './textLayout';
import type { TextSize } from '../../shared/config';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../../shared/config';
import type { Doc } from 'yjs';

/**
 * Hook that writes measured width/height after local text or size changes.
 * Only triggers on local-origin updates — remote clients never write dimensions.
 */
export function useTextBoxSync(
  doc: Doc | undefined,
  id: string | null,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const measureRef = React.useRef(measure);
  measureRef.current = measure;

  // Track last known box to avoid redundant writes
  const lastBoxRef = React.useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const remeasureAfterLocalChange = React.useCallback(() => {
    if (!doc || !id) return;

    // Get the Y.Text content for this object
    const objectsMap = doc.getMap('objects');
    const ytextResult = objectsMap.get(id);
    if (!ytextResult) return;

    // Read current properties from the map
    const textMap = ytextResult as any;
    const yText = textMap.get('text');
    const size = textMap.get('size') as TextSize | undefined || DEFAULT_TEXT_SIZE;
    const widthMode = textMap.get('widthMode') as 'auto' | 'fixed' || 'auto';
    const storedWidth = textMap.get('width') as number;
    const storedHeight = textMap.get('height') as number;

    // Compute text content
    const textContent = yText ? yText.toString() : '';

    // Layout with fixed width if mode is fixed
    const fixedW = widthMode === 'fixed' ? storedWidth : null;
    const result = layoutText(textContent, size, widthMode, fixedW, measureRef.current);

    // Check if box changed
    if (result.width === storedWidth && result.height === storedHeight) {
      return; // no-op
    }

    // Write new box in a LOCAL_ORIGIN transaction
    try {
      setTextBox(doc, id, { width: result.width, height: result.height });
      lastBoxRef.current = { width: result.width, height: result.height };
    } catch {
      // Ignore errors from missing doc/map etc.
    }
  }, [doc, id]);

  return { remeasureAfterLocalChange };
}
