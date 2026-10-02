import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { layoutText, type Measurer } from './textLayout';
import { setTextBox } from '../../shared/objects/text';
import { objectMap } from '../../shared/board-model';
import type { TextSize } from '../../shared/config';

/**
 * Story 9 (text.layout): writes measured width/height to the text object
 * after a LOCAL change (typing, size change, fixed-width drag).
 *
 * Key rule: `remeasureAfterLocalChange()` is the ONLY entry point that writes
 * dimensions. Remote updates never trigger writes, so five clients never race
 * to write dimensions for the same change.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer) {
  const idRef = useRef(id);
  idRef.current = id;

  const remeasureAfterLocalChange = useCallback((): void => {
    const m = objectMap(doc, idRef.current);
    if (!m) return;

    const textType = m.get('text');
    if (!(textType instanceof Y.Text)) return;

    const size = (m.get('size') ?? 'M') as TextSize;
    const widthMode = (m.get('widthMode') ?? 'auto') as 'auto' | 'fixed';
    const storedWidth = m.get('width');
    const fixedWidth = widthMode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null;

    const text = textType.toString();
    const { width, height } = layoutText(text, size, widthMode, fixedWidth, measure);

    // Only write if the box actually changed (avoid redundant transactions).
    const oldW = m.get('width');
    const oldH = m.get('height');
    if (oldW === width && oldH === height) return;

    setTextBox(doc, idRef.current, { width, height });
  }, [doc, measure]);

  return { remeasureAfterLocalChange };
}
