/**
 * Story 9: local-only text box sync (text.layout, key decision 1).
 *
 * `remeasureTextBox` reads the object's CURRENT text/size/widthMode from the
 * doc, runs the pure `layoutText` and writes the box via `setTextBox` ONLY
 * when it differs. It is invoked exclusively after LOCAL changes (typing,
 * size preset change, fixed-width handle drag) — never on remote updates —
 * so the five concurrent editors never race to write the same dimensions
 * (remote clients render the stored box and stay read-only with respect to
 * width/height).
 *
 * The hook form `useTextBoxSync` binds it to one object id for the
 * TextObject component; Board-level actions (size toolbar, handle gesture)
 * call the plain function.
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import {
  getTextContent,
  getTextSize,
  getTextWidthMode,
  setTextBox,
} from 'src/shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/**
 * Recomputes the box of the text object `id` from its current doc state and
 * writes it when it changed. Returns true when a write happened. Never
 * throws: unknown ids, bad size keys and stale state are a no-op.
 */
export function remeasureTextBox(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const text = getTextContent(doc, id);
  if (!text) return false;
  const size = getTextSize(doc, id);
  if (!size) return false;
  const mode = getTextWidthMode(doc, id);
  if (!mode) return false;

  const obj = doc.getMap('objects').get(id) as { get: (k: string) => unknown } | undefined;
  const storedWidth = obj ? obj.get('width') : undefined;
  const fixedWidth =
    mode === 'fixed' && typeof storedWidth === 'number' && Number.isFinite(storedWidth)
      ? storedWidth
      : null;

  const box = layoutText(text.toString(), size, mode, fixedWidth, measure);
  return setTextBox(doc, id, box);
}

/**
 * Box sync for one text object (used by TextObject): `remeasureAfterLocalChange`
 * is called by the editor after each local input, and by the size toolbar /
 * width gesture after their local writes.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): {
  remeasureAfterLocalChange(): void;
} {
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const remeasureAfterLocalChange = useCallback(
    () => {
      remeasureTextBox(doc, id, measureRef.current);
    },
    [doc, id],
  );
  return { remeasureAfterLocalChange };
}
