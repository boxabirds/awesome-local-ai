import { useCallback } from 'react';
import * as Y from 'yjs';
import { setTextBox } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

/**
 * Measures a text object's box after a LOCAL change and writes the result
 * back to the Y.Doc (text.sync, key decision 1).
 *
 * Remote changes never trigger a write: this hook exposes
 * `remeasureAfterLocalChange` and only the client that made the change
 * (typing, size change, fixed-width drag) calls it, so five clients never
 * re-measure the same change (TC-12).
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): {
  remeasureAfterLocalChange(): void;
} {
  const remeasureAfterLocalChange = useCallback(() => {
    const obj = doc.getMap('objects').get(id);
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return;

    const ytext = obj.get('text');
    if (!(ytext instanceof Y.Text)) return;

    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
    const width = obj.get('width');
    const fixedWidth = widthMode === 'fixed' && typeof width === 'number' ? width : null;

    const { width: nextWidth, height: nextHeight } = layoutText(
      ytext.toString(),
      size,
      widthMode,
      fixedWidth,
      measure,
    );

    // No write when the box is unchanged (TC-13)
    if (obj.get('width') === nextWidth && obj.get('height') === nextHeight) return;

    setTextBox(doc, id, { width: nextWidth, height: nextHeight });
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
