import { useEffect, useRef, useCallback, useState } from 'react';
import * as Y from 'yjs';
import { setTextBox, getTextContent } from '@/shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Hook that writes measured width/height to the document after local text or size changes.
 * Remote updates never trigger writes — only local origin does.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const lastBoxRef = useRef<{ width: number; height: number } | null>(null);
  const [tick, setTick] = useState(0);

  const remeasureAfterLocalChange = useCallback(() => {
    // Trigger a re-render so the effect can process pending measurement
    setTick((t) => t + 1);
  }, []);

  // Process pending measurements on each render
  useEffect(() => {
    const objectsMap = doc.getMap('objects') as Y.Map<any>;
    const rawInner = objectsMap.get(id);
    if (!rawInner || typeof (rawInner as any).get !== 'function') return;
    const inner = rawInner as any;

    const textVal = getTextContent(doc, id);
    if (!textVal) return;

    const textStr = textVal.toString();
    const sizeKey = (inner.get('size') ?? 'M') as string;
    const widthMode = (inner.get('widthMode') ?? 'auto') as 'auto' | 'fixed';
    const storedWidth = Number(inner.get('width')) || 0;

    const fixedW = widthMode === 'fixed' ? storedWidth : null;

    const result = layoutText(textStr, sizeKey as any, widthMode, fixedW, measure);

    // Only write if box changed
    if (
      lastBoxRef.current &&
      lastBoxRef.current.width === result.width &&
      lastBoxRef.current.height === result.height
    ) {
      return;
    }

    lastBoxRef.current = { width: result.width, height: result.height };
    setTextBox(doc, id, result);
  }, [tick, doc, id, measure]);

  return { remeasureAfterLocalChange };
}
