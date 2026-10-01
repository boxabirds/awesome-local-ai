import * as Y from 'yjs';
import { useCallback, useRef } from 'react';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import { setTextBox, getTextContent } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Hook that measures text dimensions and writes them to the document after local changes.
 *
 * Only invoked after LOCAL changes (typing, size changes, fixed-width drags).
 * Remote updates never trigger writes — this avoids five clients racing to re-measure.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
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

    const objectsMap = d.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objectsMap.get(objId);
    if (!map || map.get('type') !== 'text') return;

    const ytext = getTextContent(d, objId);
    if (!ytext) return;

    const text = ytext.toString();
    const sizeRaw = map.get('size');
    const size: TextSize = typeof sizeRaw === 'string' && sizeRaw in TEXT_SIZES ? sizeRaw as TextSize : 'M';
    const widthModeRaw = map.get('widthMode');
    const widthMode: 'auto' | 'fixed' = widthModeRaw === 'fixed' ? 'fixed' : 'auto';
    const fixedWidth = widthMode === 'fixed' ? (typeof map.get('width') === 'number' ? map.get('width') as number : TEXT_MAX_AUTO_WIDTH_WORLD) : null;

    const result = layoutText(text, size, widthMode, fixedWidth, m);

    // Only write if the box actually changed
    const currentWidth = typeof map.get('width') === 'number' ? map.get('width') as number : 0;
    const currentHeight = typeof map.get('height') === 'number' ? map.get('height') as number : 0;

    // For auto mode, keep at least current fixed width when in fixed mode
    const newWidth = widthMode === 'fixed' ? fixedWidth! : Math.round(result.width);
    const newHeight = Math.round(result.height);

    // Don't shrink auto width below existing width when text is empty (object shouldn't vanish)
    if (text.length === 0 && widthMode === 'auto') return;

    if (newWidth !== currentWidth || newHeight !== currentHeight) {
      setTextBox(d, objId, { width: newWidth, height: newHeight });
    }
  }, []);

  return { remeasureAfterLocalChange };
}
