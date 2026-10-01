import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { objectsOf } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_SIZES } from '../../shared/config';
import type { TextSize } from '../../shared/config';
import { setTextBox } from '../../shared/objects/text';
import { layoutText } from './textLayout';
import type { Measurer } from './textLayout';

const PRECISION = 100;
const round = (n: number) => Math.round(n * PRECISION) / PRECISION;

/** Measures a stored text object and writes its box when it differs. Returns true when a write happened. */
export function remeasureText(doc: Y.Doc, id: string, measure: Measurer): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj || obj.get('type') !== 'text') return false;
  const text = obj.get('text');
  const rawSize = obj.get('size');
  const size: TextSize = typeof rawSize === 'string' && rawSize in TEXT_SIZES ? (rawSize as TextSize) : DEFAULT_TEXT_SIZE;
  const mode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const width = obj.get('width');
  const laid = layoutText(
    text === undefined ? '' : String(text),
    size,
    mode,
    mode === 'fixed' && typeof width === 'number' ? width : null,
    measure,
  );
  return setTextBox(doc, id, { width: round(laid.width), height: round(laid.height) });
}

/**
 * Remote clients render the stored box and never write it: only the client that made a local change
 * (typing, size change, fixed-width drag) calls `remeasureAfterLocalChange`.
 */
export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): { remeasureAfterLocalChange(): void } {
  const live = useRef({ doc, id, measure });
  live.current = { doc, id, measure };
  const remeasureAfterLocalChange = useCallback(() => {
    const { doc: d, id: i, measure: m } = live.current;
    remeasureText(d, i, m);
  }, []);
  return { remeasureAfterLocalChange };
}
