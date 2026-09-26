import { useCallback } from 'react';
import type * as Y from 'yjs';

import { DEFAULT_TEXT_SIZE, type TextSize } from '../../shared/config';
import { getTextContent, isTextSize, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Keeps a text object's stored box in step with its content.
 *
 * Only local changes are measured: a remote peer's edit (or a remote size
 * change) arrives with the box its own client already computed, and
 * re-measuring here would fight it across the network. So nothing observes
 * the document — the code that makes a local change calls
 * `remeasureAfterLocalChange` right after it, inside the same transaction
 * group, which keeps typing and its box write in one undo capture window.
 */
export interface TextBoxSync {
  remeasureAfterLocalChange(): void;
}

/**
 * Measure `id` now and store the box if it differs. Returns whether a write
 * happened. Safe for stale or non-text ids (no-op).
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const map = objects.get(id);
  if (!map || map.get('type') !== 'text') {
    return false;
  }
  const ytext = getTextContent(doc, id);
  if (ytext === undefined) {
    return false;
  }
  const rawSize: unknown = map.get('size');
  const size: TextSize = isTextSize(rawSize) ? rawSize : DEFAULT_TEXT_SIZE;
  const widthMode = map.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const rawWidth: unknown = map.get('width');
  const rawHeight: unknown = map.get('height');
  const storedWidth = typeof rawWidth === 'number' ? rawWidth : 0;
  const storedHeight = typeof rawHeight === 'number' ? rawHeight : NaN;
  const box = layoutText(
    ytext.toString(),
    size,
    widthMode,
    widthMode === 'fixed' ? storedWidth : null,
    measure,
  );
  if (box.width === storedWidth && box.height === storedHeight) {
    return false;
  }
  return setTextBox(doc, id, box);
}

/** Hook form of `remeasureTextBox` for components (editor, toolbar, object). */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSync {
  const remeasureAfterLocalChange = useCallback(
    () => {
      remeasureTextBox(doc, id, measure);
    },
    [doc, id, measure],
  );
  return { remeasureAfterLocalChange };
}
