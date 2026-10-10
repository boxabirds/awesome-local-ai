// Story 9: keeping a text object's box in step with its content. The box is
// only rewritten after a *local* change (typing, size change, width drag) —
// never on a remote text update, so peers never fight over measurement
// rounding. remeasureTextBox computes the layout and writes only when the
// box actually differs, keeping the update stream quiet.

import { useCallback } from 'react';
import * as Y from 'yjs';
import { DEFAULT_TEXT_SIZE } from '../../shared/config';
import { isTextSize } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

function textObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}

// Recompute the box from the object's current text/size/width mode and write
// it once via setTextBox if it differs. Returns true when a write happened.
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = textObject(doc, id);
  if (!obj) return false;
  const ytext = obj.get('text');
  const text = ytext instanceof Y.Text ? ytext.toString() : '';
  const sizeValue = obj.get('size');
  const size = isTextSize(sizeValue) ? sizeValue : DEFAULT_TEXT_SIZE;
  const mode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const storedWidth = obj.get('width');
  const storedHeight = obj.get('height');
  const { width, height } = layoutText(
    text,
    size,
    mode,
    mode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null,
    measure,
  );
  if (storedWidth === width && storedHeight === height) return false;
  return setTextBox(doc, id, { width, height });
}

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): { remeasureAfterLocalChange: () => void } {
  const remeasureAfterLocalChange = useCallback(
    () => void remeasureTextBox(doc, id, measure),
    [doc, id, measure],
  );
  return { remeasureAfterLocalChange };
}
