/**
 * Keeps a text object's stored box in step with its content (story 9).
 *
 * Selection bounds, the marquee and (later) export need `width`/`height`
 * without every client measuring the text. So the client that made the local
 * change measures and writes the box — remote clients never write dimensions,
 * which is what stops five people on one board from racing to re-measure the
 * same change.
 *
 * The write happens in the same undo capture window as the change that caused
 * it, so one undo reverts the text and its box together.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { getObjectsMap, isTextSize, LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { layoutText } from './textLayout';
import type { Measurer } from './textLayout';

export interface UseTextBoxSyncResult {
  /** Recompute and store the box after a change made by *this* client. */
  remeasureAfterLocalChange(): void;
}

interface TextState {
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  width: number;
}

function readState(doc: Y.Doc, id: string): TextState | null {
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'text') return null;
  const text = m.get('text');
  const size = m.get('size');
  const widthMode = m.get('widthMode');
  const width = m.get('width');
  return {
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : 'M',
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    width: typeof width === 'number' && Number.isFinite(width) ? width : 0,
  };
}

/**
 * Measures the object's content and stores the resulting box, but only when it
 * differs from what is stored. Returns true when a write happened (TC-13: a
 * size change whose box is unchanged must not write).
 */
export function writeTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const state = readState(doc, id);
  if (!state) return false;
  const box = layoutText(
    state.text,
    state.size,
    state.widthMode,
    state.widthMode === 'fixed' ? state.width : null,
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/** True when the change touched anything but the stored box. */
function touchesContent(events: readonly Y.YEvent<Y.AbstractType<unknown>>[], root: Y.Map<unknown>): boolean {
  for (const event of events) {
    if (event.target === root) {
      const keys = (event as Y.YMapEvent<Y.Map<unknown>>).changes.keys;
      for (const key of keys.keys()) {
        if (key !== 'width' && key !== 'height') return true;
      }
      continue;
    }
    return true; // a change inside the nested Y.Text
  }
  return false;
}

/**
 * Subscribes to `id` and refreshes its box after local changes only: typing, a
 * size change and a fixed-width handle drag all mutate the object with
 * LOCAL_ORIGIN, which is what this hook listens for. Remote updates are drawn
 * from the stored box and never trigger a write.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): UseTextBoxSyncResult {
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(id);
  idRef.current = id;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasure = useCallback(() => {
    writeTextBox(docRef.current, idRef.current, measureRef.current);
  }, []);

  useEffect(() => {
    const m = getObjectsMap(doc).get(id);
    if (!m || m.get('type') !== 'text') return;

    const observer = (
      events: Y.YEvent<Y.AbstractType<unknown>>[],
      transaction: Y.Transaction,
    ): void => {
      if (!transaction.local || transaction.origin !== LOCAL_ORIGIN) return;
      if (!touchesContent(events, m)) return;
      writeTextBox(doc, id, measureRef.current);
    };

    m.observeDeep(observer);
    return () => m.unobserveDeep(observer);
  }, [doc, id]);

  return { remeasureAfterLocalChange: remeasure };
}
