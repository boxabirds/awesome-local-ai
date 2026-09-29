// Local-only box sync for text objects (see spec: text.layout, key decision 1).
//
// The client that made a LOCAL change (typing, size change, fixed-width drag)
// measures the box and writes width/height in the same capture window, so
// undo reverts text and box together. Remote clients render the stored box
// and never write dimensions: `remeasureAfterLocalChange` is only ever
// invoked after local changes, so five simultaneous editors never race to
// re-measure the same change (TC-12: remote change → zero writes).

import { useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import { setTextBox } from '../../shared/objects/text';
import { createCanvasMeasurer, layoutText, type Measurer } from './textLayout';

export function useTextBoxSync(doc: Y.Doc, id: string, measure?: Measurer): { remeasureAfterLocalChange(): void } {
  const measurer = useMemo(() => (measure !== undefined ? measure : createCanvasMeasurer()), [measure]);

  const remeasureAfterLocalChange = useCallback(() => {
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const object = objects.get(id);
    if (object === undefined) return;
    if (object.get('type') !== 'text') return;
    const text = object.get('text');
    if (!(text instanceof Y.Text)) return;
    const size = object.get('size');
    if (typeof size !== 'string' || !(size in TEXT_SIZES)) return;
    const widthMode = object.get('widthMode');
    if (widthMode !== 'auto' && widthMode !== 'fixed') return;
    const width = object.get('width');
    const layout = layoutText(
      text.toString(),
      size as TextSize,
      widthMode,
      widthMode === 'fixed' && typeof width === 'number' && Number.isFinite(width) ? width : null,
      measurer,
    );
    // setTextBox is a no-op (no transaction) when the box is unchanged, so a
    // redundant remeasure never writes (TC-13).
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }, [doc, id, measurer]);

  return { remeasureAfterLocalChange };
}
