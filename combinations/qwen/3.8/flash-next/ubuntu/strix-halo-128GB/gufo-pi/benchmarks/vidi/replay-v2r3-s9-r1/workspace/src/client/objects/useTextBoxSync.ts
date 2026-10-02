/**
 * Box sync for text objects (story 9, key decision 1).
 *
 * `width`/`height` are stored on the object so selection bounds, marquee and
 * export work on every client. Only the client that made a local change (typed,
 * changed size, dragged a side handle) measures and writes the box: remote
 * clients render the stored box and never re-measure, so five simultaneous
 * editors never race to write dimensions.
 *
 * The caller invokes `remeasureAfterLocalChange()` inside the same transaction
 * window as its change, which keeps text and box in one undo step.
 */
import { useCallback } from 'react';
import * as Y from 'yjs';
import { DEFAULT_TEXT_SIZE, isTextSize } from '../../shared/config';
import type { TextSize } from '../../shared/config';
import { getObjectsMap } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import { getSharedMeasurer, layoutText, type Measurer } from './textLayout';

/**
 * Recomputes the box of a text object and writes it when it differs from the
 * stored one. Returns true when the document was written.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'text') return false;
  const ytext = m.get('text');
  if (!(ytext instanceof Y.Text)) return false;

  const rawSize = m.get('size');
  const size: TextSize = isTextSize(rawSize) ? rawSize : DEFAULT_TEXT_SIZE;
  const mode = m.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const storedWidth = m.get('width');
  const fixedWidth = mode === 'fixed' && typeof storedWidth === 'number' ? storedWidth : null;

  const layout = layoutText(ytext.toString(), size, mode, fixedWidth, measure);
  if (m.get('width') === layout.width && m.get('height') === layout.height) return false;
  return setTextBox(doc, id, { width: layout.width, height: layout.height });
}

export interface UseTextBoxSyncResult {
  /** Measure and store the box after a change made by *this* client. */
  remeasureAfterLocalChange(): void;
}

/**
 * Local-only box sync for one text object. Deliberately does not observe the
 * document: remote updates must never trigger a write.
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer = getSharedMeasurer(),
): UseTextBoxSyncResult {
  const remeasureAfterLocalChange = useCallback(() => {
    remeasureTextBox(doc, id, measure);
  }, [doc, id, measure]);

  return { remeasureAfterLocalChange };
}
