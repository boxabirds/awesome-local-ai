// Box sync (story 9): keeps a text object's stored width/height in step with
// its content, size and width mode.
//
// Key decision 1 (design): the box is written ONLY after a LOCAL change
// (transaction.origin === LOCAL_ORIGIN). Remote text updates are rendered
// from the Y.Text directly; the remote peer's own hook wrote its box.
// Writes are skipped when the computed box equals the stored box.

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { layoutText, type Measurer, type TextLayout } from './textLayout';

/** Object keys whose local change requires a re-measure. */
const RELEVANT_KEYS: ReadonlySet<string> = new Set(['text', 'size', 'widthMode', 'width']);

type DeepEvent = Y.YMapEvent<unknown> | Y.YTextEvent | Y.YArrayEvent<unknown>;

/**
 * Does this batch of deep events touch a re-measurable key?
 *
 * A change to a direct property of the object map (size/width/widthMode)
 * arrives as a YMapEvent with `path === []` and the changed keys in `keys`.
 * A change to the nested Y.Text arrives as a YTextEvent with `path === ['text']`.
 */
function isRelevant(events: DeepEvent[]): boolean {
  return events.some((e) => {
    if (e.path.length === 0 && 'keys' in e) {
      // yjs 13 YMapEvent.keys iterates [key, change] pairs.
      for (const entry of (e as Y.YMapEvent<unknown>).keys) {
        const key = Array.isArray(entry) ? entry[0] : entry;
        if (RELEVANT_KEYS.has(String(key))) return true;
      }
      return false;
    }
    return RELEVANT_KEYS.has(e.path[0] as string);
  });
}

export interface TextBoxSync {
  /** Re-measure and write the box (used by the editor and toolbar). */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const objRef = useRef<Y.Map<unknown> | null>(null);

  const computeLayout = useCallback((): TextLayout | null => {
    const obj = objRef.current;
    if (!obj) return null;
    const ytext = obj.get('text');
    if (!(ytext instanceof Y.Text)) return null;
    const size = (obj.get('size') as TextSize | undefined) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed' | undefined) ?? 'auto';
    const storedW = obj.get('width');
    const fixedWidth =
      widthMode === 'fixed' && typeof storedW === 'number' ? storedW : null;
    return layoutText(ytext.toString(), size, widthMode, fixedWidth, measure);
  }, [measure]);

  const writeIfChanged = useCallback((): void => {
    const obj = objRef.current;
    const layout = computeLayout();
    if (!obj || !layout) return;
    // Redundant-write guard: skip when the stored box already matches.
    if (obj.get('width') === layout.width && obj.get('height') === layout.height) return;
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }, [doc, id, computeLayout]);

  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id);
    if (!(obj instanceof Y.Map)) return;
    objRef.current = obj;

    const onDeep = (
      events: Array<Y.YMapEvent<unknown> | Y.YTextEvent | Y.YArrayEvent<unknown>>,
      transaction: Y.Transaction,
    ): void => {
      // Remote updates: never write (the remote peer wrote its own box).
      if (transaction.origin !== LOCAL_ORIGIN) return;
      if (!isRelevant(events)) return;
      writeIfChanged();
    };
    obj.observeDeep(onDeep);
    return () => {
      obj.unobserveDeep(onDeep);
      if (objRef.current === obj) objRef.current = null;
    };
  }, [doc, id, writeIfChanged]);

  const remeasureAfterLocalChange = useCallback((): void => {
    writeIfChanged();
  }, [writeIfChanged]);

  return { remeasureAfterLocalChange };
}
