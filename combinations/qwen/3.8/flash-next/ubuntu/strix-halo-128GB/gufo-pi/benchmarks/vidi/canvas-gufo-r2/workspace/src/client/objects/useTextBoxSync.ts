/**
 * useTextBoxSync: writes measured width/height after local text or size changes.
 *
 * Key decision: only the client that made the local change measures and writes
 * width/height. Remote clients render using the stored box and never write
 * dimensions, avoiding write storms from multiple clients re-measuring the same change.
 */
import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';
import type { TextSize } from '../../shared/config';

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback(() => {
    const d = docRef.current;
    const objId = idRef.current;
    const objects = d.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(objId);
    if (!obj || obj.get('type') !== 'text') return;

    const ytext = obj.get('text') as Y.Text | undefined;
    if (!ytext) return;

    const size = obj.get('size') as TextSize;
    const widthMode = obj.get('widthMode') as 'auto' | 'fixed';
    const storedWidth = obj.get('width') as number;

    const fixedWidth = widthMode === 'fixed' ? storedWidth : null;
    const result = layoutText(ytext.toString(), size, widthMode, fixedWidth, measureRef.current);

    // Only write if the box actually changed
    if (result.width !== storedWidth || result.height !== (obj.get('height') as number)) {
      setTextBox(d, objId, { width: result.width, height: result.height });
    }
  }, []);

  return { remeasureAfterLocalChange };
}
