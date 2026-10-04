/**
 * Local-only text box sync (story 9): the client that made a local change
 * (typing, size change, fixed-width drag) measures the text and writes the
 * stored width/height. Remote updates never trigger writes, so five clients
 * never race to re-measure the same change (key decision 1).
 *
 * The hook subscribes to the object's Y.Map (size / width / widthMode) and
 * its Y.Text (content); only changes with LOCAL_ORIGIN trigger a remeasure.
 * The box is written only when the computed box differs from the stored one.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import { TEXT_MIN_WIDTH_WORLD, type TextSize } from '../../shared/config';
import { layoutText, type Measurer } from './textLayout';

export interface UseTextBoxSyncResult {
  /** Remeasure now and write the box if it changed. Safe to call anytime. */
  remeasureAfterLocalChange(): void;
}

/**
 * Keep a text object's stored width/height in sync with its content.
 * Writes happen only after LOCAL_ORIGIN changes to text, size, width or
 * widthMode, and only when the computed box differs from the stored box.
 */
export function useTextBoxSync(doc: Y.Doc | undefined, id: string, measure: Measurer): UseTextBoxSyncResult {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasure = useCallback(() => {
    if (!doc) return;
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
    if (!obj) return;

    const text = (obj.get('text') as Y.Text | undefined)?.toString() ?? '';
    const size = (obj.get('size') as TextSize) ?? 'M';
    const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;
    const fixedWidth = widthMode === 'fixed' ? (storedWidth ?? TEXT_MIN_WIDTH_WORLD) : null;

    const box = layoutText(text, size, widthMode, fixedWidth, measureRef.current);

    const currentWidth = obj.get('width') as number | undefined;
    const currentHeight = obj.get('height') as number | undefined;
    if (currentWidth !== box.width || currentHeight !== box.height) {
      setTextBox(doc, id, box);
    }
  }, [doc, id]);

  useEffect(() => {
    if (!doc) return;
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
    if (!obj) return;

    // Yjs observe callbacks receive (event, transaction, origin). The map and
    // text observe types differ in declared arity, so use two closures.
    // Yjs observe callbacks receive (event, transaction); the transaction's
    // origin distinguishes local (LOCAL_ORIGIN) from remote changes.
    const onMapChange = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) remeasure();
    };
    const onTextChange = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) remeasure();
    };
    obj.observe(onMapChange);
    const ytext = obj.get('text') as Y.Text | undefined;
    if (ytext) ytext.observe(onTextChange);

    return () => {
      obj.unobserve(onMapChange);
      ytext?.unobserve(onTextChange);
    };
  }, [doc, id, remeasure]);

  return useMemo(() => ({ remeasureAfterLocalChange: remeasure }), [remeasure]);
}
