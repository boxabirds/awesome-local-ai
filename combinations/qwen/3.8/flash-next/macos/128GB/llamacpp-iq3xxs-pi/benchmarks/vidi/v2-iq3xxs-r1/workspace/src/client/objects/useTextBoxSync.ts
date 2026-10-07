import { useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { OBJECTS_MAP } from '../../shared/board-model';
import { getTextContent, setTextBox } from '../../shared/objects/text';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import type { Measurer } from './textLayout';
import { layoutText, sharedMeasurer } from './textLayout';

// ---------------------------------------------------------------------------
// The stored box of a text object (story 9, design key decision 1): the client
// that made a *local* change measures the new text and writes the box; every
// other client renders the stored box instead of measuring again, so a reloaded
// board lays out identically even if its fonts differ (PRD text.reload_layout).
//
// `remeasureAfterLocalChange` is therefore called from exactly three places —
// local typing, a size change and a fixed-width drag — and never from a remote
// update. That is what keeps a remote peer's typing from producing sync traffic
// on every keystroke on every other client (TC-12).
// ---------------------------------------------------------------------------

/**
 * Measure `id` as it currently stands in `doc` and store the box. False when the
 * box already matches (no write, no update) or the object is gone (TC-13, TC-24).
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const m = objects.get(id);
  if (!(m instanceof Y.Map) || m.get('type') !== 'text') return false;
  const ytext = getTextContent(doc, id);
  if (!ytext) return false;

  const rawSize = m.get('size');
  const size: TextSize = typeof rawSize === 'string' && rawSize in TEXT_SIZES ? (rawSize as TextSize) : 'M';
  const mode = m.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const storedWidth = typeof m.get('width') === 'number' ? (m.get('width') as number) : 0;

  const box = layoutText(ytext.toString(), size, mode, storedWidth, measure);
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

export interface TextBoxSync {
  /** Re-measure and store the box after something *this* client did to the text. */
  remeasureAfterLocalChange(): void;
}

/**
 * `remeasureAfterLocalChange` bound to one text object. The measurer is created
 * once per hook, so typing does not build a new canvas on every keystroke.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer = sharedMeasurer(),
): TextBoxSync {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const remeasure = useCallback(() => void remeasureTextBox(doc, id, measure), [doc, id, measure]);
  return useMemo<TextBoxSync>(() => ({ remeasureAfterLocalChange: remeasure }), [remeasure]);
}
