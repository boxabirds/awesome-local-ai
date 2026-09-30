import { useCallback } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, LOCAL_ORIGIN, getObject, isTextSize, moveObjects, objectsSnapshot } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE } from '../../shared/config';
import { getTextContent, setTextBox, setTextWidthFixed } from '../../shared/objects/text';
import type { Rect } from '../../shared/geometry';
import { type Measurer, defaultMeasurer, layoutText } from './textLayout';

function textFields(doc: Y.Doc, id: string) {
  const map = getObject(doc, id);
  const text = getTextContent(doc, id);
  if (!map || !text) return null;
  const size = map.get('size');
  const width = map.get('width');
  return {
    text: text.toString(),
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    mode: map.get('widthMode') === 'fixed' ? ('fixed' as const) : ('auto' as const),
    width: typeof width === 'number' ? width : null,
  };
}

/**
 * Measures a text object and stores its box when it differs (text.layout).
 * Call only after a local change: remote clients never write dimensions.
 * Returns true when the box was written.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer = defaultMeasurer()): boolean {
  const fields = textFields(doc, id);
  if (!fields) return false;
  const box = layoutText(fields.text, fields.size, fields.mode, fields.mode === 'fixed' ? fields.width : null, measure);
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/** Box sync for one text object: `remeasureAfterLocalChange` after local typing, size changes or width drags. */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const remeasureAfterLocalChange = useCallback(() => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);
  return { remeasureAfterLocalChange };
}

/**
 * The group transform's write for a text object (registry `applyResize`): a
 * horizontal-only drag (every selected object is text) sets a fixed width from
 * the dragged box; in a mixed selection the text is repositioned proportionally
 * and only a fixed width scales. Font size never changes; height is re-measured.
 */
export function applyTextResize(
  doc: Y.Doc,
  obj: ObjectSnapshot,
  to: Rect,
  opts: { horizontalOnly: boolean },
  measure: Measurer = defaultMeasurer(),
): void {
  const current = objectsSnapshot(doc).find((o) => o.id === obj.id);
  if (!current) return;
  const fixed = opts.horizontalOnly || current.widthMode === 'fixed';
  doc.transact(() => {
    moveObjects(doc, new Map([[obj.id, { x: to.x, y: opts.horizontalOnly ? current.y : to.y }]]));
    if (fixed) setTextWidthFixed(doc, obj.id, to.width);
    remeasureTextBox(doc, obj.id, measure);
  }, LOCAL_ORIGIN);
}
