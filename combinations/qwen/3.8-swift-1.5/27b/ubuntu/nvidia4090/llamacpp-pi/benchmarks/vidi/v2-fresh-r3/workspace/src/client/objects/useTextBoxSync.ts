import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox, isTextSize } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Local-only box sync (story 9, text.layout key decision 1).
 *
 * The client that made a local change (typing, size change, fixed-width
 * drag) measures the text and writes `width`/`height` in the same capture
 * window, so undo reverts text and box together and remote clients render
 * the stored box without re-measuring (no write storms from five clients
 * measuring the same change).
 *
 * The hook subscribes to the object's Y.Map and remeasures only for changes
 * made with LOCAL_ORIGIN (this client). Remote updates never trigger writes.
 * `remeasureAfterLocalChange` is also exposed for explicit local calls
 * (editor input, toolbar size change, handle drag).
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange(): void } {
  const ref = useRef({ doc, id, measure });
  ref.current = { doc, id, measure };

  const objectsMap = (d: Y.Doc) => d.getMap('objects') as Y.Map<Y.Map<unknown>>;

  const remeasure = useCallback(() => {
    const { doc: d, id: i, measure: m } = ref.current;
    const obj = objectsMap(d).get(i);
    if (!obj || obj.get('type') !== 'text') return;
    const ytext = obj.get('text');
    const size = obj.get('size');
    if (!(ytext instanceof Y.Text) || !isTextSize(size)) return;
    const widthMode: 'auto' | 'fixed' = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
    const storedWidth = obj.get('width');
    const fixedWidth =
      widthMode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null;
    const box = layoutText(ytext.toString(), size, widthMode, fixedWidth, m);
    if (obj.get('width') !== box.width || obj.get('height') !== box.height) {
      setTextBox(d, i, { width: box.width, height: box.height });
    }
  }, []);

  useEffect(() => {
    const { doc: d, id: i } = ref.current;
    const obj = objectsMap(d).get(i);
    if (!obj) return;
    // Only local changes trigger a remeasure (remote updates render the
    // stored box; the originating client already wrote it). The map observer
    // sees size/width/widthMode writes; the Y.Text observer sees typing
    // (nested changes do not fire the parent map's observers).
    const onMapChange = (ev: Y.YMapEvent<unknown>) => {
      if (ev.transaction.origin !== LOCAL_ORIGIN) return;
      if (
        ev.keysChanged.has('size') ||
        ev.keysChanged.has('width') ||
        ev.keysChanged.has('widthMode')
      ) {
        remeasure();
      }
    };
    obj.observe(onMapChange);
    const rawText = obj.get('text');
    let textType: Y.Text | null = null;
    let onTextChange: ((ev: Y.YTextEvent) => void) | null = null;
    if (rawText instanceof Y.Text) {
      textType = rawText;
      onTextChange = (ev) => {
        if (ev.transaction.origin === LOCAL_ORIGIN) remeasure();
      };
      textType.observe(onTextChange);
    }
    return () => {
      obj.unobserve(onMapChange);
      if (textType !== null && onTextChange !== null) textType.unobserve(onTextChange);
    };
  }, [id, remeasure]);

  return { remeasureAfterLocalChange: remeasure };
}
