import { useCallback, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '@shared/config';
import type { TextSize } from '@shared/config';
import { getDocObjects } from '@shared/objects/text';
import type { Measurer } from './textLayout';
import { layoutText } from './textLayout';
import { setTextBox } from '@shared/objects/text';

interface UseOptions {
  /** Called when a local change requires re-measurement. */
  onChange?(): void;
}

/**
 * Hook that watches for local text changes and writes measured width/height
 * to the document via setTextBox. Only triggers on local-origin transactions,
 * so remote clients never write dimensions (avoiding write storms).
 * 
 * Call `remeasureAfterLocalChange()` after any local typing, size change, or
 * fixed-width drag to recompute box and write if changed.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer, opts?: UseOptions) {
  const lastWidthRef = useRef<number | null>(null);
  const lastHeightRef = useRef<number | null>(null);
  const lastContentRef = useRef<string>('');
  const lastSizeRef = useRef<TextSize>(DEFAULT_TEXT_SIZE);
  const lastModeRef = useRef<'auto' | 'fixed'>('auto');
  const lastFixedWidthRef = useRef<number | null>(null);

  const remeasureAfterLocalChange = useCallback(() => {
    // Get current state from doc
    const objects = getDocObjects(doc);
    const dm = objects.get(id);
    if (!dm || !(dm instanceof Y.Map)) return false;

    const ytextVal = dm.get('text');
    if (!(ytextVal instanceof Y.Text)) return false;

    const textStr = ytextVal.toString();
    const size = String(dm.get('size') ?? DEFAULT_TEXT_SIZE) as TextSize;
    const widthMode = String(dm.get('widthMode') ?? 'auto') as 'auto' | 'fixed';
    const storedWidth = dm.has('width') ? Number(dm.get('width')) : null;
    const fixedWidth = widthMode === 'fixed' && storedWidth !== null ? storedWidth : null;

    // Skip if nothing actually changed since last measurement
    if (
      textStr === lastContentRef.current &&
      size === lastSizeRef.current &&
      widthMode === lastModeRef.current &&
      fixedWidth === lastFixedWidthRef.current
    ) {
      return false;
    }

    // Compute new box
    const result = layoutText(textStr, size, widthMode, fixedWidth, measure);

    const newWidth = Math.ceil(result.width);
    const newHeight = Math.ceil(result.height);

    // Only write if box actually differs
    if (newWidth === lastWidthRef.current && newHeight === lastHeightRef.current) {
      // Update internal refs without writing
      lastContentRef.current = textStr;
      lastSizeRef.current = size;
      lastModeRef.current = widthMode;
      lastFixedWidthRef.current = fixedWidth;
      return false;
    }

    const wrote = setTextBox(doc, id, { width: newWidth, height: newHeight });

    // Update internal tracking state
    lastWidthRef.current = newWidth;
    lastHeightRef.current = newHeight;
    lastContentRef.current = textStr;
    lastSizeRef.current = size;
    lastModeRef.current = widthMode;
    lastFixedWidthRef.current = fixedWidth;

    opts?.onChange?.();
    return wrote;
  }, [doc, id, measure, opts]);

  // Initialize tracking state from current doc values
  useEffect(() => {
    const objects = getDocObjects(doc);
    const dm = objects.get(id);
    if (!dm || !(dm instanceof Y.Map)) return;

    const ytextVal = dm.get('text');
    if (ytextVal instanceof Y.Text) {
      lastContentRef.current = ytextVal.toString();
    }
    const size = String(dm.get('size') ?? DEFAULT_TEXT_SIZE) as TextSize;
    lastSizeRef.current = size;
    const widthMode = String(dm.get('widthMode') ?? 'auto') as 'auto' | 'fixed';
    lastModeRef.current = widthMode;
    const storedWidth = dm.has('width') ? Number(dm.get('width')) : null;
    lastFixedWidthRef.current = widthMode === 'fixed' && storedWidth !== null ? storedWidth : null;
    if (dm.has('width') && dm.has('height')) {
      lastWidthRef.current = Number(dm.get('width'));
      lastHeightRef.current = Number(dm.get('height'));
    }
  }, [doc, id]);

  return { remeasureAfterLocalChange };
}
